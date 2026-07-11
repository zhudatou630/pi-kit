import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const APPLY_PATCH_PARAMETERS = {
	type: "object",
	properties: {
		patch: {
			type: "string",
			description:
				"Patch text in Codex apply_patch format. Paths may be relative to the current working directory or absolute paths elsewhere on the local machine.",
		},
	},
	required: ["patch"],
	additionalProperties: false,
} as const;

type ActionType = "add" | "delete" | "update";
type ParseMode = "keep" | "add" | "delete";

interface Chunk {
	origIndex: number;
	delLines: string[];
	insLines: string[];
}

interface PatchAction {
	type: ActionType;
	newFile?: string;
	chunks: Chunk[];
	movePath?: string;
}

interface Patch {
	actions: Record<string, PatchAction>;
}

interface ParserState {
	currentFiles: Record<string, string>;
	lines: string[];
	index: number;
	patch: Patch;
	fuzz: number;
}

interface FileChange {
	type: ActionType;
	oldContent?: string;
	newContent?: string;
	movePath?: string;
}

interface Commit {
	changes: Record<string, FileChange>;
}

interface ExecutePatchResult {
	changedFiles: string[];
	createdFiles: string[];
	deletedFiles: string[];
	movedFiles: string[];
	fuzz: number;
}

class DiffError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DiffError";
	}
}

function normalizePatchPath({ path }: { path: string }): string {
	const trimmed = path.trim();
	const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
	return withoutAt.replace(/^['"]|['"]$/g, "");
}

function resolvePatchPath({ cwd, patchPath }: { cwd: string; patchPath: string }): string {
	const normalized = normalizePatchPath({ path: patchPath });
	if (!normalized) {
		throw new DiffError("Patch path cannot be empty");
	}

	return isAbsolute(normalized) ? normalized : resolve(cwd, normalized);
}

function parserIsDone({ state, prefixes }: { state: ParserState; prefixes?: string[] }): boolean {
	if (state.index >= state.lines.length) {
		return true;
	}
	if (prefixes && prefixes.some((prefix) => state.lines[state.index].startsWith(prefix))) {
		return true;
	}
	return false;
}

function parserStartsWith({ state, prefix }: { state: ParserState; prefix: string }): boolean {
	if (state.index >= state.lines.length) {
		throw new DiffError(`Index: ${state.index} >= ${state.lines.length}`);
	}
	return state.lines[state.index].startsWith(prefix);
}

function parserReadStr({
	state,
	prefix,
	returnEverything,
}: {
	state: ParserState;
	prefix?: string;
	returnEverything?: boolean;
}): string {
	if (state.index >= state.lines.length) {
		throw new DiffError(`Index: ${state.index} >= ${state.lines.length}`);
	}

	const expectedPrefix = prefix ?? "";
	if (state.lines[state.index].startsWith(expectedPrefix)) {
		const text = returnEverything ? state.lines[state.index] : state.lines[state.index].slice(expectedPrefix.length);
		state.index += 1;
		return text;
	}
	return "";
}

function linesEqual({ left, right }: { left: string[]; right: string[] }): boolean {
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i++) {
		if (left[i] !== right[i]) return false;
	}
	return true;
}

function findContextCore({
	lines,
	context,
	start,
}: {
	lines: string[];
	context: string[];
	start: number;
}): { newIndex: number; fuzz: number } {
	if (context.length === 0) {
		return { newIndex: start, fuzz: 0 };
	}

	for (let i = start; i < lines.length; i++) {
		if (linesEqual({ left: lines.slice(i, i + context.length), right: context })) {
			return { newIndex: i, fuzz: 0 };
		}
	}

	for (let i = start; i < lines.length; i++) {
		const left = lines.slice(i, i + context.length).map((line) => line.trimEnd());
		const right = context.map((line) => line.trimEnd());
		if (linesEqual({ left, right })) {
			return { newIndex: i, fuzz: 1 };
		}
	}

	for (let i = start; i < lines.length; i++) {
		const left = lines.slice(i, i + context.length).map((line) => line.trim());
		const right = context.map((line) => line.trim());
		if (linesEqual({ left, right })) {
			return { newIndex: i, fuzz: 100 };
		}
	}

	return { newIndex: -1, fuzz: 0 };
}

function findContext({
	lines,
	context,
	start,
	eof,
}: {
	lines: string[];
	context: string[];
	start: number;
	eof: boolean;
}): { newIndex: number; fuzz: number } {
	if (eof) {
		const nearEnd = Math.max(lines.length - context.length, 0);
		const preferred = findContextCore({ lines, context, start: nearEnd });
		if (preferred.newIndex !== -1) {
			return preferred;
		}
		const fallback = findContextCore({ lines, context, start });
		return { newIndex: fallback.newIndex, fuzz: fallback.fuzz + 10000 };
	}
	return findContextCore({ lines, context, start });
}

function peekNextSection({ lines, index }: { lines: string[]; index: number }): {
	nextChunkContext: string[];
	chunks: Chunk[];
	endPatchIndex: number;
	eof: boolean;
} {
	const old: string[] = [];
	let delLines: string[] = [];
	let insLines: string[] = [];
	const chunks: Chunk[] = [];
	let mode: ParseMode = "keep";
	const origIndex = index;

	while (index < lines.length) {
		const rawLine = lines[index];
		if (
			rawLine.startsWith("@@") ||
			rawLine.startsWith("*** End Patch") ||
			rawLine.startsWith("*** Update File:") ||
			rawLine.startsWith("*** Delete File:") ||
			rawLine.startsWith("*** Add File:") ||
			rawLine.startsWith("*** End of File")
		) {
			break;
		}

		if (rawLine === "***") {
			break;
		}
		if (rawLine.startsWith("***")) {
			throw new DiffError(`Invalid Line: ${rawLine}`);
		}

		index += 1;
		const lastMode = mode;
		let line = rawLine;
		if (line === "") {
			line = " ";
		}

		if (line[0] === "+") {
			mode = "add";
		} else if (line[0] === "-") {
			mode = "delete";
		} else if (line[0] === " ") {
			mode = "keep";
		} else {
			throw new DiffError(`Invalid Line: ${line}`);
		}

		const value = line.slice(1);
		if (mode === "keep" && lastMode !== mode) {
			if (insLines.length > 0 || delLines.length > 0) {
				chunks.push({
					origIndex: old.length - delLines.length,
					delLines,
					insLines,
				});
			}
			delLines = [];
			insLines = [];
		}

		if (mode === "delete") {
			delLines.push(value);
			old.push(value);
		} else if (mode === "add") {
			insLines.push(value);
		} else {
			old.push(value);
		}
	}

	if (insLines.length > 0 || delLines.length > 0) {
		chunks.push({
			origIndex: old.length - delLines.length,
			delLines,
			insLines,
		});
	}

	if (index < lines.length && lines[index] === "*** End of File") {
		return {
			nextChunkContext: old,
			chunks,
			endPatchIndex: index + 1,
			eof: true,
		};
	}

	if (index === origIndex) {
		throw new DiffError(`Nothing in this section - index=${index} ${lines[index] ?? ""}`);
	}

	return {
		nextChunkContext: old,
		chunks,
		endPatchIndex: index,
		eof: false,
	};
}

function parseAddFile({ state }: { state: ParserState }): PatchAction {
	const lines: string[] = [];
	while (
		!parserIsDone({
			state,
			prefixes: ["*** End Patch", "*** Update File:", "*** Delete File:", "*** Add File:"],
		})
	) {
		const value = parserReadStr({ state, prefix: "" });
		if (!value.startsWith("+")) {
			throw new DiffError(`Invalid Add File Line: ${value}`);
		}
		lines.push(value.slice(1));
	}

	return {
		type: "add",
		newFile: lines.join("\n"),
		chunks: [],
	};
}

function parseUpdateFile({ state, text }: { state: ParserState; text: string }): PatchAction {
	const action: PatchAction = {
		type: "update",
		chunks: [],
	};

	const lines = text.split("\n");
	let index = 0;

	while (
		!parserIsDone({
			state,
			prefixes: ["*** End Patch", "*** Update File:", "*** Delete File:", "*** Add File:", "*** End of File"],
		})
	) {
		const defStr = parserReadStr({ state, prefix: "@@ " });
		let sectionStr = "";
		if (!defStr && state.index < state.lines.length && state.lines[state.index] === "@@") {
			sectionStr = state.lines[state.index];
			state.index += 1;
		}

		if (!(defStr || sectionStr || index === 0)) {
			throw new DiffError(`Invalid Line:\n${state.lines[state.index]}`);
		}

		if (defStr.trim().length > 0) {
			let found = false;

			const exactAlreadySeen = lines.slice(0, index).some((line) => line === defStr);
			if (!exactAlreadySeen) {
				for (let i = index; i < lines.length; i++) {
					if (lines[i] === defStr) {
						index = i + 1;
						found = true;
						break;
					}
				}
			}

			if (!found) {
				const trimAlreadySeen = lines.slice(0, index).some((line) => line.trim() === defStr.trim());
				if (!trimAlreadySeen) {
					for (let i = index; i < lines.length; i++) {
						if (lines[i].trim() === defStr.trim()) {
							index = i + 1;
							state.fuzz += 1;
							break;
						}
					}
				}
			}
		}

		const { nextChunkContext, chunks, endPatchIndex, eof } = peekNextSection({ lines: state.lines, index: state.index });
		const nextChunkText = nextChunkContext.join("\n");
		const { newIndex, fuzz } = findContext({
			lines,
			context: nextChunkContext,
			start: index,
			eof,
		});

		if (newIndex === -1) {
			if (eof) {
				throw new DiffError(`Invalid EOF Context ${index}:\n${nextChunkText}`);
			}
			throw new DiffError(`Invalid Context ${index}:\n${nextChunkText}`);
		}

		state.fuzz += fuzz;

		for (const chunk of chunks) {
			action.chunks.push({
				origIndex: chunk.origIndex + newIndex,
				delLines: chunk.delLines,
				insLines: chunk.insLines,
			});
		}

		index = newIndex + nextChunkContext.length;
		state.index = endPatchIndex;
	}

	return action;
}

function parsePatchDocument({ text, originalFiles }: { text: string; originalFiles: Record<string, string> }): {
	patch: Patch;
	fuzz: number;
} {
	const lines = text.trim().split("\n");
	if (lines.length < 2 || !lines[0].startsWith("*** Begin Patch") || lines[lines.length - 1] !== "*** End Patch") {
		throw new DiffError("Invalid patch text");
	}

	const state: ParserState = {
		currentFiles: originalFiles,
		lines,
		index: 1,
		patch: { actions: {} },
		fuzz: 0,
	};

	while (!parserIsDone({ state, prefixes: ["*** End Patch"] })) {
		const updatePath = normalizePatchPath({ path: parserReadStr({ state, prefix: "*** Update File: " }) });
		if (updatePath) {
			if (state.patch.actions[updatePath]) {
				throw new DiffError(`Update File Error: Duplicate Path: ${updatePath}`);
			}
			const moveToRaw = parserReadStr({ state, prefix: "*** Move to: " });
			const moveTo = moveToRaw ? normalizePatchPath({ path: moveToRaw }) : undefined;
			if (!(updatePath in state.currentFiles)) {
				throw new DiffError(`Update File Error: Missing File: ${updatePath}`);
			}

			const action = parseUpdateFile({ state, text: state.currentFiles[updatePath] });
			action.movePath = moveTo;
			state.patch.actions[updatePath] = action;
			continue;
		}

		const deletePath = normalizePatchPath({ path: parserReadStr({ state, prefix: "*** Delete File: " }) });
		if (deletePath) {
			if (state.patch.actions[deletePath]) {
				throw new DiffError(`Delete File Error: Duplicate Path: ${deletePath}`);
			}
			if (!(deletePath in state.currentFiles)) {
				throw new DiffError(`Delete File Error: Missing File: ${deletePath}`);
			}
			state.patch.actions[deletePath] = {
				type: "delete",
				chunks: [],
			};
			continue;
		}

		const addPath = normalizePatchPath({ path: parserReadStr({ state, prefix: "*** Add File: " }) });
		if (addPath) {
			if (state.patch.actions[addPath]) {
				throw new DiffError(`Add File Error: Duplicate Path: ${addPath}`);
			}
			state.patch.actions[addPath] = parseAddFile({ state });
			continue;
		}

		throw new DiffError(`Unknown Line: ${state.lines[state.index]}`);
	}

	if (!parserStartsWith({ state, prefix: "*** End Patch" })) {
		throw new DiffError("Missing End Patch");
	}
	state.index += 1;

	return { patch: state.patch, fuzz: state.fuzz };
}

function identifyFilesNeeded({ patchText }: { patchText: string }): string[] {
	const lines = patchText.trim().split("\n");
	const files = new Set<string>();
	for (const line of lines) {
		if (line.startsWith("*** Update File: ")) {
			files.add(normalizePatchPath({ path: line.slice("*** Update File: ".length) }));
		}
		if (line.startsWith("*** Delete File: ")) {
			files.add(normalizePatchPath({ path: line.slice("*** Delete File: ".length) }));
		}
	}
	return [...files];
}

function getUpdatedFile({ text, action, path }: { text: string; action: PatchAction; path: string }): string {
	if (action.type !== "update") {
		throw new DiffError(`Invalid action type for update: ${action.type}`);
	}

	const origLines = text.split("\n");
	const destLines: string[] = [];
	let origIndex = 0;
	let destIndex = 0;

	for (const chunk of action.chunks) {
		if (chunk.origIndex > origLines.length) {
			throw new DiffError(
				`_get_updated_file: ${path}: chunk.orig_index ${chunk.origIndex} > len(lines) ${origLines.length}`,
			);
		}
		if (origIndex > chunk.origIndex) {
			throw new DiffError(
				`_get_updated_file: ${path}: orig_index ${origIndex} > chunk.orig_index ${chunk.origIndex}`,
			);
		}

		destLines.push(...origLines.slice(origIndex, chunk.origIndex));
		const delta = chunk.origIndex - origIndex;
		origIndex += delta;
		destIndex += delta;

		if (chunk.insLines.length > 0) {
			destLines.push(...chunk.insLines);
			destIndex += chunk.insLines.length;
		}

		origIndex += chunk.delLines.length;
	}

	destLines.push(...origLines.slice(origIndex));
	const tailDelta = origLines.length - origIndex;
	origIndex += tailDelta;
	destIndex += tailDelta;

	if (origIndex !== origLines.length) {
		throw new DiffError(`Unexpected final orig_index for ${path}`);
	}
	if (destIndex !== destLines.length) {
		throw new DiffError(`Unexpected final dest_index for ${path}`);
	}

	return destLines.join("\n");
}

function patchToCommit({ patch, originalFiles }: { patch: Patch; originalFiles: Record<string, string> }): Commit {
	const commit: Commit = { changes: {} };

	for (const [path, action] of Object.entries(patch.actions)) {
		if (action.type === "delete") {
			commit.changes[path] = {
				type: "delete",
				oldContent: originalFiles[path],
			};
			continue;
		}

		if (action.type === "add") {
			commit.changes[path] = {
				type: "add",
				newContent: action.newFile ?? "",
			};
			continue;
		}

		const newContent = getUpdatedFile({ text: originalFiles[path], action, path });
		commit.changes[path] = {
			type: "update",
			oldContent: originalFiles[path],
			newContent,
			movePath: action.movePath,
		};
	}

	return commit;
}

function loadFiles({
	paths,
	openFile,
}: {
	paths: string[];
	openFile: ({ path }: { path: string }) => string;
}): Record<string, string> {
	const files: Record<string, string> = {};
	for (const path of paths) {
		files[path] = openFile({ path });
	}
	return files;
}

function openFileAtPath({ cwd, path }: { cwd: string; path: string }): string {
	const absolutePath = resolvePatchPath({ cwd, patchPath: path });
	if (!existsSync(absolutePath)) {
		throw new DiffError(`File not found: ${path}`);
	}
	return readFileSync(absolutePath, "utf8");
}

function writeFileAtPath({ cwd, path, content }: { cwd: string; path: string; content: string }): { created: boolean } {
	const absolutePath = resolvePatchPath({ cwd, patchPath: path });
	const created = !existsSync(absolutePath);
	mkdirSync(dirname(absolutePath), { recursive: true });
	writeFileSync(absolutePath, content, "utf8");
	return { created };
}

function removeFileAtPath({ cwd, path }: { cwd: string; path: string }): void {
	const absolutePath = resolvePatchPath({ cwd, patchPath: path });
	if (!existsSync(absolutePath)) {
		throw new DiffError(`File not found: ${path}`);
	}
	unlinkSync(absolutePath);
}

function executePatch({ cwd, patchText }: { cwd: string; patchText: string }): ExecutePatchResult {
	if (!patchText.startsWith("*** Begin Patch")) {
		throw new DiffError("Patch must start with '*** Begin Patch'");
	}

	const requiredFiles = identifyFilesNeeded({ patchText });
	const originalFiles = loadFiles({
		paths: requiredFiles,
		openFile: ({ path }) => openFileAtPath({ cwd, path }),
	});
	const { patch, fuzz } = parsePatchDocument({ text: patchText, originalFiles });
	const commit = patchToCommit({ patch, originalFiles });

	const changedFiles = new Set<string>();
	const createdFiles = new Set<string>();
	const deletedFiles = new Set<string>();
	const movedFiles = new Set<string>();

	for (const [path, change] of Object.entries(commit.changes)) {
		if (change.type === "delete") {
			removeFileAtPath({ cwd, path });
			changedFiles.add(path);
			deletedFiles.add(path);
			continue;
		}

		if (change.type === "add") {
			const { created } = writeFileAtPath({
				cwd,
				path,
				content: change.newContent ?? "",
			});
			changedFiles.add(path);
			if (created) {
				createdFiles.add(path);
			}
			continue;
		}

		if (change.newContent === undefined) {
			throw new DiffError(`Update File Error: Missing new content for ${path}`);
		}

		if (change.movePath) {
			const fromAbsolutePath = resolvePatchPath({ cwd, patchPath: path });
			const toAbsolutePath = resolvePatchPath({ cwd, patchPath: change.movePath });
			const destinationExisted = existsSync(toAbsolutePath);
			if (destinationExisted && fromAbsolutePath !== toAbsolutePath) {
				throw new DiffError(`Update File Error: Destination already exists: ${change.movePath}`);
			}

			mkdirSync(dirname(toAbsolutePath), { recursive: true });
			writeFileSync(toAbsolutePath, change.newContent, "utf8");
			if (fromAbsolutePath !== toAbsolutePath) {
				if (!existsSync(fromAbsolutePath)) {
					throw new DiffError(`Update File Error: Missing source file: ${path}`);
				}
				unlinkSync(fromAbsolutePath);
			}

			changedFiles.add(path);
			changedFiles.add(change.movePath);
			movedFiles.add(`${path} -> ${change.movePath}`);
			if (!destinationExisted) {
				createdFiles.add(change.movePath);
			}
			if (fromAbsolutePath !== toAbsolutePath) {
				deletedFiles.add(path);
			}
			continue;
		}

		writeFileAtPath({ cwd, path, content: change.newContent });
		changedFiles.add(path);
	}

	return {
		changedFiles: [...changedFiles],
		createdFiles: [...createdFiles],
		deletedFiles: [...deletedFiles],
		movedFiles: [...movedFiles],
		fuzz,
	};
}

export default function applyPatchExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "apply_patch",
		label: "apply_patch",
		description:
			"Apply a Codex-style patch. Input must be a single patch string using markers like *** Begin Patch, *** Update File:, @@, and *** End Patch. Paths may be relative to the current working directory or absolute paths elsewhere on the local machine.",
		parameters: APPLY_PATCH_PARAMETERS,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) {
				throw new Error("apply_patch aborted");
			}

			const typedParams = params as { patch?: string };
			if (!typedParams.patch || typeof typedParams.patch !== "string") {
				throw new Error("apply_patch requires a string 'patch' parameter");
			}

			const result = executePatch({ cwd: ctx.cwd, patchText: typedParams.patch });
			const summary = [
				"Applied patch successfully.",
				`Changed files: ${result.changedFiles.length}`,
				`Created files: ${result.createdFiles.length}`,
				`Deleted files: ${result.deletedFiles.length}`,
				`Moved files: ${result.movedFiles.length}`,
				`Fuzz: ${result.fuzz}`,
			].join("\n");

			return {
				content: [{ type: "text", text: summary }],
				details: result,
			};
		},
	});
}
