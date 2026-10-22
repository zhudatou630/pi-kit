// Web search (Brave or Exa, switched by the user via /web-search-backend) + page reading as native tools, ported from
// badlogic/pi-skills brave-search (search.js / content.js). Native tools work without bash (chat-only presets, pi-chat).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const configPath = () => join(homedir(), ".pi", "agent", "web-search.json"); // resolved per call so tests can swap HOME
const BACKENDS = ["brave", "exa-lite", "exa-auto", "tinyfish"] as const;
type Backend = (typeof BACKENDS)[number];

function loadBackend(): Backend {
	try {
		const { backend } = JSON.parse(readFileSync(configPath(), "utf8"));
		return BACKENDS.includes(backend) ? backend : "brave";
	} catch {
		return "brave"; // no config yet
	}
}

function saveBackend(backend: Backend): void {
	mkdirSync(dirname(configPath()), { recursive: true });
	writeFileSync(configPath(), `${JSON.stringify({ backend }, null, 2)}\n`, "utf8");
}

const PAGE_CHARS = 20_000; // web_fetch page size; a skill relies on bash truncation instead
const RESULT_CONTENT_CHARS = 5_000; // same as search.js --content
const MAX_BYTES = 5 * 1024 * 1024; // the fetch runs inside the shared pi-web server process
const MAX_PDF_BYTES = 50 * 1024 * 1024; // annual reports often run 10-20 MB
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function text(value: string) {
	return { content: [{ type: "text" as const, text: value }], details: {} };
}

function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(ms);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readBytes(response: Response, limit: number): Promise<Buffer> {
	const chunks: Uint8Array[] = [];
	let size = 0;
	// Throwing inside for-await cancels the stream.
	for await (const chunk of response.body ?? []) {
		size += chunk.length;
		if (size > limit) throw new Error(`Page is larger than ${limit} bytes`);
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

async function readBody(response: Response): Promise<string> {
	const bytes = await readBytes(response, MAX_BYTES);
	// Older Chinese sites are GBK; take the charset from the header, else from <meta> near the top of the page.
	const charset = /charset\s*=\s*["']?\s*([\w-]+)/i.exec(response.headers.get("content-type") ?? "")?.[1]
		?? /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(bytes.subarray(0, 4096).toString("latin1"))?.[1];
	try {
		return new TextDecoder(charset ?? "utf-8").decode(bytes);
	} catch {
		return new TextDecoder().decode(bytes); // unknown charset label
	}
}

// --- Extraction, same as content.js / search.js.
function htmlToMarkdown(TurndownService: any, gfm: any, html: string): string {
	const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
	turndown.use(gfm);
	turndown.addRule("removeEmptyLinks", {
		filter: (node: any) => node.nodeName === "A" && !node.textContent?.trim(),
		replacement: () => "",
	});
	return turndown.turndown(html)
		.replace(/\[\\?\[\s*\\?\]\]\([^)]*\)/g, "")
		.replace(/ +/g, " ")
		.replace(/\s+,/g, ",")
		.replace(/\s+\./g, ".")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// Text layer only: scanned PDFs have none. Tables come out as space-separated lines.
async function readPdf(bytes: Buffer): Promise<string> {
	const { extractText, getDocumentProxy } = await import("unpdf"); // lazy, like jsdom
	// Chinese fonts without embedded mappings need pdf.js CMaps (from pdfjs-dist). unpdf's own default passes a
	// file:// URL its bundled pdf.js cannot read, so give a plain directory path.
	const cMapUrl = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "cmaps/");
	const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0, cMapUrl, cMapPacked: true });
	let pages: string[];
	try {
		({ text: pages } = await extractText(pdf, { mergePages: false }));
	} finally {
		await pdf.loadingTask.destroy(); // unpdf leaves caller-made proxies alive; free them in the shared server process
	}
	const body = pages.map((page, i) => `--- Page ${i + 1} ---\n${page.trim()}`).join("\n\n");
	if (!pages.some((page) => page.trim())) throw new Error("This PDF has no text layer (probably scanned).");
	return body;
}

async function readPage(rawUrl: string, signal: AbortSignal): Promise<string> {
	const response = await fetch(rawUrl, {
		signal,
		headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
	});
	const type = response.headers.get("content-type") ?? "";
	const isPdf = /pdf/i.test(type) || (/octet-stream/i.test(type) && /\.pdf(\?|$)/i.test(response.url || rawUrl));
	if (response.ok && isPdf) return readPdf(await readBytes(response, MAX_PDF_BYTES));
	const isHtml = !type || /html|xml/i.test(type);
	if (!response.ok || !(isHtml || /^(text\/|application\/(json|javascript))/i.test(type))) {
		await response.body?.cancel();
		throw new Error(response.ok ? `Unsupported content type: ${type}` : `HTTP ${response.status}: ${response.statusText}`);
	}
	const body = await readBody(response);
	if (!isHtml) return body;
	const url = response.url || rawUrl; // final URL after redirects, base for relative links

	// Loaded lazily: jsdom is slow to import and most sessions never fetch a page.
	const [{ Readability }, { JSDOM }, { default: TurndownService }, { gfm }] = await Promise.all([
		import("@mozilla/readability"), import("jsdom"), import("turndown"), import("turndown-plugin-gfm"),
	]);
	const article = new Readability(new JSDOM(body, { url }).window.document).parse();
	if (article?.content) {
		return `${article.title ? `# ${article.title}\n\n` : ""}${htmlToMarkdown(TurndownService, gfm, article.content)}`;
	}
	const doc = new JSDOM(body, { url }).window.document;
	doc.querySelectorAll("script, style, noscript, nav, header, footer, aside").forEach((el: any) => el.remove());
	const title = doc.querySelector("title")?.textContent?.trim();
	const main = doc.querySelector("main, article, [role='main'], .content, #content") ?? doc.body;
	const html = main?.innerHTML ?? "";
	if (html.trim().length <= 100) throw new Error("Could not extract readable content from this page. It may need JavaScript or a login; use the browser skill.");
	return `${title ? `# ${title}\n\n` : ""}${htmlToMarkdown(TurndownService, gfm, html)}`;
}

// A dropped connection (fetch itself throws TypeError) gets one silent retry; HTTP errors, timeouts and
// response-parsing errors do not.
async function apiFetch(url: string, init: RequestInit & { signal: AbortSignal }): Promise<Response> {
	try {
		return await fetch(url, init);
	} catch (error) {
		if (!(error instanceof TypeError) || init.signal.aborted) throw error;
		return await fetch(url, init);
	}
}

interface Hit { title?: string; url?: string; age?: string; snippet?: string; content?: string }
type SearchParams = { query: string; count?: number; freshness?: string; country?: string; content?: boolean };

async function braveSearch(p: SearchParams, count: number, signal: AbortSignal): Promise<Hit[]> {
	const apiKey = process.env.BRAVE_API_KEY;
	if (!apiKey) throw new Error("BRAVE_API_KEY is not set in the Pi process environment.");
	const query = new URLSearchParams({ q: p.query, count: String(count), country: p.country ?? "US" });
	if (p.freshness) query.append("freshness", p.freshness);
	const response = await apiFetch(`https://api.search.brave.com/res/v1/web/search?${query}`, {
		headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
		signal,
	});
	if (!response.ok) throw new Error(`Brave HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
	const data = await response.json() as { web?: { results?: Array<Record<string, string>> } };
	return (data.web?.results ?? []).slice(0, count)
		.map((r) => ({ title: r.title, url: r.url, age: r.age || r.page_age, snippet: r.description }));
}

// Brave freshness syntax -> Exa published-date bounds.
export function exaDateRange(freshness: string | undefined, now = Date.now()): Record<string, string> {
	if (!freshness) return {};
	const days = ({ pd: 1, pw: 7, pm: 31, py: 366 } as Record<string, number>)[freshness];
	if (days) return { startPublishedDate: new Date(now - days * 86_400_000).toISOString() };
	const range = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/.exec(freshness);
	if (range) return { startPublishedDate: `${range[1]}T00:00:00.000Z`, endPublishedDate: `${range[2]}T23:59:59.999Z` };
	throw new Error(`Invalid freshness: ${freshness}`);
}

// Exa search types: lite $4/1k (cheaper, cache only), auto $7/1k (best single search).
async function exaSearch(type: "lite" | "auto", p: SearchParams, count: number, signal: AbortSignal): Promise<Hit[]> {
	const apiKey = process.env.EXA_API_KEY;
	if (!apiKey) throw new Error("EXA_API_KEY is not set in the Pi process environment.");
	const response = await apiFetch("https://api.exa.ai/search", {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-api-key": apiKey },
		body: JSON.stringify({
			query: p.query, type, numResults: count, userLocation: (p.country ?? "US").toLowerCase(), ...exaDateRange(p.freshness),
			// Default highlights run ~8k chars per result; cap near a Brave snippet.
			contents: { highlights: { maxCharacters: 400 }, ...(p.content ? { text: { maxCharacters: RESULT_CONTENT_CHARS } } : {}) },
		}),
		signal,
	});
	if (!response.ok) throw new Error(`Exa HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
	const data = await response.json() as { results?: Array<{ title?: string; url?: string; publishedDate?: string; highlights?: string[]; text?: string }> };
	return (data.results ?? []).map((r) => ({
		title: r.title, url: r.url, age: r.publishedDate?.slice(0, 10), snippet: r.highlights?.join(" … "), content: r.text,
	}));
}

// TinyFish: free up to 12k requests/day and 30/min; ~10 results per page, no count parameter.
export function tinyfishQuery(p: SearchParams, now = Date.now()): URLSearchParams {
	const query = new URLSearchParams({ query: p.query, location: (p.country ?? "US").toUpperCase() });
	const range = exaDateRange(p.freshness, now);
	if (range.startPublishedDate) query.append("after_date", range.startPublishedDate.slice(0, 10));
	if (range.endPublishedDate) query.append("before_date", range.endPublishedDate.slice(0, 10));
	return query;
}

async function tinyfishSearch(p: SearchParams, count: number, signal: AbortSignal): Promise<Hit[]> {
	const apiKey = process.env.TINYFISH_API_KEY;
	if (!apiKey) throw new Error("TINYFISH_API_KEY is not set in the Pi process environment.");
	const response = await apiFetch(`https://api.search.tinyfish.ai?${tinyfishQuery(p)}`, { headers: { "X-API-Key": apiKey }, signal });
	if (!response.ok) throw new Error(`TinyFish HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
	const data = await response.json() as { results?: Array<Record<string, string>> };
	return (data.results ?? []).slice(0, count)
		.map((r) => ({ title: r.title, url: r.url, age: r.date || r.published_date, snippet: r.snippet }));
}

export default function web(pi: ExtensionAPI) {
	type Search = (p: SearchParams, count: number, signal: AbortSignal) => Promise<Hit[]>;
	const providers: Record<Backend, readonly [string, Search]> = {
		brave: ["Brave", braveSearch],
		"exa-lite": ["Exa lite", (...a) => exaSearch("lite", ...a)],
		"exa-auto": ["Exa auto", (...a) => exaSearch("auto", ...a)],
		tinyfish: ["TinyFish", tinyfishSearch],
	};
	const run = ([, search]: readonly [string, Search], p: SearchParams, count: number, signal?: AbortSignal) =>
		search(p, count, withTimeout(30_000, signal));

	pi.registerCommand("web-search-backend", {
		description: "Switch the web_search backend: brave, exa-lite, exa-auto or tinyfish",
		handler: async (args, ctx) => {
			let selected: string | undefined = args.trim().toLowerCase() || undefined;
			if (selected === "status") return ctx.ui.notify(`web_search backend: ${loadBackend()}`, "info");
			if (!selected && ctx.hasUI) selected = await ctx.ui.select(`web_search backend (now ${loadBackend()})`, [...BACKENDS]);
			if (!BACKENDS.includes(selected as Backend)) {
				return ctx.ui.notify("Usage: /web-search-backend [brave|exa-lite|exa-auto|tinyfish|status]", "warning");
			}
			try {
				saveBackend(selected as Backend);
				ctx.ui.notify(`web_search backend set to ${selected}`, "info");
			} catch (error) {
				ctx.ui.notify(`Failed to save backend: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the web. Returns title, link, age and snippet per result; content=true also returns each page's readable text (first 5000 chars).",
		promptSnippet: "Search the web for current or external information",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", minLength: 1 },
				count: { type: "integer", minimum: 1, maximum: 10, description: "Number of results (default 5)." },
				freshness: { type: "string", description: "pd (day), pw (week), pm (month), py (year), or YYYY-MM-DDtoYYYY-MM-DD." },
				country: { type: "string", description: "Two-letter country code (default US)." },
				content: { type: "boolean", description: "Also fetch each result's readable content." },
			},
			required: ["query"],
		} as any,
		async execute(_id, params: SearchParams, signal) {
			const count = params.count ?? 5;
			// Fallback when the selected backend errors (e.g. quota used up): free TinyFish, or Exa lite if TinyFish is selected.
			const backend = loadBackend(); // read per search so a switch in one session reaches all open sessions
			const primary = providers[backend];
			const backup = providers[backend === "tinyfish" ? "exa-lite" : "tinyfish"];
			let results: Hit[];
			let note = "";
			try {
				results = await run(primary, params, count, signal);
			} catch (error) {
				if (signal?.aborted) throw error;
				const reason = error instanceof Error ? error.message : String(error);
				try {
					results = await run(backup, params, count, signal);
				} catch (backupError) {
					throw new Error(`${primary[0]} failed: ${reason}\n${backup[0]} failed: ${backupError instanceof Error ? backupError.message : String(backupError)}`);
				}
				note = `[${primary[0]} failed (${reason.slice(0, 200)}); results below are from ${backup[0]}.]\n\n`;
			}
			if (results.length === 0) return text(`${note}No results found.`);

			const blocks = await Promise.all(results.map(async (r, i) => {
				const lines = [`--- Result ${i + 1} ---`, `Title: ${r.title ?? ""}`, `Link: ${r.url ?? ""}`];
				if (r.age) lines.push(`Age: ${r.age}`);
				lines.push(`Snippet: ${r.snippet ?? ""}`);
				if (params.content && r.url) {
					const page = r.content ?? await readPage(r.url, withTimeout(10_000, signal)).catch((e: Error) => {
						signal?.throwIfAborted();
						return `(Error: ${e.message})`;
					});
					lines.push(`Content:\n${page.slice(0, RESULT_CONTENT_CHARS)}`);
				}
				return lines.join("\n");
			}));
			return text(note + blocks.join("\n\n"));
		},
	});

	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description: `Fetch a URL and return its readable content as markdown, ${PAGE_CHARS} characters per call; pass offset to continue a long page.`,
		promptSnippet: "Read a web page as markdown",
		parameters: {
			type: "object",
			properties: {
				url: { type: "string", minLength: 1 },
				offset: { type: "integer", minimum: 0, description: "Character offset to continue from." },
			},
			required: ["url"],
		} as any,
		async execute(_id, params: { url: string; offset?: number }, signal) {
			const page = await readPage(params.url, withTimeout(15_000, signal));
			const offset = params.offset ?? 0;
			const slice = page.slice(offset, offset + PAGE_CHARS);
			const end = offset + slice.length;
			const footer = end < page.length
				? `\n\n[Showing ${offset}-${end} of ${page.length} chars. Continue with offset ${end}.]`
				: offset > 0 ? `\n\n[End of page, ${page.length} chars.]` : "";
			return text((slice || "(No content at this offset.)") + footer);
		},
	});
}
