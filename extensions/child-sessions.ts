/**
 * 列出并按需恢复「当前主会话」底下的 tintinweb 子会话。
 *
 * Agent({ resume }) 只认内存 live record（约 10 分钟）。
 * 官方 RPC spawn 会剥掉 resumeSessionFile，无法把孩子重新挂回挂号表。
 * evicted 后打开同一份 jsonl 跑一轮，结果 inline 返回。
 *
 * 只在 tintinweb 就绪时注册。不接受路径。不认普通 /fork。
 */
import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	DefaultResourceLoader,
	type ExtensionAPI,
	getAgentDir,
	parseFrontmatter,
	SessionManager,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const LIVE_MS = 10 * 60_000;
const NAME_RE = /^([\w.-]+)#([0-9a-f]{8})$/i;
const BUILTIN_TOOLS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

type Tracked = { id: string; type: string; running: boolean; completedAt?: number };

type Child = {
	file: string;
	name: string;
	type: string;
	idPrefix: string;
	status: "running" | "cooling" | "evicted";
	liveId?: string;
};

type AgentSpec = { tools: string[]; replacePrompt: string };

function samePath(a: string, b: string): boolean {
	if (a === b) return true;
	try {
		return realpathSync(a) === realpathSync(b);
	} catch {
		return false;
	}
}

function fileKey(file: string): string {
	try {
		return realpathSync(file);
	} catch {
		return file;
	}
}

function parseName(name: string): { type: string; idPrefix: string } | undefined {
	const match = NAME_RE.exec(name);
	if (!match) return undefined;
	return { type: match[1], idPrefix: match[2].toLowerCase() };
}

function asStringList(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
	if (typeof value === "string") return value.split(/[,\s]+/).filter(Boolean);
	return [];
}

function parseAgentSpec(raw: string): AgentSpec | string {
	const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
	if (frontmatter.prompt_mode !== "replace" || !body.trim()) {
		return "disk resume only supports prompt_mode: replace agents";
	}
	if (frontmatter.extensions !== false || frontmatter.skills !== false) {
		return "disk resume refuses agents that enable extensions or skills";
	}
	if (frontmatter.memory) return "disk resume refuses agents with memory:";
	const tools = asStringList(frontmatter.tools).filter((name) => BUILTIN_TOOLS.has(name));
	if (tools.length === 0) return "disk resume needs an explicit builtin tools: list";
	return { tools, replacePrompt: body.trim() };
}

function findAgentMd(type: string, cwd: string): string | undefined {
	const dirs = [
		join(cwd, ".pi", "agents"),
		join(cwd, ".agents", "agents"),
		join(getAgentDir(), "agents"),
	];
	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir)) {
			if (!file.endsWith(".md")) continue;
			const path = join(dir, file);
			let raw: string;
			try {
				raw = readFileSync(path, "utf8");
			} catch {
				continue;
			}
			const { frontmatter } = parseFrontmatter<Record<string, unknown>>(raw);
			const declared = typeof frontmatter.name === "string" ? frontmatter.name : file.slice(0, -3);
			if (declared === type || file.slice(0, -3) === type) return path;
		}
	}
	return undefined;
}

function readPrefix(file: string, bytes = 8192): string | undefined {
	try {
		const fd = openSync(file, "r");
		try {
			const buf = Buffer.alloc(bytes);
			const n = readSync(fd, buf, 0, bytes, 0);
			return buf.toString("utf8", 0, n);
		} finally {
			closeSync(fd);
		}
	} catch {
		return undefined;
	}
}

function readHeader(file: string): { parentSession?: string; name?: string } | undefined {
	const raw = readPrefix(file);
	if (raw === undefined) return undefined;
	let parentSession: string | undefined;
	let name: string | undefined;
	for (const line of raw.split("\n", 16)) {
		if (!line) continue;
		try {
			const entry = JSON.parse(line) as { type?: string; parentSession?: string; name?: string };
			if (entry.type === "session") parentSession = entry.parentSession;
			if (entry.type === "session_info" && entry.name) name = entry.name;
		} catch {
			continue;
		}
		if (parentSession && name) break;
	}
	return { parentSession, name };
}

function thisTurnText(
	messages: Array<{ role?: string; content?: unknown; stopReason?: string; errorMessage?: string }>,
	startLen: number,
): { text?: string; error?: string } {
	const added = messages.slice(startLen);
	const last = [...added].reverse().find((message) => message.role === "assistant");
	if (!last) return { error: "no assistant message this turn" };
	if (last.stopReason === "error" || last.stopReason === "aborted") {
		return { error: last.errorMessage || last.stopReason };
	}
	if (!Array.isArray(last.content)) return { error: "empty assistant content this turn" };
	const text = last.content
		.filter((block): block is { type: string; text: string } =>
			!!block && typeof block === "object" && (block as { type?: string }).type === "text",
		)
		.map((block) => block.text)
		.join("\n")
		.trim();
	if (!text) return { error: "no assistant text this turn" };
	return { text };
}

export default function childSessions(pi: ExtensionAPI): void {
	const tracked = new Map<string, Tracked>();
	const resuming = new Set<string>();
	let registered = false;

	const reset = () => tracked.clear();
	pi.on("session_start", reset);
	pi.on("session_before_switch", reset);

	const remember = (raw: unknown, running: boolean) => {
		const event = raw as { id?: string; type?: string };
		if (!event.id || !event.type) return;
		const prev = tracked.get(event.id);
		tracked.set(event.id, {
			id: event.id,
			type: event.type,
			running,
			completedAt: running ? undefined : prev?.completedAt ?? Date.now(),
		});
	};

	pi.events.on("subagents:created", (raw) => remember(raw, true));
	pi.events.on("subagents:started", (raw) => remember(raw, true));
	pi.events.on("subagents:completed", (raw) => remember(raw, false));
	pi.events.on("subagents:failed", (raw) => remember(raw, false));

	const statusOf = (child: { type: string; idPrefix: string }): Pick<Child, "status" | "liveId"> => {
		const now = Date.now();
		for (const rec of tracked.values()) {
			if (rec.type !== child.type) continue;
			if (!rec.id.toLowerCase().startsWith(child.idPrefix)) continue;
			if (rec.running) return { status: "running", liveId: rec.id };
			if (rec.completedAt && now - rec.completedAt < LIVE_MS) {
				return { status: "cooling", liveId: rec.id };
			}
		}
		return { status: "evicted" };
	};

	const listChildren = (parentFile: string): Child[] => {
		const dir = dirname(parentFile);
		let names: string[];
		try {
			names = readdirSync(dir);
		} catch {
			return [];
		}
		const out: Child[] = [];
		for (const name of names) {
			if (!name.endsWith(".jsonl")) continue;
			const file = join(dir, name);
			if (samePath(file, parentFile)) continue;
			const header = readHeader(file);
			if (!header?.parentSession || !header.name) continue;
			if (!samePath(header.parentSession, parentFile)) continue;
			const parsed = parseName(header.name);
			if (!parsed) continue;
			const { status, liveId } = statusOf(parsed);
			out.push({ file, name: header.name, ...parsed, status, liveId });
		}
		out.sort((a, b) => a.name.localeCompare(b.name));
		return out;
	};

	const resolveRef = (children: Child[], ref: string): Child | string => {
		const wanted = ref.replace(/^@/, "").trim();
		const hits = children.filter((child) => {
			if (child.liveId === wanted) return true;
			if (child.name === wanted) return true;
			if (child.type === wanted) return true;
			if (wanted.toLowerCase() === child.idPrefix) return true;
			if (wanted.toLowerCase().startsWith(child.idPrefix) && wanted.includes("-")) return true;
			return false;
		});
		if (hits.length === 1) return hits[0];
		if (hits.length === 0) return `No tintinweb child session matches "${wanted}". Use action=list.`;
		return `Ambiguous ref "${wanted}": ${hits.map((c) => c.name).join(", ")}. Use the exact name or live id.`;
	};

	const register = () => {
		if (registered) return;
		registered = true;
		pi.registerTool({
			name: "child_sessions",
			label: "child_sessions",
			description:
				"List or continue tintinweb child sessions nested under this parent chat. list = inventory. resume = prompt an evicted child jsonl and return that turn inline. Do not pass file paths. running/cooling: use Agent({ resume }) or steer_subagent. Prefer the first-round agent id as ref.",
			parameters: Type.Object({
				action: StringEnum(["list", "resume"] as const, {
					description: "list children, or resume one evicted child",
				}),
				ref: Type.Optional(
					Type.String({
						description: "For resume: first-round agent id, or session name like explore#cb4f267a",
					}),
				),
				prompt: Type.Optional(Type.String({ description: "For resume: the next user message" })),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const action = params.action as "list" | "resume";
				const parentFile = ctx.sessionManager.getSessionFile?.();
				if (!parentFile) {
					return { content: [{ type: "text", text: "Current session has no file; no children to list." }] };
				}
				const children = listChildren(parentFile);
				if (action === "list") {
					if (children.length === 0) {
						return { content: [{ type: "text", text: "No tintinweb child sessions under this parent." }] };
					}
					const lines = children.map((c) => {
						const id = c.liveId ? ` live_id=${c.liveId}` : ` prefix=${c.idPrefix}`;
						return `- ${c.name}  type=${c.type}  status=${c.status}${id}`;
					});
					return { content: [{ type: "text", text: lines.join("\n") }] };
				}

				const ref = typeof params.ref === "string" ? params.ref : "";
				const prompt = typeof params.prompt === "string" ? params.prompt : "";
				if (!ref || !prompt) {
					return { content: [{ type: "text", text: "resume requires ref and prompt." }] };
				}
				const resolved = resolveRef(children, ref);
				if (typeof resolved === "string") {
					return { content: [{ type: "text", text: resolved }] };
				}

				const refuseLive = (child: Child) => {
					if (child.status === "running") {
						return `${child.name} is still running (id ${child.liveId}). Use steer_subagent or get_subagent_result.`;
					}
					if (child.status === "cooling") {
						return `${child.name} is still in tintinweb memory (id ${child.liveId}). Use Agent({ resume: "${child.liveId}" }).`;
					}
					return undefined;
				};
				const live = refuseLive(resolved);
				if (live) return { content: [{ type: "text", text: live }] };

				const agentMd = findAgentMd(resolved.type, ctx.cwd);
				if (!agentMd) {
					return {
						content: [{
							type: "text",
							text: `No local agent definition for ${resolved.type}; refusing disk resume to avoid identity drift.`,
						}],
					};
				}
				const spec = parseAgentSpec(readFileSync(agentMd, "utf8"));
				if (typeof spec === "string") {
					return { content: [{ type: "text", text: `${resolved.name}: ${spec}` }] };
				}

				const key = fileKey(resolved.file);
				if (resuming.has(key)) {
					return { content: [{ type: "text", text: `${resolved.name} is already being resumed in this process.` }] };
				}
				resuming.add(key);

				try {
					const again = statusOf(resolved);
					const liveAgain = refuseLive({ ...resolved, ...again });
					if (liveAgain) return { content: [{ type: "text", text: liveAgain }] };
					if (signal?.aborted) throw new Error("aborted");

					const modelRuntime = (ctx.modelRegistry as { runtime?: object }).runtime;

					const loader = new DefaultResourceLoader({
						cwd: ctx.cwd,
						agentDir: getAgentDir(),
						noExtensions: true,
						noSkills: true,
						noPromptTemplates: true,
						noThemes: true,
						noContextFiles: true,
						systemPrompt: spec.replacePrompt,
						appendSystemPromptOverride: () => [],
					});
					await loader.reload();
					if (signal?.aborted) throw new Error("aborted");

					const { session } = await createAgentSession({
						cwd: ctx.cwd,
						resourceLoader: loader,
						sessionManager: SessionManager.open(resolved.file, dirname(resolved.file)),
						tools: spec.tools,
						...(modelRuntime ? { modelRuntime: modelRuntime as never } : {}),
					});

					const abortNow = () => {
						void session.abort();
					};
					signal?.addEventListener("abort", abortNow, { once: true });
					if (signal?.aborted) abortNow();

					const startLen = session.messages.length;
					try {
						await session.prompt(prompt);
						if (signal?.aborted) throw new Error("aborted");
						const turn = thisTurnText(
							session.messages as Array<{
								role?: string;
								content?: unknown;
								stopReason?: string;
								errorMessage?: string;
							}>,
							startLen,
						);
						if (turn.error) throw new Error(turn.error);
						const clipped = truncateHead(turn.text ?? "", {
							maxBytes: DEFAULT_MAX_BYTES,
							maxLines: DEFAULT_MAX_LINES,
						});
						const note = clipped.truncated
							? `\n\n[truncated ${clipped.truncatedBy}; full turn is in the child jsonl]`
							: "";
						return {
							content: [{
								type: "text",
								text: `Resumed ${resolved.name} (same jsonl, not a tintinweb agent_id).\nDo not call get_subagent_result for this turn.\n\n${clipped.content}${note}`,
							}],
						};
					} finally {
						signal?.removeEventListener("abort", abortNow);
						session.dispose();
					}
				} finally {
					resuming.delete(key);
				}
			},
		});
	};

	pi.events.on("subagents:ready", register);
	pi.on("session_start", async () => {
		if (registered) return;
		const requestId = crypto.randomUUID();
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				unsub();
				resolve();
			}, 400);
			const unsub = pi.events.on(`subagents:rpc:ping:reply:${requestId}`, () => {
				clearTimeout(timer);
				unsub();
				register();
				resolve();
			});
			pi.events.emit("subagents:rpc:ping", { requestId });
		});
	});
}
