# @eovidiu/pi-extensions

Personal [Pi](https://pi.dev) extension package.

This repository currently contains one extension: **`mcp-sync-bridge`**, an explicit opt-in MCP compatibility bridge for Pi.

> Security note: Pi extensions run as local TypeScript with your user permissions. MCP servers started by this extension also run with your user permissions. Review the source and every MCP server command before enabling it.

## Why this exists

Pi intentionally does not ship built-in MCP support. The usual Pi approach is to integrate tools directly through skills, CLI wrappers, or extensions.

This package is a compatibility bridge for users who already have trusted MCP server configs in other tools and want to reuse them from Pi without giving up Pi's explicit opt-in model.

The bridge never starts newly discovered MCP servers automatically. Discovery only records servers as disabled. A server must be explicitly enabled before its process starts or its tools are exposed to Pi.

## Features

- Discovers MCP server configs from common Claude Desktop, Claude Code, and Codex locations.
- Syncs discovered servers into a Pi-owned config file: `~/.pi/mcp.json`.
- Preserves manually added Pi MCP server entries.
- Preserves existing `enabled` values across resyncs.
- Defaults newly discovered servers to `enabled: false`.
- Starts only explicitly enabled MCP stdio servers.
- Initializes MCP sessions and calls `tools/list`.
- Converts a conservative MCP JSON Schema subset into Pi/typebox tool schemas.
- Registers supported MCP tools as Pi tools.
- Forwards Pi tool calls to MCP `tools/call`.
- Stops and deactivates tools on disable, restart, session shutdown, and reload.
- Supports interactive `/mcp-enable` and `/mcp-disable` selectors in Pi's TUI.
- Supports project-local `.pi/mcp.json` overrides.
- Supports `allowServers`, `denyServers`, and `maxOutputChars` hardening settings.
- Writes detailed redacted diagnostics to `~/.pi/mcp-sync-bridge.log` instead of stdout.

## Installation

### Local development install

```bash
pi install /Users/fameftimie/work/pi-extensions
```

After editing the extension, run this inside Pi:

```text
/reload
```

### Temporary one-off load

```bash
pi -e /Users/fameftimie/work/pi-extensions
```

Use this for quick testing only. A normal `pi install` is better for ongoing use because the package remains in Pi's resource set.

### npm install, after publishing

```bash
pi install npm:@eovidiu/pi-extensions
```

To pin a published version:

```bash
pi install npm:@eovidiu/pi-extensions@0.1.0
```

## Quick start

1. Install the package.
2. Start or reload Pi.
3. Sync detected MCP configs:

```text
/mcp-sync
```

4. Inspect what was found:

```text
/mcp-status
```

5. Enable trusted servers explicitly.

Interactive TUI selector:

```text
/mcp-enable
```

Direct enable by name:

```text
/mcp-enable claude_desktop__filesystem
```

6. Ask Pi to use one of the registered MCP-backed tools.

7. Disable servers when you no longer need them.

Interactive TUI selector:

```text
/mcp-disable
```

Direct disable by name:

```text
/mcp-disable claude_desktop__filesystem
```

## Commands

| Command | Behavior |
|---|---|
| `/mcp-sync` | Rescan known Claude/Codex MCP config locations and update `~/.pi/mcp.json`. Newly discovered servers remain disabled. Enabled servers are started/registered after sync. |
| `/mcp-status` | Show tracked servers, enabled/disabled state, connection summary, config paths, and log path. |
| `/mcp-enable` | In interactive Pi sessions, rescan configs and open a selector for disabled detected servers. Selected servers are enabled, started, and registered. |
| `/mcp-enable <server>` | Enable one server directly, then start/register enabled MCP tools. |
| `/mcp-disable` | In interactive Pi sessions, open a selector for currently enabled servers. Selected servers are disabled, stopped, and their tools are deactivated. |
| `/mcp-disable <server>` | Disable one server directly, stop it, and deactivate its tools. |
| `/mcp-restart` | Restart all enabled MCP servers. |
| `/mcp-restart <server>` | Restart one MCP server. |

Interactive selectors use Pi's `ctx.ui.select()` API. They work in TUI/RPC-capable interactive contexts. In non-UI print/JSON mode, the extension avoids dialogs and reports direct command usage instead.

## Config files

### Global config

The extension owns this file:

```text
~/.pi/mcp.json
```

Example:

```json
{
  "version": 1,
  "autoStart": false,
  "servers": {
    "claude_desktop__filesystem": {
      "enabled": false,
      "managedBy": "pi-mcp-sync-bridge",
      "source": "claude-desktop",
      "sourceName": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/work"],
      "env": {}
    }
  },
  "maxOutputChars": 20000
}
```

Rules:

- Managed discovered entries have `managedBy: "pi-mcp-sync-bridge"`.
- Managed entries may be updated or removed by `/mcp-sync` when source configs change.
- Manual entries without that `managedBy` value are preserved.
- Existing managed `enabled` values are preserved during sync.
- Newly discovered managed entries are always added with `enabled: false`.

### Project override

A project can provide an override at:

```text
.pi/mcp.json
```

Project entries override global entries with the same server name for the current working directory. Project settings can also provide policy controls:

```json
{
  "version": 1,
  "autoStart": false,
  "servers": {},
  "allowServers": ["claude_desktop__filesystem", "codex__*"],
  "denyServers": ["*production*"],
  "maxOutputChars": 20000
}
```

Use project overrides carefully. Review `.pi/mcp.json` before running Pi in repositories you do not trust.

## Discovery sources

The extension probes common locations for MCP server definitions.

### Claude Desktop

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

### Claude Code

```text
~/.claude.json
~/.claude/settings.json
~/.config/claude-code/config.json
~/.config/claude-code/settings.json
```

### Codex

```text
~/.codex/config.toml
~/.codex/config.json
~/.config/codex/config.toml
~/.config/codex/config.json
```

Supported config maps include common `mcpServers`, `mcp_servers`, and `mcpServersConfig` shapes. Unsupported or malformed entries are skipped and logged.

## Implementation details

The extension is implemented as a Pi package with this manifest in `package.json`:

```json
{
  "keywords": ["pi-package", "pi-extension", "mcp"],
  "pi": {
    "extensions": ["./extensions/mcp-sync-bridge"]
  }
}
```

Main modules:

| File | Purpose |
|---|---|
| `extensions/mcp-sync-bridge/index.ts` | Pi extension entry point. Registers lifecycle hooks and slash commands. Starts/stops enabled servers and registers tools. |
| `config-discovery.ts` | Finds and parses known third-party MCP config files. Normalizes discovered server definitions. |
| `config-sync.ts` | Reads/writes `~/.pi/mcp.json`, merges discovered servers, preserves manual entries, validates names, and performs atomic writes. |
| `mcp-client.ts` | Starts MCP stdio server processes, initializes MCP clients, lists tools, forwards calls, and stops processes. |
| `schema-conversion.ts` | Converts supported MCP JSON Schema input schemas to Pi/typebox schemas. |
| `tool-registration.ts` | Generates Pi tool names, registers MCP-backed tools, truncates large outputs, and deactivates tools when servers stop. |
| `logger.ts` | Writes redacted diagnostic logs to `~/.pi/mcp-sync-bridge.log`. |
| `types.ts` | Shared config and discovery types. |

### Startup/session lifecycle

On `session_start`:

1. Discover external MCP configs.
2. Sync discovered servers into `~/.pi/mcp.json`.
3. Read the effective config, including optional project overrides.
4. Stop servers that are no longer enabled.
5. Start enabled servers only.
6. Register supported tools from running servers.
7. Notify a short summary in the TUI.

On `session_shutdown`:

1. Deactivate all registered MCP-backed tools.
2. Stop all running MCP server processes.

### Enable/disable lifecycle

`/mcp-enable` with no argument:

1. Runs discovery/sync first so newly detected servers appear.
2. Reads the global config.
3. Lists disabled servers.
4. Opens a selector in interactive Pi sessions.
5. Enables selected servers in `~/.pi/mcp.json`.
6. Starts enabled servers and registers tools.

`/mcp-disable` with no argument:

1. Reads the effective config.
2. Lists enabled servers.
3. Opens a selector in interactive Pi sessions.
4. Disables selected servers in `~/.pi/mcp.json`.
5. Stops selected servers and deactivates their tools.

Direct commands, such as `/mcp-enable <server>` and `/mcp-disable <server>`, skip the selector.

### Tool naming

Generated Pi tool names are prefixed with `mcp_` and include the normalized source/server/tool identity. Example:

```text
mcp_claude_desktop_filesystem_read_file
```

If a generated name collides, the registrar appends a deterministic short suffix.

### Schema conversion

The initial schema converter intentionally supports a conservative subset:

- object schemas
- required fields
- strings
- numbers
- integers
- booleans
- arrays
- nested objects
- simple string enums

Unsupported complex schemas are skipped for that specific MCP tool rather than crashing the extension.

### Output handling

MCP tool outputs can be large. The extension respects `maxOutputChars` and truncates returned tool text so Pi conversations do not balloon unexpectedly.

### Logging and secrets

The extension does not log to stdout because Pi owns stdout/TUI rendering. Detailed diagnostics go to:

```text
~/.pi/mcp-sync-bridge.log
```

Logs redact common secret-bearing keys such as token, key, secret, password, auth, and credential. Still, avoid storing literal secrets in config files when possible.

## Examples and fixtures

- `examples/mcp.json.example` — example global Pi MCP config.
- `examples/project-mcp.override.example.json` — example project override.
- `fixtures/` — known third-party config shapes used by tests.

## Development

Install dependencies:

```bash
npm install
```

Run checks:

```bash
npm run typecheck
npm test
```

Preview npm package contents before publishing:

```bash
npm pack --dry-run
```

## Publishing

For a scoped public npm package:

```bash
npm run typecheck
npm test
npm pack --dry-run
npm publish --access public
```

The package includes only the files listed in `package.json`'s `files` field.

## Security checklist before enabling a server

1. Run `/mcp-status` and inspect the server name, source, and command.
2. Open `~/.pi/mcp.json` and review `command`, `args`, and `env`.
3. Prefer environment variable references over literal secret values.
4. Use `allowServers` and `denyServers` for project-level hardening.
5. Review project-local `.pi/mcp.json` files before using Pi in untrusted repositories.
6. Disable servers you are not actively using.

See `SECURITY.md` for the short-form security policy.

## License

MIT. See `LICENSE`.
