// Run: node --test tests/apply_patch.test.ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import applyPatchExtension from "../extensions/apply_patch.ts";

function load(active: string[]) {
	let tool: any;
	let onStart: any;
	const pi = {
		registerTool: (t: any) => (tool = t),
		on: (_name: string, handler: any) => (onStart = handler),
		getActiveTools: () => [...active],
		setActiveTools: (names: string[]) => (active = names),
	};
	applyPatchExtension(pi as any);
	const cwd = mkdtempSync(join(tmpdir(), "apply-patch-"));
	return {
		cwd,
		active: () => [...active].sort(),
		start: (id: string) => onStart({}, { model: { id } }),
		run: (patch: string) => tool.execute("id", { patch }, undefined, undefined, { cwd }),
	};
}

const patch = (...lines: string[]) => ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");

test("swaps edit and apply_patch by model, never into a read-only loadout", () => {
	const t = load(["read", "edit", "write", "apply_patch"]);
	t.start("gpt-5.2");
	assert.deepEqual(t.active(), ["apply_patch", "read", "write"]);
	t.start("claude-opus-4");
	assert.deepEqual(t.active(), ["edit", "read", "write"]);

	const readOnly = load(["read", "grep", "apply_patch"]);
	readOnly.start("gpt-5.2-codex");
	assert.deepEqual(readOnly.active(), ["grep", "read"]);
});

// The file shape from session 01a0f043: the same line twice, told apart by hunk order.
const twin = ["function a() {", "  return (", "    <article>", "  );", "}", "function pending() {", "  return 1;", "}", "function b() {", "  return (", "    <article>", "    <sheen />", "  );", "}", ""].join("\n");

test("repeated lines are told apart by hunk order and @@ anchors", async () => {
	const t = load([]);
	const file = join(t.cwd, "c.tsx");
	writeFileSync(file, twin);
	// Session call 2: plain order.
	await t.run(patch("*** Update File: c.tsx", "@@", "-    <article>", "+    <A1>", "@@ function pending() {", "-  return 1;", "+  return 2;", "@@", "-    <article>", "+    <A2>"));
	assert.equal(readFileSync(file, "utf8"), twin.replace("<article>", "<A1>").replace("return 1", "return 2").replace("<article>", "<A2>"));

	// Session call 5: anchor given as a context line, then the duplicate after it.
	writeFileSync(file, twin);
	await t.run(patch("*** Update File: c.tsx", "@@", " function b() {", "@@", "   return (", "-    <article>", "+    <B>"));
	assert.equal(readFileSync(file, "utf8"), twin.replace(/<article>(?![\s\S]*<article>)/, "<B>"));

	// Anchor repeated as the first context line; unified-diff header ignored.
	writeFileSync(file, twin);
	await t.run(patch("*** Update File: c.tsx", "@@ function b() {", " function b() {", "   return (", "-    <article>", "+    <B>"));
	assert.equal(readFileSync(file, "utf8"), twin.replace(/<article>(?![\s\S]*<article>)/, "<B>"));
	writeFileSync(file, twin);
	await t.run(patch("*** Update File: c.tsx", "@@ -6,3 +6,3 @@", " function pending() {", "-  return 1;", "+  return 2;"));
	assert.equal(readFileSync(file, "utf8"), twin.replace("return 1", "return 2"));
});

test("errors say what to fix", async () => {
	const t = load([]);
	writeFileSync(join(t.cwd, "c.tsx"), twin);
	// Session call 3: a hunk above the previous one.
	await assert.rejects(
		t.run(patch("*** Update File: c.tsx", "@@ function b() {", "-  return (", "+  return [", "@@", "-  return 1;", "+  return 2;")),
		/line 7, above the previous hunk.*file order/,
	);
	await assert.rejects(t.run(patch("*** Update File: c.tsx", "@@ function missing() {", "-  return 1;", "+  x")), /c\.tsx: could not find the @@ anchor line/);
	assert.equal(readFileSync(join(t.cwd, "c.tsx"), "utf8"), twin);
});

test("tolerates a trailing blank separator and typographic punctuation", async () => {
	const t = load([]);
	writeFileSync(join(t.cwd, "d.txt"), "a \u2014 \u201Cq\u201D\nb\n");
	await t.run(patch("*** Update File: d.txt", ' a - "q"', "-b", "+c", ""));
	assert.equal(readFileSync(join(t.cwd, "d.txt"), "utf8"), "a \u2014 \u201Cq\u201D\nc\n");
});

test("keeps BOM and CRLF, ends added files with a newline", async () => {
	const t = load([]);
	writeFileSync(join(t.cwd, "w.txt"), "\uFEFFa\r\nb\r\n");
	await t.run(patch("*** Update File: w.txt", " a", "-b", "+c", "+d", "*** Add File: n.txt", "+hi"));
	assert.equal(readFileSync(join(t.cwd, "w.txt"), "utf8"), "\uFEFFa\r\nc\r\nd\r\n");
	assert.equal(readFileSync(join(t.cwd, "n.txt"), "utf8"), "hi\n");
});

test("a refused move writes nothing", async () => {
	const t = load([]);
	writeFileSync(join(t.cwd, "a.txt"), "a\n");
	writeFileSync(join(t.cwd, "b.txt"), "b\n");
	await assert.rejects(
		t.run(patch("*** Add File: c.txt", "+c", "*** Update File: a.txt", "*** Move to: b.txt", "-a", "+A")),
		/Destination already exists/,
	);
	assert.equal(existsSync(join(t.cwd, "c.txt")), false);
	assert.equal(readFileSync(join(t.cwd, "a.txt"), "utf8"), "a\n");
});
