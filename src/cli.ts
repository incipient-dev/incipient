#!/usr/bin/env node
import { createInterface } from "node:readline";
import { runAgent, planTask } from "./agent.js";
import { runMcpServer } from "./mcp.js";
import { loadConfig, maskKey } from "./config.js";
import { readMemory } from "./memory.js";
import type { ApprovalMode } from "./config.js";

const VERSION = "0.1.0";

function printHelp(): void {
  console.log(`INCIPIENT ${VERSION} — a safety-first, general-purpose coding agent.
Every build begins here.

Usage:
  incipient                  Start an interactive session in this directory
  incipient run "<task>" [--yes] [--max-steps=N]
                             Run one task (asks before every write/command)
  incipient plan "<task>"    Print a plan only — no tools run, nothing changes
  incipient doctor           Check config, model endpoint and environment
  incipient config           Show the effective config (key masked)
  incipient mcp              Serve the tools over MCP (stdio JSON-RPC)
  incipient --help           Show this help
  incipient --version        Show the version

Config (incipient.config.json in the workspace, or environment):
  INCIPIENT_MODEL            Chat model id (required)
  INCIPIENT_BASE_URL         OpenAI-compatible base URL (default: https://api.openai.com/v1)
  INCIPIENT_API_KEY          API key, if the endpoint needs one
  INCIPIENT_APPROVAL         ask | auto | readonly (default: ask)

Safety: every file tool stays inside the workspace. Writes and commands ask
for approval unless --yes (auto). Destructive commands are always blocked
in auto mode and always asked about otherwise. Every tool call is logged
to .incipient/audit.log.`);
}

async function doctor(workspace: string): Promise<void> {
  const cfg = loadConfig(workspace);
  console.log("INCIPIENT doctor");
  console.log(`  workspace : ${workspace}`);
  console.log(`  model     : ${cfg.model || "(not set)"}`);
  console.log(`  baseUrl   : ${cfg.baseUrl}`);
  console.log(`  apiKey    : ${maskKey(cfg.apiKey)}`);
  console.log(`  approval  : ${cfg.approvalMode}`);
  console.log(`  node      : ${process.version}`);
  if (!cfg.model) {
    console.log("  ✗ no model — set INCIPIENT_MODEL or model in incipient.config.json");
    return;
  }
  if (!cfg.apiKey) console.log("  ! no API key — some endpoints need one");
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/models`, {
      headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
    });
    console.log(`  endpoint  : ${res.ok ? `reachable (${res.status})` : `returned ${res.status}`}`);
  } catch (err) {
    console.log(`  endpoint  : unreachable (${err instanceof Error ? err.message : String(err)})`);
  }
}

async function chatLoop(workspace: string): Promise<void> {
  let mode: ApprovalMode = loadConfig(workspace).approvalMode;
  console.log("INCIPIENT — type a task, or /help. /plan <task> plans without changing anything. exit quits.");
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "incipient> " });
  rl.prompt();
  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }
    if (input === "exit" || input === "quit") break;
    if (input === "/help") {
      console.log("Commands: /plan <task> (plan only) · /mode ask|auto|readonly · /memory (show project memory) · exit");
      rl.prompt();
      continue;
    }
    if (input === "/memory") {
      console.log(readMemory(workspace) || "(no project memory yet)");
      rl.prompt();
      continue;
    }
    if (input.startsWith("/mode ")) {
      const next = input.slice(6).trim();
      if (next === "ask" || next === "auto" || next === "readonly") {
        mode = next;
        console.log(`approval mode: ${mode}`);
      } else {
        console.log("usage: /mode ask|auto|readonly");
      }
      rl.prompt();
      continue;
    }
    if (input.startsWith("/plan ")) {
      try {
        console.log(await planTask(input.slice(6).trim(), workspace));
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
      }
      rl.prompt();
      continue;
    }
    try {
      const out = await runAgent(input, {
        workspace,
        approvalMode: mode,
        interactive: true,
        onEvent: (l) => console.log(l),
      });
      console.log(`\n${out.answer}\n\n(${out.steps} steps, ${out.toolCalls} tool calls)`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    }
    rl.prompt();
  }
  console.log("Bye — every build begins here.");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const workspace = process.cwd();
  const cmd = argv[0];
  if (!cmd || cmd === "chat") {
    await chatLoop(workspace);
    return;
  }
  switch (cmd) {
    case "--help":
    case "-h":
    case "help":
      printHelp();
      break;
    case "--version":
    case "-v":
      console.log(`incipient ${VERSION}`);
      break;
    case "doctor":
      await doctor(workspace);
      break;
    case "config": {
      const cfg = loadConfig(workspace);
      console.log(JSON.stringify({ ...cfg, apiKey: maskKey(cfg.apiKey) }, null, 2));
      break;
    }
    case "plan": {
      const task = argv.slice(1).join(" ");
      if (!task) {
        console.error('usage: incipient plan "<task>"');
        process.exitCode = 2;
        break;
      }
      console.log(await planTask(task, workspace));
      break;
    }
    case "run": {
      const yes = argv.includes("--yes");
      const maxStepsArg = argv.find((a) => a.startsWith("--max-steps="));
      const task = argv
        .slice(1)
        .filter((a) => a !== "--yes" && !a.startsWith("--max-steps="))
        .join(" ");
      if (!task) {
        console.error('usage: incipient run "<task>" [--yes]');
        process.exitCode = 2;
        break;
      }
      const out = await runAgent(task, {
        workspace,
        approvalMode: yes ? "auto" : undefined,
        maxSteps: maxStepsArg ? Number(maxStepsArg.split("=")[1]) : undefined,
        interactive: !yes,
        onEvent: (l) => console.log(l),
      });
      console.log(`\n${out.answer}\n\n(${out.steps} steps, ${out.toolCalls} tool calls)`);
      break;
    }
    case "mcp":
      await runMcpServer(workspace);
      break;
    default:
      console.error(`unknown command: ${cmd}`);
      printHelp();
      process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
