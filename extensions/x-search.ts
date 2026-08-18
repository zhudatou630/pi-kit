import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const MODEL_ID = "grok-4.6";
const XAI_RESPONSES_URL = "https://api.x.ai/v1/responses";
const CONFIG_PATH = join(homedir(), ".pi", "agent", "x-search.json");
const TIMEOUT_MS = 180_000;

const BACKENDS = ["auto", "xai", "sub2api"] as const;
type Backend = (typeof BACKENDS)[number];
type ConcreteBackend = Exclude<Backend, "auto">;

interface StoredConfig {
	backend?: Backend;
}

interface ProviderAuth {
	backend: ConcreteBackend;
	endpoint: string;
	apiKey: string;
	headers: Record<string, string>;
}

interface Citation {
	url: string;
	title?: string;
}

function isBackend(value: unknown): value is Backend {
	return typeof value === "string" && BACKENDS.includes(value as Backend);
}

function loadBackend(): Backend {
	if (!existsSync(CONFIG_PATH)) return "auto";
	try {
		const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as StoredConfig;
		return isBackend(config.backend) ? config.backend : "auto";
	} catch {
		return "auto";
	}
}

function saveBackend(backend: Backend): void {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, `${JSON.stringify({ backend }, null, 2)}\n`, "utf8");
}

function requestSignal(signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function requestHeaders(headers: Record<string, string | null> | undefined): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers ?? {})) {
		if (value !== null) result[name] = value;
	}
	return result;
}

async function resolveProviderAuth(
	ctx: ExtensionContext,
	backend: ConcreteBackend,
): Promise<ProviderAuth | undefined> {
	const model = ctx.modelRegistry.find(backend, MODEL_ID);
	if (!model) return undefined;

	const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!resolved.ok || !resolved.apiKey) return undefined;

	const modelBaseUrl = (model as { baseUrl?: string }).baseUrl;
	const endpoint = backend === "xai"
		? XAI_RESPONSES_URL
		: `${String(modelBaseUrl ?? "").replace(/\/$/, "")}/responses`;
	if (backend === "sub2api" && !modelBaseUrl) return undefined;

	return {
		backend,
		endpoint,
		apiKey: resolved.apiKey,
		headers: requestHeaders(resolved.headers),
	};
}

async function selectProviderAuth(
	ctx: ExtensionContext,
	requested: Backend,
): Promise<ProviderAuth> {
	if (requested !== "auto") {
		const auth = await resolveProviderAuth(ctx, requested);
		if (auth) return auth;
		throw new Error(`No usable ${requested}/${MODEL_ID} credentials are configured in Pi.`);
	}

	for (const backend of ["xai", "sub2api"] as const) {
		const auth = await resolveProviderAuth(ctx, backend);
		if (auth) return auth;
	}
	throw new Error(`No usable xai/${MODEL_ID} or sub2api/${MODEL_ID} credentials are configured in Pi.`);
}

function normalizeHandle(value: string): string {
	return value.trim().replace(/^@+/, "");
}

function cleanAnswer(text: string): string {
	return text
		.replace(/(?:show\s+)?(?:render_inline_citation|displaycitation)\s+with\s+citation_id\s+is\s+\d+/gi, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function parseResponse(data: Record<string, unknown>): {
	answer: string;
	citations: Citation[];
	searchSteps: number;
} {
	const output = Array.isArray(data.output) ? data.output : [];
	const answerParts: string[] = [];
	const citations: Citation[] = [];
	const seen = new Set<string>();
	let searchSteps = 0;

	const addCitation = (url: unknown, title?: unknown) => {
		if (typeof url !== "string" || !url.startsWith("http") || seen.has(url)) return;
		seen.add(url);
		citations.push({
			url,
			...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}),
		});
	};

	for (const rawItem of output) {
		if (!rawItem || typeof rawItem !== "object") continue;
		const item = rawItem as Record<string, unknown>;
		if (item.type === "x_search_call" || item.type === "custom_tool_call") {
			searchSteps += 1;
		}

		if (item.type === "x_search_call" && item.action && typeof item.action === "object") {
			const sources = (item.action as Record<string, unknown>).sources;
			if (Array.isArray(sources)) {
				for (const rawSource of sources) {
					if (!rawSource || typeof rawSource !== "object") continue;
					const source = rawSource as Record<string, unknown>;
					addCitation(source.url, source.title);
				}
			}
		}

		if (item.type !== "message" || !Array.isArray(item.content)) continue;
		for (const rawPart of item.content) {
			if (!rawPart || typeof rawPart !== "object") continue;
			const part = rawPart as Record<string, unknown>;
			if (typeof part.text === "string" && part.text.trim()) answerParts.push(part.text);
			if (!Array.isArray(part.annotations)) continue;
			for (const rawAnnotation of part.annotations) {
				if (!rawAnnotation || typeof rawAnnotation !== "object") continue;
				const annotation = rawAnnotation as Record<string, unknown>;
				if (annotation.type === "url_citation") addCitation(annotation.url, annotation.title);
			}
		}
	}

	if (Array.isArray(data.citations)) {
		for (const rawCitation of data.citations) {
			if (typeof rawCitation === "string") addCitation(rawCitation);
			else if (rawCitation && typeof rawCitation === "object") {
				const citation = rawCitation as Record<string, unknown>;
				addCitation(citation.url, citation.title);
			}
		}
	}

	return {
		answer: cleanAnswer(answerParts.join("\n")),
		citations,
		searchSteps,
	};
}

export default function xSearchExtension(pi: ExtensionAPI) {
	let defaultBackend = loadBackend();

	pi.registerCommand("x-search-backend", {
		description: "Switch the default X Search backend: auto, xai, or sub2api",
		handler: async (args, ctx) => {
			const raw = args.trim().toLowerCase();
			if (raw === "status") {
				ctx.ui.notify(`X Search backend: ${defaultBackend}`, "info");
				return;
			}

			let selected: string | undefined = raw || undefined;
			if (!selected && ctx.hasUI) {
				selected = await ctx.ui.select("X Search backend", [...BACKENDS]);
			}
			if (!isBackend(selected)) {
				ctx.ui.notify("Usage: /x-search-backend [auto|xai|sub2api|status]", "warning");
				return;
			}

			try {
				saveBackend(selected);
				defaultBackend = selected;
				ctx.ui.notify(`X Search backend set to ${selected}`, "info");
			} catch (error) {
				ctx.ui.notify(`Failed to save X Search backend: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.registerTool({
		name: "x_search",
		label: "X Search",
		description:
			"Search X (Twitter) through xAI's native X Search. Supports account and date filters plus image/video understanding. The backend can be xai, sub2api, or the configured default. Returns a synthesized answer with exact X citations; degraded=true means no cited X evidence was returned.",
		promptSnippet: "Search current X posts, accounts, discussions, and threads with exact citations",
		promptGuidelines: [
			"Use x_search for current information from X, including posts by a specific account, X discussions, and X threads; use web_search for the general web.",
		],
		parameters: Type.Object({
			query: Type.String({ minLength: 1, description: "What to find or answer from X." }),
			backend: Type.Optional(StringEnum(BACKENDS, { description: "Per-call backend override. Omit to use the configured default." })),
			allowed_x_handles: Type.Optional(Type.Array(Type.String(), {
				maxItems: 20,
				description: "Only consider these X handles. Leading @ is optional.",
			})),
			excluded_x_handles: Type.Optional(Type.Array(Type.String(), {
				maxItems: 20,
				description: "Exclude these X handles. Cannot be combined with allowed_x_handles.",
			})),
			from_date: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Inclusive start date in YYYY-MM-DD format." })),
			to_date: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Inclusive end date in YYYY-MM-DD format." })),
			enable_image_understanding: Type.Optional(Type.Boolean({ description: "Analyze images attached to matching posts." })),
			enable_video_understanding: Type.Optional(Type.Boolean({ description: "Analyze videos attached to matching posts." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const query = params.query.trim();
			const allowed = (params.allowed_x_handles ?? []).map(normalizeHandle).filter(Boolean);
			const excluded = (params.excluded_x_handles ?? []).map(normalizeHandle).filter(Boolean);
			if (allowed.length > 0 && excluded.length > 0) {
				throw new Error("allowed_x_handles and excluded_x_handles are mutually exclusive.");
			}
			if (params.from_date && params.to_date && params.from_date > params.to_date) {
				throw new Error("from_date must not be later than to_date.");
			}

			const requestedBackend = params.backend ?? defaultBackend;
			const auth = await selectProviderAuth(ctx, requestedBackend);
			onUpdate?.({
				content: [{ type: "text", text: `Searching X via ${auth.backend}...` }],
				details: { backend: auth.backend },
			});

			const tool: Record<string, unknown> = { type: "x_search" };
			if (allowed.length > 0) tool.allowed_x_handles = allowed;
			if (excluded.length > 0) tool.excluded_x_handles = excluded;
			if (params.from_date) tool.from_date = params.from_date;
			if (params.to_date) tool.to_date = params.to_date;
			if (params.enable_image_understanding !== undefined) {
				tool.enable_image_understanding = params.enable_image_understanding;
			}
			if (params.enable_video_understanding !== undefined) {
				tool.enable_video_understanding = params.enable_video_understanding;
			}

			const response = await fetch(auth.endpoint, {
				method: "POST",
				headers: {
					...auth.headers,
					Authorization: `Bearer ${auth.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: MODEL_ID,
					input: query,
					tools: [tool],
					tool_choice: "required",
					store: false,
					stream: false,
				}),
				signal: requestSignal(signal),
			});

			const responseText = await response.text();
			let data: Record<string, unknown>;
			try {
				data = JSON.parse(responseText) as Record<string, unknown>;
			} catch {
				throw new Error(`${auth.backend} X Search returned invalid JSON (HTTP ${response.status}).`);
			}
			if (!response.ok) {
				const rawError = data.error;
				const message = rawError && typeof rawError === "object"
					? (rawError as Record<string, unknown>).message
					: rawError;
				throw new Error(`${auth.backend} X Search HTTP ${response.status}: ${String(message ?? "unknown error").slice(0, 500)}`);
			}

			const parsed = parseResponse(data);
			const degraded = parsed.citations.length === 0;
			const result = {
				backend: auth.backend,
				model: MODEL_ID,
				query,
				answer: parsed.answer,
				citations: parsed.citations,
				degraded,
				degraded_reason: degraded ? "xAI returned no cited X sources" : null,
			};

			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: { ...result, searchSteps: parsed.searchSteps },
			};
		},
	});
}