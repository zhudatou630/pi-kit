import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_MODEL = "grok-4.6";
const XAI_RESPONSES_URL = "https://api.x.ai/v1/responses";
const CONFIG_PATH = join(homedir(), ".pi", "agent", "x-search.json");
const TIMEOUT_MS = 180_000;

const BACKENDS = ["sub2api", "xai"] as const;
type Backend = (typeof BACKENDS)[number];
const DEFAULT_BACKEND: Backend = "sub2api";

interface Config {
	backend: Backend;
	model: string;
}

interface ProviderAuth {
	backend: Backend;
	endpoint: string;
	apiKey: string;
	headers: Record<string, string>;
}

interface Citation {
	url: string;
	title?: string;
	posted_at?: string;
	outside_date_range?: true;
}

const X_EPOCH_MS = 1288834974657n;
const SNOWFLAKE_START_MS = Date.UTC(2010, 10, 4);

// X post IDs are snowflakes: (id >> 22) + X epoch = creation time in ms. Independent of Grok's wording.
function postedAt(url: string): string | undefined {
	const match = /\/status(?:es)?\/(\d{15,20})(?:\D|$)/.exec(url);
	if (!match) return undefined;
	const ms = Number((BigInt(match[1]) >> 22n) + X_EPOCH_MS);
	if (ms < SNOWFLAKE_START_MS || ms > Date.now() + 86_400_000) return undefined;
	return new Date(ms).toISOString();
}

// Mirrors xAI semantics: from_date 00:00 UTC inclusive, to_date exclusive.
function markDates(citations: Citation[], fromDate?: string, toDate?: string): Citation[] {
	const from = fromDate ? Date.parse(`${fromDate}T00:00:00Z`) : undefined;
	const to = toDate ? Date.parse(`${toDate}T00:00:00Z`) : undefined;
	return citations.map((citation) => {
		const posted = postedAt(citation.url);
		if (!posted) return citation;
		const ms = Date.parse(posted);
		const outside = (from !== undefined && ms < from) || (to !== undefined && ms >= to);
		return { ...citation, posted_at: posted, ...(outside ? { outside_date_range: true as const } : {}) };
	});
}

function isBackend(value: unknown): value is Backend {
	return typeof value === "string" && BACKENDS.includes(value as Backend);
}

// Unknown or legacy values (e.g. the removed "auto") fall back to defaults.
function loadConfig(): Config {
	const config: Config = { backend: DEFAULT_BACKEND, model: DEFAULT_MODEL };
	if (!existsSync(CONFIG_PATH)) return config;
	try {
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
		if (isBackend(raw.backend)) config.backend = raw.backend;
		if (typeof raw.model === "string" && raw.model.trim()) config.model = raw.model.trim();
	} catch {
		// Keep defaults when the file is unreadable.
	}
	return config;
}

function saveConfig(config: Config): void {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
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

function grokModelIds(ctx: ExtensionContext, backend: Backend): string[] {
	return ctx.modelRegistry
		.getAll()
		.filter((model) => model.provider === backend && /grok/i.test(model.id))
		.map((model) => model.id)
		.sort();
}

// No fallback between backends: the user picks one with /x-search-backend.
async function resolveProviderAuth(ctx: ExtensionContext, config: Config): Promise<ProviderAuth> {
	const { backend, model: modelId } = config;
	const switchHint = "Use /x-search-backend or /x-search-model to change it.";
	const model = ctx.modelRegistry.find(backend, modelId);
	if (!model) {
		const available = grokModelIds(ctx, backend);
		throw new Error(
			`Model ${backend}/${modelId} is not configured in Pi. Available grok models on ${backend}: ${available.join(", ") || "none"}. ${switchHint}`,
		);
	}

	const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!resolved.ok || !resolved.apiKey) {
		throw new Error(`No usable ${backend} API key is configured in Pi. ${switchHint}`);
	}

	const modelBaseUrl = (model as { baseUrl?: string }).baseUrl;
	if (backend === "sub2api" && !modelBaseUrl) {
		throw new Error("The sub2api provider has no baseUrl in Pi's models.json.");
	}
	const endpoint = backend === "xai"
		? XAI_RESPONSES_URL
		: `${String(modelBaseUrl).replace(/\/$/, "")}/responses`;

	return {
		backend,
		endpoint,
		apiKey: resolved.apiKey,
		headers: requestHeaders(resolved.headers),
	};
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

// One server-side X search Grok ran, e.g. x_keyword_search {"query":"from:elonmusk","mode":"Latest"}.
interface SearchCall {
	function: string;
	args: unknown;
}

interface Coverage {
	x_posts_fetched: number | null;
	x_users_fetched: number | null;
}

function parseSearchArgs(input: unknown): unknown {
	if (typeof input !== "string") return input ?? null;
	try {
		return JSON.parse(input);
	} catch {
		return input;
	}
}

function parseCoverage(data: Record<string, unknown>): Coverage {
	const usage = data.usage && typeof data.usage === "object" ? data.usage as Record<string, unknown> : {};
	const details = usage.server_side_tool_usage_details && typeof usage.server_side_tool_usage_details === "object"
		? usage.server_side_tool_usage_details as Record<string, unknown>
		: {};
	const count = (value: unknown) => (typeof value === "number" ? value : null);
	return {
		x_posts_fetched: count(details.x_posts_fetched),
		x_users_fetched: count(details.x_users_fetched),
	};
}

function parseResponse(data: Record<string, unknown>): {
	answer: string;
	citations: Citation[];
	searches: SearchCall[];
} {
	const output = Array.isArray(data.output) ? data.output : [];
	const answerParts: string[] = [];
	const citations: Citation[] = [];
	const searches: SearchCall[] = [];
	const seen = new Set<string>();

	const addCitation = (url: unknown, title?: unknown) => {
		if (typeof url !== "string" || !url.startsWith("http") || seen.has(url)) return;
		seen.add(url);
		const cleanTitle = typeof title === "string" ? title.trim() : "";
		// xAI often sets title to the URL itself; drop it as noise.
		citations.push({ url, ...(cleanTitle && cleanTitle !== url ? { title: cleanTitle } : {}) });
	};

	for (const rawItem of output) {
		if (!rawItem || typeof rawItem !== "object") continue;
		const item = rawItem as Record<string, unknown>;
		if (item.type === "custom_tool_call") {
			searches.push({ function: String(item.name ?? "unknown"), args: parseSearchArgs(item.input) });
		} else if (item.type === "x_search_call") {
			searches.push({ function: "x_search", args: parseSearchArgs((item.action as Record<string, unknown> | undefined)?.query) });
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
		searches,
	};
}

export default function xSearchExtension(pi: ExtensionAPI) {
	const describe = (config: Config) => `X Search: ${config.backend}/${config.model}`;

	const update = (ctx: ExtensionContext, change: Partial<Config>) => {
		// Re-read so changes made in other sessions are not overwritten.
		const next = { ...loadConfig(), ...change };
		try {
			saveConfig(next);
			ctx.ui.notify(`${describe(next)} (saved)`, "info");
		} catch (error) {
			ctx.ui.notify(`Failed to save X Search config: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	};

	pi.registerCommand("x-search-backend", {
		description: "Switch the X Search backend: sub2api or xai",
		handler: async (args, ctx) => {
			const raw = args.trim().toLowerCase();
			if (raw === "status") {
				ctx.ui.notify(describe(loadConfig()), "info");
				return;
			}

			let selected: string | undefined = raw || undefined;
			if (!selected && ctx.hasUI) {
				selected = await ctx.ui.select("X Search backend", [...BACKENDS]);
			}
			if (!isBackend(selected)) {
				ctx.ui.notify("Usage: /x-search-backend [sub2api|xai|status]", "warning");
				return;
			}
			update(ctx, { backend: selected });
		},
	});

	pi.registerCommand("x-search-model", {
		description: "Switch the grok model used by X Search",
		handler: async (args, ctx) => {
			const raw = args.trim();
			const config = loadConfig();
			if (raw === "status") {
				ctx.ui.notify(describe(config), "info");
				return;
			}

			const available = grokModelIds(ctx, config.backend);
			let selected: string | undefined = raw || undefined;
			if (!selected && ctx.hasUI && available.length > 0) {
				selected = await ctx.ui.select(`X Search model (${config.backend})`, available);
			}
			if (!selected) {
				ctx.ui.notify(`Usage: /x-search-model [${available.join("|") || "model-id"}|status]`, "warning");
				return;
			}
			if (!ctx.modelRegistry.find(config.backend, selected)) {
				ctx.ui.notify(`${config.backend}/${selected} is not configured in Pi. Available: ${available.join(", ") || "none"}`, "warning");
				return;
			}
			update(ctx, { model: selected });
		},
	});

	pi.registerTool({
		name: "x_search",
		label: "X Search",
		description:
			"Search X (Twitter) through xAI's native X Search. Supports account and date filters plus image/video understanding. Returns Grok's synthesized answer (raw post text is not available) with exact X citations, each cited post's posted_at decoded from its post ID (outside_date_range=true if it falls outside from_date/to_date), the searches Grok actually ran, and how many posts/users it fetched (coverage); degraded=true means no cited X evidence was returned.",
		promptSnippet: "Search current X posts, accounts, discussions, and threads with exact citations",
		promptGuidelines: [
			"Use x_search for current information from X, including posts by a specific account, X discussions, and X threads; use web_search for the general web.",
		],
		parameters: Type.Object({
			query: Type.String({ minLength: 1, description: "What to find or answer from X." }),
			allowed_x_handles: Type.Optional(Type.Array(Type.String(), {
				maxItems: 20,
				description: "Only consider these X handles. Leading @ is optional.",
			})),
			excluded_x_handles: Type.Optional(Type.Array(Type.String(), {
				maxItems: 20,
				description: "Exclude these X handles. Cannot be combined with allowed_x_handles.",
			})),
			from_date: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Start date (YYYY-MM-DD, from 00:00 UTC, inclusive)." })),
			to_date: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "End date (YYYY-MM-DD, exclusive: to include a day, use the day after it)." })),
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
			if (params.from_date && params.to_date && params.from_date >= params.to_date) {
				throw new Error("from_date must be earlier than to_date (to_date is exclusive).");
			}

			const config = loadConfig();
			const auth = await resolveProviderAuth(ctx, config);
			onUpdate?.({
				content: [{ type: "text", text: `Searching X via ${auth.backend}/${config.model}...` }],
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
					model: config.model,
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
				model: config.model,
				query,
				answer: parsed.answer,
				citations: markDates(parsed.citations, params.from_date, params.to_date),
				searches: parsed.searches,
				coverage: parseCoverage(data),
				degraded,
				degraded_reason: degraded ? "xAI returned no cited X sources" : null,
			};

			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
	});
}