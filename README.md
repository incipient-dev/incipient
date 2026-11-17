# INCIPIENT

![INCIPIENT — Every build begins here.](assets/incipient-lockup.webp)

**A safety-first, general-purpose coding agent. Every build begins here.**

INCIPIENT plans, writes, edits, runs, and verifies code inside your project
directory — and asks you before it changes anything. No hidden writes, no
surprise commands, no escaping the workspace.

- **Agent loop** — read, search, write, edit, run, and remember, driven by any
  OpenAI-compatible chat model.
- **Approval-first safety** — reads are always free; every write and command
  asks for confirmation by default. Destructive commands are blocked outright
  in auto mode.
- **Workspace sandbox** — every file tool is confined to the project
  directory. Paths that escape it are refused.
- **Plan mode** — `incipient plan` prints a concrete plan and changes nothing.
- **Memory** — durable project facts live in `.incipient/memory.md`.
- **Audit log** — every tool call is recorded in `.incipient/audit.log`.
- **MCP server** — `incipient mcp` serves the same tools over stdio, so other
  agents (Claude Code, OpenCode, …) can use them.
- **Zero runtime dependencies** — TypeScript + Node 20+ only.

## Quickstart

```bash
npm install
npm run build
npm link          # or: node dist/cli.js

export INCIPIENT_MODEL="your-model-id"
export INCIPIENT_API_KEY="your-key"
export INCIPIENT_BASE_URL="https://api.openai.com/v1"   # any OpenAI-compatible endpoint

cd your-project
incipient doctor  # check the setup
incipient         # interactive session
```

Or put the same settings in `incipient.config.json` in the project root:

```json
{
  "model": "your-model-id",
  "baseUrl": "https://api.openai.com/v1",
  "approvalMode": "ask"
}
```

Environment variables override the config file. Never commit a real API key —
use `INCIPIENT_API_KEY` in your shell instead.

## Usage

```bash
incipient run "add a /health endpoint and a test for it" [--yes]
incipient plan "migrate the auth module to sessions"
incipient config
incipient mcp
```

Interactive commands: `/plan <task>` · `/mode ask|auto|readonly` ·
`/memory` · `exit`.

Approval modes:

| Mode | Reads | Writes / commands | Destructive commands |
| ---- | ----- | ----------------- | -------------------- |
| `ask` (default) | allowed | ask every time | ask every time |
| `auto` (`--yes`) | allowed | allowed | **denied** |
| `readonly` | allowed | denied | denied |

## How the agent works

The model talks to INCIPIENT through one fenced JSON block per turn:

````````
```tool
{"tool": "read_file", "arguments": {"path": "src/index.ts"}}
```
````````

Any model that can follow that format works — no native function calling is
required, so INCIPIENT runs on any OpenAI-compatible endpoint. When the model
answers in plain text with no tool block, the task is done.

Tools: `read_file`, `list_dir`, `grep`, `write_file`, `edit_file`,
`run_command`, `remember`.

> **Provider note:** some gateways only allow listed programming clients and
> refuse direct SDK calls. Xingchi (`https://xingchiapi.com/v1`) returns
> `403 client_not_allowed` for INCIPIENT's direct calls (verified 2026-11-17)
> — its credit can only be spent through a client on its allow-list. A
> `run-xingchi.sh` wrapper is included for the day that policy changes.
>
> **Verified working path (2026-11-17): OpenCode as the brain, INCIPIENT as
> the hands.** OpenCode is on Xingchi's allow-list. Add INCIPIENT as an MCP
> server in `~/.config/opencode/opencode.json` (`mcp.incipient`: `type`
> `local`, `command` `["node", "<incipient>/dist/cli.js", "mcp"]`), set the
> Xingchi provider (`baseURL https://xingchiapi.com/v1`, key from
> `XINGCHI_API_KEY` — see `opencode-xingchi.sh`), then run from the project
> dir with `approvalMode: "auto"` in `incipient.config.json` so MCP writes
> are allowed. **Close stdin (`< /dev/null`) — `opencode run` waits on an
> open stdin forever and looks stalled.** Proof: `hello.txt` created via
> `incipient_write_file`, confirmed in `.incipient/audit.log`.
> Codex also chats fine over Xingchi (responses API), but its MCP tools need
> the `codex-code-mode-host` binary, which the npm install here does not
> ship — so Codex cannot drive INCIPIENT's tools on this machine.

## MCP

```json
{
  "mcpServers": {
    "incipient": {
      "command": "node",
      "args": ["/path/to/incipient/dist/cli.js", "mcp"],
      "cwd": "/path/to/your-project"
    }
  }
}
```

Write tools served over MCP are refused unless `approvalMode` is `auto` —
there is no human in the loop to approve them there.

## Project layout

```
src/
  cli.ts      commands: chat, run, plan, doctor, config, mcp
  agent.ts    the ReAct-style loop, approval flow, plan mode
  tools.ts    sandboxed file/shell tools + audit
  safety.ts   path containment, command denylist, approval matrix
  llm.ts      OpenAI-compatible chat client (fetch, no deps)
  mcp.ts      minimal MCP server over stdio (JSON-RPC 2.0)
  config.ts   config file + environment
  memory.ts   .incipient/memory.md
tests/        node:test suites (safety, tools, agent protocol)
assets/       logo
```

## Development

```bash
npm run typecheck
npm test
```

## License

MIT — see [LICENSE](LICENSE).
