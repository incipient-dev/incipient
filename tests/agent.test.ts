import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToolCall, stripToolBlocks } from "../src/agent.js";

test("parseToolCall extracts a JSON tool block", () => {
  const reply = 'Let me read it first.\n```tool\n{"tool": "read_file", "arguments": {"path": "src/a.ts"}}\n```';
  const call = parseToolCall(reply);
  assert.deepEqual(call, { name: "read_file", args: { path: "src/a.ts" } });
});

test("parseToolCall returns null for plain answers and broken JSON", () => {
  assert.equal(parseToolCall("All done, nothing to change."), null);
  assert.equal(parseToolCall('```tool\n{"tool": "read_file",\n```'), null);
});

test("stripToolBlocks leaves the human-readable answer", () => {
  const reply = 'Here is what I found.\n```tool\n{"tool": "read_file", "arguments": {}}\n```\nDone.';
  assert.equal(stripToolBlocks(reply), "Here is what I found.\n\nDone.");
});
