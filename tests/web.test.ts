// Run: node --test tests/web.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import web, { exaDateRange } from "../extensions/web.ts";

test("freshness maps to Exa published-date bounds", () => {
	const now = Date.parse("2026-10-02T00:00:00.000Z");
	assert.deepEqual(exaDateRange("pw", now), { startPublishedDate: "2026-09-25T00:00:00.000Z" });
	assert.deepEqual(exaDateRange("2026-01-01to2026-02-01"), { startPublishedDate: "2026-01-01T00:00:00.000Z", endPublishedDate: "2026-02-01T23:59:59.999Z" });
	assert.deepEqual(exaDateRange(undefined), {});
	assert.throws(() => exaDateRange("lastweek"), /Invalid freshness/);
});

test("web_search falls back to the other provider and says so", async () => {
	const tools: Record<string, any> = {};
	web({ registerTool: (t: any) => (tools[t.name] = t) } as any);
	const realFetch = globalThis.fetch;
	process.env.BRAVE_API_KEY = "b";
	process.env.EXA_API_KEY = "e";
	globalThis.fetch = (async (url: string) => String(url).includes("brave")
		? new Response("rate limited", { status: 429 })
		: Response.json({ results: [{ title: "From Exa", url: "https://example.com", highlights: ["hi"] }] })) as any;
	try {
		const out = (await tools.web_search.execute("id", { query: "q" })).content[0].text;
		assert.match(out, /Brave failed \(Brave HTTP 429/);
		assert.match(out, /results below are from Exa/);
		assert.match(out, /Title: From Exa/);
		globalThis.fetch = (async () => new Response("down", { status: 500 })) as any;
		await assert.rejects(tools.web_search.execute("id", { query: "q", mode: "semantic" }), /Exa failed[\s\S]*Brave failed/);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test("web_fetch caps the body size and resolves links against the final URL", async () => {
	const tools: Record<string, any> = {};
	web({ registerTool: (t: any) => (tools[t.name] = t) } as any);
	const realFetch = globalThis.fetch;
	const article = `<html><body><article><h1>T</h1><p>${"word ".repeat(60)}<a href="next">rel</a></p></article></body></html>`;
	globalThis.fetch = (async (url: string) => {
		if (url.endsWith("/big")) return new Response("x".repeat(6 * 1024 * 1024), { headers: { "content-type": "text/plain" } });
		// Simulate fetch having followed /old -> /docs/page.
		const response = new Response(article, { headers: { "content-type": "text/html" } });
		Object.defineProperty(response, "url", { value: "https://example.com/docs/page" });
		return response;
	}) as any;
	try {
		const out = (await tools.web_fetch.execute("id", { url: "https://example.com/old" })).content[0].text;
		assert.match(out, /\(https:\/\/example\.com\/docs\/next\)/);
		await assert.rejects(tools.web_fetch.execute("id", { url: "https://example.com/big" }), /larger than/);
	} finally {
		globalThis.fetch = realFetch;
	}
});
