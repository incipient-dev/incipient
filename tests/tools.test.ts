import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool, type ToolContext } from "../src/tools.js";

function makeCtx(): { root: string; ctx: ToolContext } {
  const root = mkdtempSync(join(tmpdir(), "incipient-test-"));
  return { root, ctx: { root, audit: () => {} } };
}

test("write/read/edit round-trip inside the workspace", async () => {
  const { root, ctx } = makeCtx();
  try {
    assert.equal((await executeTool(ctx, "write_file", { path: "a.txt", content: "hello" })).ok, true);
    assert.equal((await executeTool(ctx, "read_file", { path: "a.txt" })).output, "hello");
    assert.equal(
      (await executeTool(ctx, "edit_file", { path: "a.txt", old_text: "hello", new_text: "hello world" })).ok,
      true,
    );
    assert.equal((await executeTool(ctx, "read_file", { path: "a.txt" })).output, "hello world");
    assert.equal((await executeTool(ctx, "edit_file", { path: "a.txt", old_text: "missing", new_text: "x" })).ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("paths escaping the workspace are refused", async () => {
  const { root, ctx } = makeCtx();
  try {
    assert.equal((await executeTool(ctx, "read_file", { path: "../secret.txt" })).ok, false);
    assert.equal((await executeTool(ctx, "write_file", { path: "../../tmp/evil.txt", content: "x" })).ok, false);
    assert.equal((await executeTool(ctx, "read_file", { path: "/etc/passwd" })).ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("grep finds matches and list_dir lists files", async () => {
  const { root, ctx } = makeCtx();
  try {
    await executeTool(ctx, "write_file", { path: "b.ts", content: "const needle = 1;\nconst x = 2;\n" });
    const g = await executeTool(ctx, "grep", { pattern: "needle" });
    assert.match(g.output, /b\.ts:1/);
    const g2 = await executeTool(ctx, "grep", { pattern: "no-such-string" });
    assert.equal(g2.output, "(no matches)");
    const l = await executeTool(ctx, "list_dir", { path: "." });
    assert.match(l.output, /b\.ts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run_command runs inside the workspace", async () => {
  const { root, ctx } = makeCtx();
  try {
    const r = await executeTool(ctx, "run_command", { command: "echo hi" });
    assert.equal(r.ok, true);
    assert.match(r.output, /hi/);
    const bad = await executeTool(ctx, "run_command", { command: "exit 3" });
    assert.equal(bad.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unknown tool fails cleanly", async () => {
  const { root, ctx } = makeCtx();
  try {
    assert.equal((await executeTool(ctx, "teleport", {})).ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
