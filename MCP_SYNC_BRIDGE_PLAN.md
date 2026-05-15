# MCP Sync Bridge Pi Extension Plan

## Proposed repository

Path:

```bash
/Users/fameftimie/work/pi-extensions
```

Package name suggestion:

```json
"@eovidiu/pi-extensions"
```

Initial extension:

```text
mcp-sync-bridge
```

## Goal

Create a local git repo that contains Pi extensions you can later publish to npm or GitHub. The first extension will be an **explicit opt-in MCP compatibility bridge** for Pi.

Pi deliberately does not ship MCP support. This extension is not the default Pi integration pattern; it is a local compatibility layer for reusing trusted MCP server configs from other agent tools.

The extension will:

1. Discover MCP configs from Claude Code, Codex, and optionally Claude Desktop.
2. Sync them into a Pi-owned config file: `~/.pi/mcp.json`.
3. Preserve manually added Pi MCP servers.
4. Never execute newly discovered MCP server commands without explicit user opt-in.
5. Start only explicitly enabled MCP servers.
6. Discover MCP tools from enabled servers.
7. Register those tools as Pi tools.
8. Refresh config on Pi startup or `/reload`, while keeping MCP execution opt-in.

## Non-negotiable safety invariant

Installing or reloading the extension must never execute newly discovered MCP server commands without explicit user opt-in.

Discovered servers are synced as disabled by default. A server must be explicitly enabled before the extension starts its process or exposes its tools to Pi.

## Repository structure

```text
pi-extensions/
  package.json
  README.md
  LICENSE
  .gitignore
  tsconfig.json

  extensions/
    mcp-sync-bridge/
      index.ts
      config-discovery.ts
      config-sync.ts
      mcp-client.ts
      schema-conversion.ts
      tool-registration.ts
      types.ts
      README.md

  examples/
    mcp.json.example
```

## Package manifest

`package.json` will use Pi package conventions with an explicit extension path:

```json
{
  "name": "@eovidiu/pi-extensions",
  "version": "0.1.0",
  "keywords": ["pi-package", "pi-extension", "mcp"],
  "pi": {
    "extensions": ["./extensions/mcp-sync-bridge"]
  }
}
```

Runtime dependencies likely:

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "<tested-current-version>",
    "@iarna/toml": "<tested-current-version>"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-ai": "*",
    "typebox": "*"
  }
}
```

Notes:

- Use real tested dependency versions, not `latest` or pseudo-ranges like `^latest-compatible`.
- Runtime dependencies must be in `dependencies`, not `devDependencies`, because Pi package installs may omit dev dependencies.
- Pi packages such as `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `typebox` stay in `peerDependencies` with `"*"`.

## Pi MCP config format

Create/manage:

```text
~/.pi/mcp.json
```

Shape:

```json
{
  "version": 1,
  "autoStart": false,
  "servers": {
    "claude-code__filesystem": {
      "enabled": false,
      "managedBy": "pi-mcp-sync-bridge",
      "source": "claude-code",
      "sourceName": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/fameftimie/work"],
      "env": {}
    }
  }
}
```

Rules:

- Managed entries can be updated or removed by the sync.
- Manual entries without `managedBy: "pi-mcp-sync-bridge"` are preserved.
- Newly discovered managed entries default to `enabled: false`.
- Existing `enabled` values are preserved during sync.
- MCP server processes are only started when `enabled: true` and global policy allows startup.
- Names are prefixed by source to avoid conflicts:
  - `claude-code__github`
  - `codex__github`
  - `manual__github`

## Config discovery plan

The extension will search common locations first, then refine after observing what exists on the machine. Treat all locations and shapes as candidates; do not assume they exist or use identical schemas.

### Claude Desktop

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

### Claude Code

Candidate paths to probe:

```text
~/.claude.json
~/.claude/settings.json
~/.config/claude-code/config.json
~/.config/claude-code/settings.json
```

### Codex

Candidate paths to probe:

```text
~/.codex/config.toml
~/.codex/config.json
~/.config/codex/config.toml
~/.config/codex/config.json
```

The first version will record, in a redacted debug log, which files were:

- found
- parsed
- found to contain MCP entries
- ignored because the shape was unsupported
- ignored because parsing failed

Do not log to stdout. Pi owns stdout/TUI. Use `ctx.ui.notify()` for concise user-facing messages when `ctx.hasUI` is true, and write detailed logs to a file such as:

```text
~/.pi/mcp-sync-bridge.log
```

## Sync algorithm

On extension startup or `/reload`, perform config sync only. Do not start newly discovered servers during sync.

1. Read all known third-party config candidates.
2. Normalize discovered MCP server entries.
3. Read existing `~/.pi/mcp.json`.
4. Remove stale entries previously managed by this extension.
5. Add or update current discovered entries.
6. Preserve manual entries.
7. Preserve existing `enabled` values for previously discovered managed entries.
8. Set newly discovered managed entries to `enabled: false`.
9. Write `~/.pi/mcp.json` atomically.
10. Log a redacted summary.

Starting servers and registering tools happens only for enabled servers in the MCP bridge phase.

## Extension commands

Register operational commands so execution is explicit and inspectable:

```text
/mcp-sync
/mcp-status
/mcp-enable [server]
/mcp-disable [server]
/mcp-restart [server]
```

Command behavior:

- `/mcp-sync`: rescan external configs and update `~/.pi/mcp.json`; does not enable new servers.
- `/mcp-status`: show discovered servers, enabled/disabled state, connection state, and registered tools.
- `/mcp-enable <server>`: mark a server enabled and start/register its tools immediately.
- `/mcp-enable`: in interactive Pi sessions, rescan detected configs and open a selector for disabled detected servers.
- `/mcp-disable <server>`: mark a server disabled, unregister/hide tools where possible, and stop its process.
- `/mcp-disable`: in interactive Pi sessions, open a selector for enabled servers and disable the selected servers.
- `/mcp-restart [server]`: restart one enabled server or all enabled servers.

## MCP bridge behavior

For enabled servers only:

1. Start/connect MCP stdio server.
2. Initialize MCP session.
3. Call `tools/list`.
4. Convert supported MCP input schemas to Pi tool schemas.
5. Register Pi tools.
6. Forward Pi tool calls to MCP `tools/call`.
7. Fail one broken MCP server without breaking all others.
8. Respect `AbortSignal` where available.
9. Stop child processes on `session_shutdown` and when disabling/restarting a server.

Avoid long blocking work in the extension factory. The factory should register hooks and commands quickly. Startup/reload work should be bounded and failure-tolerant.

## Tool naming

MCP tool:

```text
read_file
```

From Claude Code filesystem server becomes Pi tool:

```text
mcp_claude_code_filesystem_read_file
```

From Codex GitHub server:

```text
mcp_codex_github_create_issue
```

Normalization rules:

- Normalize to characters safe for Pi tool names: `[A-Za-z0-9_]`.
- Replace unsupported characters with `_`.
- Collapse repeated underscores.
- Prefix all generated tools with `mcp_`.
- If a normalized name collides, append a short deterministic hash.
- Store a reverse mapping from Pi tool name to MCP server/tool.

Example collision handling:

```text
mcp_claude_code_filesystem_read_file
mcp_claude_code_filesystem_read_file_a13f9c
```

## Schema conversion

Schema conversion is required for the first MCP tool execution phase; it cannot be deferred entirely to hardening.

Initial supported MCP input schema subset:

- object schemas
- required fields
- string
- number
- integer
- boolean
- array
- nested object

Unsupported features should cause that specific tool to be skipped with a redacted warning, not crash the extension.

Examples of features that may need to be skipped or handled conservatively at first:

- complex `oneOf` / `anyOf` / `allOf`
- recursive schemas
- unsupported enum shapes
- non-object top-level schemas

Use `typebox` for Pi tool schemas. Use `StringEnum` from `@earendil-works/pi-ai` for string enums where needed, rather than `Type.Union`/`Type.Literal`, to avoid provider compatibility issues.

## Secret handling

The extension must:

- Never write newly resolved secret values into `~/.pi/mcp.json`.
- Preserve environment-variable references by name where possible.
- Avoid logging secrets from `env`, `args`, config files, errors, or MCP responses.
- Redact keys matching patterns such as `TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `AUTH`, and `CREDENTIAL`.
- Treat literal secrets found in source configs as sensitive; preserve only when necessary and always redact them in logs.

## Safety

The extension should:

- Never overwrite manual Pi MCP servers.
- Never auto-start newly discovered servers.
- Avoid logging secrets.
- Support environment variables by name.
- Fail one broken MCP server without breaking all others.
- Cleanly stop child processes on `session_shutdown`, `/reload`, session switches, and disable/restart operations.
- Avoid writing to stdout.
- Use atomic writes for `~/.pi/mcp.json`.
- Use file mutation safety for config writes if the implementation writes from Pi tools or concurrent command handlers.
- Warn users that MCP servers and Pi extensions execute code with the user's permissions.

## Implementation phases

### Phase 1 — repo/package skeleton

- Create `/Users/fameftimie/work/pi-extensions`.
- Add `package.json`, `tsconfig.json`, `.gitignore`, and README.
- Initialize local git repo.
- Add explicit Pi package manifest path: `./extensions/mcp-sync-bridge`.
- Add initial extension `index.ts` that registers `/mcp-status` and proves Pi can load the package.

### Phase 2 — config discovery/sync only

- Implement source config readers.
- Implement JSON and TOML parsing for candidate config files.
- Implement `~/.pi/mcp.json` merge/update logic.
- Preserve manual entries and existing `enabled` values.
- Default newly discovered servers to `enabled: false`.
- Add atomic writes.
- Add redacted debug logging to `~/.pi/mcp-sync-bridge.log`.
- Add `/mcp-sync` and `/mcp-status` commands.
- Do not start MCP servers.
- Do not execute MCP tools.

### Phase 3 — explicit enablement controls

- Add `/mcp-enable <server>` and interactive `/mcp-enable` selector.
- Add `/mcp-disable <server>` and interactive `/mcp-disable` selector.
- Add `/mcp-restart [server]`.
- Validate server names.
- Update `~/.pi/mcp.json` atomically from commands.
- Keep server execution disabled unless a server has been explicitly enabled.

### Phase 4 — MCP stdio bridge

- Start stdio MCP servers for enabled servers only.
- Initialize MCP sessions.
- Call `tools/list`.
- Implement initial schema conversion subset.
- Normalize tool names and handle collisions deterministically.
- Register tools in Pi.
- Forward Pi tool calls to MCP `tools/call`.
- Respect abort signals where possible.
- Stop child processes on `session_shutdown`, `/reload`, disable, and restart.

### Phase 5 — hardening

- Improve schema conversion coverage.
- Add server allow/deny filters.
- Add per-project overrides via `.pi/mcp.json`.
- Add better TUI status display when `ctx.hasUI` is true.
- Add non-interactive behavior for print/JSON mode.
- Add fixtures for known Claude Desktop, Claude Code, and Codex config shapes.
- Add robust truncation for large MCP tool outputs.

### Phase 6 — publish readiness

- Add README installation instructions.
- Add examples.
- Add security warning: review source before installing; extensions and MCP servers execute with user permissions.
- Add versioning.
- Prepare GitHub remote.
- Prepare npm package metadata.
- Pin or document tested dependency versions.

## Install/use while local

After building the repo, use it locally with:

```bash
pi install /Users/fameftimie/work/pi-extensions
```

or temporarily:

```bash
pi -e /Users/fameftimie/work/pi-extensions
```

For ongoing development, installing the local package is preferred because it keeps the package in Pi's resource set. After edits, use `/reload`.

Security note: Pi packages run with full system permissions. Review extension source before installing third-party packages.

## Implementation status

- Phase 1: complete — package skeleton and initial extension are in place.
- Phase 2: complete — config discovery/sync writes `~/.pi/mcp.json` safely and defaults discovered servers to disabled.
- Phase 3: complete — explicit enable/disable/restart controls validate server names, preserve the no-autostart invariant, and serialize in-process config mutations.
- Phase 4: complete — enabled stdio MCP servers are started, tools are listed, supported schemas are converted, Pi tools are registered, and calls are forwarded to MCP `tools/call`.
- Phase 5: complete — added allow/deny filters, project-local `.pi/mcp.json` overrides, output truncation, fixtures, and unit tests.
- Phase 6: complete — expanded documentation, security notes, npm metadata, examples, and CI workflow.

## Immediate next step

Manual testing in Pi:

1. Install the local package with `pi install /Users/fameftimie/work/pi-extensions`.
2. Run `/mcp-sync`.
3. Inspect `/mcp-status` and `~/.pi/mcp.json`.
4. Enable trusted servers with `/mcp-enable` or `/mcp-enable <server>`.
5. Ask Pi to use one of the registered MCP tools.
