# @eovidiu/pi-extensions

Personal [Pi](https://pi.dev) extensions.

## Extensions

### `mcp-sync-bridge`

An explicit opt-in MCP compatibility layer for Pi.

Pi does not ship built-in MCP support. This package provides a local bridge for reusing trusted MCP server configs from Claude Desktop, Claude Code, and Codex.

The bridge:

- discovers MCP configs from known Claude/Codex locations
- syncs discovered servers into `~/.pi/mcp.json`
- keeps newly discovered servers disabled by default
- starts only servers with `enabled: true`
- lists MCP tools and registers supported tools as Pi tools
- forwards Pi tool calls to MCP `tools/call`
- stops/deactivates tools on disable, restart, and session shutdown

## Local use

```bash
pi install /Users/fameftimie/work/pi-extensions
```

Or temporarily:

```bash
pi -e /Users/fameftimie/work/pi-extensions
```

After edits, use `/reload` in Pi.

## Commands

```text
/mcp-sync
/mcp-status
/mcp-enable <server>
/mcp-disable <server>
/mcp-restart [server]
```

Recommended first run:

```text
/mcp-sync
/mcp-status
```

Inspect `~/.pi/mcp.json`, then explicitly enable one trusted server:

```text
/mcp-enable claude_desktop__filesystem
```

## Config files

Global Pi MCP config:

```text
~/.pi/mcp.json
```

Optional project override, read from the current working directory:

```text
.pi/mcp.json
```

Project config entries override global entries with the same server name. Project config can also set:

```json
{
  "allowServers": ["claude_desktop__filesystem", "codex__*"],
  "denyServers": ["*production*"],
  "maxOutputChars": 20000
}
```

See `examples/` for config examples and `fixtures/` for known third-party config shapes.

## Development

```bash
npm install
npm run typecheck
npm test
```

## Security

Pi extensions and MCP servers execute with your user permissions. Review extension source and MCP server commands before enabling servers. Newly discovered servers are always synced as disabled. See `SECURITY.md`.
