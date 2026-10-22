// Run: node --test tests/web.test.ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import web, { exaDateRange, tinyfishQuery } from "../extensions/web.ts";

test("freshness maps to Exa published-date bounds", () => {
	const now = Date.parse("2026-10-02T00:00:00.000Z");
	assert.deepEqual(exaDateRange("pw", now), { startPublishedDate: "2026-09-25T00:00:00.000Z" });
	assert.deepEqual(exaDateRange("2026-01-01to2026-02-01"), { startPublishedDate: "2026-01-01T00:00:00.000Z", endPublishedDate: "2026-02-01T23:59:59.999Z" });
	assert.deepEqual(exaDateRange(undefined), {});
	assert.throws(() => exaDateRange("lastweek"), /Invalid freshness/);
	assert.equal(String(tinyfishQuery({ query: "q", freshness: "pw", country: "cn" }, now)), "query=q&location=CN&after_date=2026-09-25");
	assert.equal(String(tinyfishQuery({ query: "q", freshness: "2026-01-01to2026-02-01" })), "query=q&location=US&after_date=2026-01-01&before_date=2026-02-01");
});

test("web_search falls back to the other provider and says so", async () => {
	process.env.HOME = mkdtempSync(join(tmpdir(), "web-test-")); // no saved backend -> default brave
	const tools: Record<string, any> = {};
	web({ registerTool: (t: any) => (tools[t.name] = t), registerCommand: () => {} } as any);
	const realFetch = globalThis.fetch;
	process.env.BRAVE_API_KEY = "b";
	process.env.TINYFISH_API_KEY = "t";
	globalThis.fetch = (async (url: string) => String(url).includes("brave")
		? new Response("rate limited", { status: 429 })
		: Response.json({ results: [{ title: "From TinyFish", url: "https://example.com", snippet: "hi" }] })) as any;
	try {
		const out = (await tools.web_search.execute("id", { query: "q" })).content[0].text;
		assert.match(out, /Brave failed \(Brave HTTP 429/);
		assert.match(out, /results below are from TinyFish/);
		assert.match(out, /Title: From TinyFish/);
		globalThis.fetch = (async () => new Response("down", { status: 500 })) as any;
		await assert.rejects(tools.web_search.execute("id", { query: "q" }), /Brave failed[\s\S]*TinyFish failed/);
		// A dropped connection is retried once, silently.
		let calls = 0;
		globalThis.fetch = (async () => {
			if (++calls === 1) throw new TypeError("fetch failed");
			return Response.json({ web: { results: [{ title: "Retried", url: "https://example.com" }] } });
		}) as any;
		const retried = (await tools.web_search.execute("id", { query: "q" })).content[0].text;
		assert.equal(calls, 2);
		assert.match(retried, /^--- Result 1 ---\nTitle: Retried/);
		// A bad response body is not retried: Brave is called once, then TinyFish.
		const hosts: string[] = [];
		globalThis.fetch = (async (url: string) => {
			hosts.push(new URL(url).host);
			return url.includes("brave") ? Response.json(null) : Response.json({ results: [] });
		}) as any;
		await tools.web_search.execute("id", { query: "q" });
		assert.deepEqual(hosts, ["api.search.brave.com", "api.search.tinyfish.ai"]);
		// The saved backend is read per search; TinyFish falls back to Exa lite.
		mkdirSync(join(process.env.HOME!, ".pi", "agent"), { recursive: true });
		writeFileSync(join(process.env.HOME!, ".pi", "agent", "web-search.json"), '{"backend":"tinyfish"}');
		process.env.EXA_API_KEY = "e";
		let exaBody: any;
		globalThis.fetch = (async (url: string, init: any) => {
			if (url.includes("tinyfish")) return new Response("busy", { status: 429 });
			exaBody = JSON.parse(init.body);
			return Response.json({ results: [{ title: "From Exa", url: "https://example.com" }] });
		}) as any;
		const fromExa = (await tools.web_search.execute("id", { query: "q", country: "CN" })).content[0].text;
		assert.match(fromExa, /TinyFish failed[\s\S]*results below are from Exa lite/);
		assert.equal(exaBody.type, "lite");
		assert.equal(exaBody.userLocation, "cn");
	} finally {
		globalThis.fetch = realFetch;
	}
});

// One page showing "Hello PDF"; pdf.js rebuilds the missing xref table.
const MINI_PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
	+ "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
	+ "4 0 obj<</Length 41>>stream\nBT /F1 12 Tf 10 50 Td (Hello PDF) Tj ET\nendstream endobj\n"
	+ "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";

// "阳光电源" in STSong-Light without an embedded font: needs pdf.js CMaps (from pdfjs-dist) to decode.
const CJK_PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
	+ "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
	+ "4 0 obj<</Length 48>>stream\nBT /F1 12 Tf 10 50 Td <963351497535 6E90> Tj ET\nendstream endobj\n"
	+ "5 0 obj<</Type/Font/Subtype/Type0/BaseFont/STSong-Light/Encoding/UniGB-UCS2-H/DescendantFonts[6 0 R]>>endobj\n"
	+ "6 0 obj<</Type/Font/Subtype/CIDFontType0/BaseFont/STSong-Light/CIDSystemInfo<</Registry(Adobe)/Ordering(GB1)/Supplement 2>>"
	+ "/FontDescriptor<</Type/FontDescriptor/FontName/STSong-Light/Flags 6/FontBBox[0 0 1000 1000]/ItalicAngle 0/Ascent 880/Descent -120/CapHeight 880/StemV 93>>>>endobj\n"
	+ "trailer<</Root 1 0 R>>\n%%EOF";

test("web_fetch caps the body size and resolves links against the final URL", async () => {
	const tools: Record<string, any> = {};
	web({ registerTool: (t: any) => (tools[t.name] = t), registerCommand: () => {} } as any);
	const realFetch = globalThis.fetch;
	const article = `<html><body><article><h1>T</h1><p>${"word ".repeat(60)}<a href="next">rel</a></p></article></body></html>`;
	globalThis.fetch = (async (url: string) => {
		if (url.endsWith("/cjk.pdf")) return new Response(CJK_PDF, { headers: { "content-type": "application/pdf" } });
		if (url.endsWith("/meta")) return new Response(Buffer.concat([Buffer.from('<html><head><meta charset = "gbk"></head><body><pre>'), Buffer.from("d1f4b9e2b5e7d4b4", "hex"), Buffer.from("</pre></body></html>")]), { headers: { "content-type": "text/html" } });
		if (url.endsWith("/doc.pdf")) return new Response(MINI_PDF, { headers: { "content-type": "application/octet-stream" } });
		if (url.endsWith("/gbk")) return new Response(Buffer.from("d1f4b9e2b5e7d4b4", "hex"), { headers: { "content-type": "text/plain; charset=gbk" } });
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
		assert.equal((await tools.web_fetch.execute("id", { url: "https://example.com/gbk" })).content[0].text, "阳光电源");
		assert.equal((await tools.web_fetch.execute("id", { url: "https://example.com/doc.pdf" })).content[0].text, "--- Page 1 ---\nHello PDF");
		assert.match((await tools.web_fetch.execute("id", { url: "https://example.com/cjk.pdf" })).content[0].text, /阳光电源/);
		assert.match((await tools.web_fetch.execute("id", { url: "https://example.com/meta" })).content[0].text, /阳光电源/);
	} finally {
		globalThis.fetch = realFetch;
	}
});
