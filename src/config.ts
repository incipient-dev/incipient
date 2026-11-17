import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type ApprovalMode = "ask" | "auto" | "readonly";

export interface IncipientConfig {
  /** Chat model id, e.g. "gpt-6-astra". No default — set it explicitly. */
  model: string;
  /** OpenAI-compatible chat completions base URL. */
  baseUrl: string;
  /** API key, if the endpoint needs one. */
  apiKey: string | undefined;
  /** ask = confirm every write/command; auto = allow non-destructive writes; readonly = plan only. */
  approvalMode: ApprovalMode;
  /** Max agent steps per task. */
  maxSteps: number;
  temperature: number;
}

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function toApprovalMode(value: unknown): ApprovalMode {
  return value === "auto" || value === "readonly" ? value : "ask";
}

/** Config file wins are overridden by environment variables. */
export function loadConfig(workspace: string): IncipientConfig {
  let fileCfg: Partial<IncipientConfig> = {};
  const cfgPath = join(workspace, "incipient.config.json");
  if (existsSync(cfgPath)) {
    try {
      fileCfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Partial<IncipientConfig>;
    } catch {
      // A broken config file must never crash startup; env still applies.
    }
  }
  return {
    model: process.env.INCIPIENT_MODEL ?? fileCfg.model ?? "",
    baseUrl: process.env.INCIPIENT_BASE_URL ?? fileCfg.baseUrl ?? DEFAULT_BASE_URL,
    apiKey: process.env.INCIPIENT_API_KEY ?? fileCfg.apiKey,
    approvalMode: toApprovalMode(process.env.INCIPIENT_APPROVAL ?? fileCfg.approvalMode ?? "ask"),
    maxSteps: Number(process.env.INCIPIENT_MAX_STEPS ?? fileCfg.maxSteps ?? 30),
    temperature: Number(process.env.INCIPIENT_TEMPERATURE ?? fileCfg.temperature ?? 0.2),
  };
}

export function maskKey(key: string | undefined): string {
  if (!key) return "(not set)";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
