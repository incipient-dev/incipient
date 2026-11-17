import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

export function memoryPath(root: string): string {
  return join(root, ".incipient", "memory.md");
}

export function readMemory(root: string): string {
  const p = memoryPath(root);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

export function ensureMemoryFile(root: string): void {
  const p = memoryPath(root);
  if (!existsSync(p)) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(
      p,
      "# INCIPIENT memory\n\nFacts the agent should remember about this project.\n",
      "utf8",
    );
  }
}
