import { resolve, sep } from "node:path";
import type { ApprovalMode } from "./config.js";

export type ToolRisk = "read" | "write" | "exec" | "destructive";

export const READ_TOOLS = new Set(["read_file", "list_dir", "grep"]);
export const WRITE_TOOLS = new Set(["write_file", "edit_file", "remember"]);

/** True when `target` resolves inside `root` (or is the root itself). */
export function isPathInside(root: string, target: string): boolean {
  const rootAbs = resolve(root);
  const targetAbs = resolve(root, target);
  return targetAbs === rootAbs || targetAbs.startsWith(rootAbs + sep);
}

const DENY_PATTERNS: Array<[RegExp, string]> = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/, "recursive force delete"],
  [/\bmkfs\b/, "filesystem format"],
  [/\bdd\b.*\bof=\/dev\//, "raw disk write"],
  [/\b(shutdown|reboot|halt|poweroff)\b/, "power command"],
  [/\|\s*(sh|bash|zsh)\s*$/, "piped to shell"],
  [/curl[^|]*\|\s*(sh|bash)/, "curl piped to shell"],
  [/wget[^|]*\|\s*(sh|bash)/, "wget piped to shell"],
  [/\bgit\s+push\b.*--force/, "force push"],
  [/\bchmod\s+(-R\s+)?777\b/, "overly broad permissions"],
  [/:\(\)\s*\{/, "fork bomb"],
  [/\bnpm\s+install\s+-g\b/, "global install"],
];

/** Classify a shell command. Blocked commands are never executed. */
export function classifyCommand(command: string): { blocked: boolean; reason?: string } {
  for (const [re, reason] of DENY_PATTERNS) {
    if (re.test(command)) return { blocked: true, reason };
  }
  return { blocked: false };
}

export function toolRisk(tool: string, args: Record<string, unknown>): ToolRisk {
  if (READ_TOOLS.has(tool)) return "read";
  if (tool === "run_command") {
    const cmd = String(args.command ?? "");
    return classifyCommand(cmd).blocked ? "destructive" : "exec";
  }
  if (WRITE_TOOLS.has(tool)) return "write";
  return "write";
}

export type ApprovalDecision = "allow" | "deny" | "ask-user";

/**
 * The safety gate. Read-only tools are always allowed.
 * Destructive commands are denied in auto mode and asked about in ask mode.
 * Everything else: auto mode allows, ask mode asks, readonly mode denies.
 */
export function approvalNeeded(
  tool: string,
  args: Record<string, unknown>,
  mode: ApprovalMode,
): ApprovalDecision {
  const risk = toolRisk(tool, args);
  if (mode === "readonly") return "deny";
  if (risk === "read") return "allow";
  if (risk === "destructive") return mode === "auto" ? "deny" : "ask-user";
  if (mode === "auto") return "allow";
  return "ask-user";
}
