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

test("refuses ambiguous context instead of patching the first match", async () => {
	const t = load([]);
	writeFileSync(join(t.cwd, "a.txt"), "x\ny\nx\ny\n");
	await assert.rejects(t.run(patch("*** Update File: a.txt", " x", "-y", "+z")), /Ambiguous context/);
	assert.equal(readFileSync(join(t.cwd, "a.txt"), "utf8"), "x\ny\nx\ny\n");

	await t.run(patch("*** Update File: a.txt", "@@ y", " x", "-y", "+z"));
	assert.equal(readFileSync(join(t.cwd, "a.txt"), "utf8"), "x\ny\nx\nz\n");
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
