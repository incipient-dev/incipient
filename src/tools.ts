import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  appendFileSync,
} from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { execFile } from "node:child_process";
import { isPathInside } from "./safety.js";

export interface ToolResult {
  ok: boolean;
  output: string;
}

export interface ToolContext {
  /** Workspace root — every file tool is sandboxed to this directory. */
  root: string;
  audit: (entry: Record<string, unknown>) => void;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "read_file",
    description: "Read a file inside the workspace. Returns its text (first 20k chars).",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the workspace root." } },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    description: "List files and folders in a directory inside the workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Directory relative to the workspace root (default: .)." } },
    },
  },
  {
    name: "grep",
    description: "Search file contents for a literal string, recursively. Skips node_modules and .git.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Literal text to find." },
        path: { type: "string", description: "Directory to search (default: .)." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file inside the workspace. Creates parent folders as needed.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root." },
        content: { type: "string", description: "Full file contents." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace one exact piece of text in a file. Fails when old_text is not found.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root." },
        old_text: { type: "string", description: "Exact text to replace (first occurrence)." },
        new_text: { type: "string", description: "Replacement text." },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "run_command",
    description: "Run a shell command inside the workspace (bash -lc). Destructive commands are blocked by the safety gate.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to run." },
        timeout_ms: { type: "string", description: "Timeout in milliseconds (default: 60000)." },
      },
      required: ["command"],
    },
  },
  {
    name: "remember",
    description: "Save a durable fact about this project to .incipient/memory.md.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "One fact, in one sentence." } },
      required: ["text"],
    },
  },
];

export function toolNames(): string[] {
  return TOOL_DEFS.map((t) => t.name);
}

/** Execute a tool and write one audit line. Never throws. */
export async function executeTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const started = Date.now();
  let result: ToolResult;
  try {
    result = await runTool(ctx, name, args);
  } catch (err) {
    result = { ok: false, output: `error: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    ctx.audit({ tool: name, args, ok: result.ok, ms: Date.now() - started, at: new Date().toISOString() });
  } catch {
    // Audit is best-effort; a failed audit must not fail the tool call.
  }
  return result;
}

function resolveInside(ctx: ToolContext, p: string): string {
  const full = resolve(ctx.root, p);
  if (!isPathInside(ctx.root, full)) throw new Error(`path escapes workspace: ${p}`);
  return full;
}

async function runTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case "read_file": {
      const full = resolveInside(ctx, String(args.path));
      if (!existsSync(full)) return { ok: false, output: `file not found: ${args.path}` };
      return { ok: true, output: readFileSync(full, "utf8").slice(0, 20000) };
    }
    case "list_dir": {
      const full = resolveInside(ctx, String(args.path ?? "."));
      const entries = readdirSync(full, { withFileTypes: true }).map((e) =>
        e.isDirectory() ? `${e.name}/` : e.name,
      );
      return { ok: true, output: entries.join("\n") || "(empty)" };
    }
    case "grep": {
      const pattern = String(args.pattern);
      const base = resolveInside(ctx, String(args.path ?? "."));
      const hits: string[] = [];
      const walk = (dir: string): void => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) {
            if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
            walk(p);
            continue;
          }
          if (!/\.(ts|js|mjs|json|md|txt|py|html|css)$/.test(e.name)) continue;
          const lines = readFileSync(p, "utf8").split("\n");
          lines.forEach((line, i) => {
            if (line.includes(pattern)) {
              hits.push(`${relative(ctx.root, p)}:${i + 1}: ${line.trim().slice(0, 200)}`);
            }
          });
        }
      };
      walk(base);
      return { ok: true, output: hits.slice(0, 100).join("\n") || "(no matches)" };
    }
    case "write_file": {
      const full = resolveInside(ctx, String(args.path));
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, String(args.content ?? ""), "utf8");
      return { ok: true, output: `wrote ${args.path}` };
    }
    case "edit_file": {
      const full = resolveInside(ctx, String(args.path));
      const text = readFileSync(full, "utf8");
      const oldText = String(args.old_text ?? "");
      const newText = String(args.new_text ?? "");
      if (!text.includes(oldText)) return { ok: false, output: "old_text not found in file" };
      writeFileSync(full, text.replace(oldText, newText), "utf8");
      return { ok: true, output: `edited ${args.path}` };
    }
    case "run_command": {
      return runShell(String(args.command), ctx.root, Number(args.timeout_ms ?? 60000));
    }
    case "remember": {
      const mem = join(ctx.root, ".incipient", "memory.md");
      mkdirSync(dirname(mem), { recursive: true });
      appendFileSync(mem, `- ${String(args.text)}\n`, "utf8");
      return { ok: true, output: "remembered" };
    }
    default:
      return { ok: false, output: `unknown tool: ${name}` };
  }
}

function runShell(command: string, cwd: string, timeoutMs: number): Promise<ToolResult> {
  return new Promise((resolvePromise) => {
    execFile(
      "bash",
      ["-lc", command],
      { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const output = (stdout + stderr).slice(0, 20000);
        if (err && (err as NodeJS.ErrnoException).code === "ETIMEDOUT") {
          resolvePromise({ ok: false, output: `command timed out after ${timeoutMs}ms\n${output}` });
        } else {
          resolvePromise({ ok: !err, output: output || "(no output)" });
        }
      },
    );
  });
}
