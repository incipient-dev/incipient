import { createInterface } from "node:readline";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, type ApprovalMode } from "./config.js";
import { approvalNeeded } from "./safety.js";
import { executeTool, toolNames, TOOL_DEFS } from "./tools.js";
import { chatComplete, type ChatMessage } from "./llm.js";
import { readMemory, ensureMemoryFile } from "./memory.js";

export interface AgentOptions {
  workspace: string;
  /** Overrides the configured approval mode for this run. */
  approvalMode?: ApprovalMode;
  maxSteps?: number;
  /** True when a human is present to answer approval prompts. */
  interactive?: boolean;
  onEvent?: (line: string) => void;
}

export interface AgentOutcome {
  answer: string;
  steps: number;
  toolCalls: number;
}

function buildSystemPrompt(memory: string): string {
  const toolList = TOOL_DEFS.map(
    (t) => `- ${t.name}: ${t.description} Args: ${JSON.stringify(t.inputSchema.properties)}`,
  ).join("\n");
  return [
    "You are INCIPIENT, a safety-first coding agent working inside a project directory.",
    "You work in a loop. Each turn, either:",
    "1. Call ONE tool by writing a fenced block:",
    "```tool",
    '{"tool": "<name>", "arguments": {...}}',
    "```",
    "2. Or give your final answer as plain text (no tool block) when the task is done.",
    "Rules: read before you write; make the smallest change that completes the task;",
    "never run destructive commands; if a tool is denied or fails twice, stop and explain.",
    "Available tools:",
    toolList,
    memory ? `\nProject memory:\n${memory}` : "",
  ].join("\n");
}

/** Extract the first ```tool JSON block from a model reply, if any. */
export function parseToolCall(text: string): { name: string; args: Record<string, unknown> } | null {
  const m = text.match(/```tool\s*\n([\s\S]*?)```/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]) as {
      tool?: string;
      name?: string;
      arguments?: Record<string, unknown>;
      args?: Record<string, unknown>;
    };
    const name = parsed.tool ?? parsed.name;
    if (!name) return null;
    return { name, args: parsed.arguments ?? parsed.args ?? {} };
  } catch {
    return null;
  }
}

/** Remove tool blocks from a reply, leaving the human-readable answer. */
export function stripToolBlocks(text: string): string {
  return text.replace(/```tool[\s\S]*?```/g, "").trim();
}

function askApproval(name: string, args: Record<string, unknown>): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Allow ${name} ${JSON.stringify(args).slice(0, 300)}? [y/N] `, (answer) => {
      rl.close();
      resolvePromise(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export async function runAgent(task: string, opts: AgentOptions): Promise<AgentOutcome> {
  const cfg = loadConfig(opts.workspace);
  if (!cfg.model) {
    throw new Error("no model configured — set INCIPIENT_MODEL or model in incipient.config.json");
  }
  const mode = opts.approvalMode ?? cfg.approvalMode;
  const maxSteps = opts.maxSteps ?? cfg.maxSteps;
  ensureMemoryFile(opts.workspace);
  const memory = readMemory(opts.workspace);
  const audit = (entry: Record<string, unknown>): void => {
    try {
      const dir = join(opts.workspace, ".incipient");
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "audit.log"), `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      // Audit is best-effort; a failed audit must not fail the task.
    }
  };
  const ctx = { root: opts.workspace, audit };
  const log = (s: string): void => {
    opts.onEvent?.(s);
  };
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(memory) },
    { role: "user", content: task },
  ];
  let toolCalls = 0;
  for (let step = 0; step < maxSteps; step++) {
    const reply = await chatComplete(
      { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, temperature: cfg.temperature },
      messages,
    );
    messages.push({ role: "assistant", content: reply });
    const call = parseToolCall(reply);
    if (!call) {
      return { answer: stripToolBlocks(reply) || reply, steps: step + 1, toolCalls };
    }
    if (!toolNames().includes(call.name)) {
      messages.push({
        role: "user",
        content: `tool error: unknown tool "${call.name}". Available tools: ${toolNames().join(", ")}`,
      });
      continue;
    }
    const decision = approvalNeeded(call.name, call.args, mode);
    if (decision === "deny") {
      messages.push({
        role: "user",
        content: `tool ${call.name} was denied by safety policy (mode: ${mode}). Do not retry it; finish with what you have, or explain what needs approval.`,
      });
      log(`denied ${call.name} (mode: ${mode})`);
      continue;
    }
    if (decision === "ask-user") {
      const ok = opts.interactive ? await askApproval(call.name, call.args) : false;
      if (!ok) {
        messages.push({
          role: "user",
          content: `the user declined ${call.name}. Do not retry it; finish with what you have, or ask for what you need.`,
        });
        log(`declined ${call.name}`);
        continue;
      }
    }
    toolCalls++;
    log(`→ ${call.name} ${JSON.stringify(call.args).slice(0, 200)}`);
    const result = await executeTool(ctx, call.name, call.args);
    messages.push({
      role: "user",
      content: `tool ${call.name} ${result.ok ? "succeeded" : "failed"}:\n${result.output}`,
    });
  }
  return {
    answer: `Reached the step limit (${maxSteps}) without a final answer.`,
    steps: maxSteps,
    toolCalls,
  };
}

/** One model call that only writes a plan — no tools run, nothing changes. */
export async function planTask(task: string, workspace: string): Promise<string> {
  const cfg = loadConfig(workspace);
  if (!cfg.model) {
    throw new Error("no model configured — set INCIPIENT_MODEL or model in incipient.config.json");
  }
  const memory = readMemory(workspace);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are INCIPIENT, a safety-first coding agent.",
        "Write a concrete, numbered plan for the task below. Do NOT execute anything — planning only.",
        "List files to create or change, commands to run, and how to verify the result. Keep it short.",
        memory ? `\nProject memory:\n${memory}` : "",
      ].join("\n"),
    },
    { role: "user", content: task },
  ];
  return chatComplete(
    { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, temperature: cfg.temperature },
    messages,
  );
}
