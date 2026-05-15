# mcp-bridge

Explicit opt-in MCP compatibility bridge for Pi.

Current implementation covers Phase 1 through Phase 4:

- discovers MCP config candidates from Claude Desktop, Claude Code, and Codex
- syncs supported server entries into `~/.pi/mcp.json`
- preserves manually added Pi MCP server entries
- preserves `enabled` values for previously discovered managed entries
- defaults newly discovered servers to `enabled: false`
- writes a redacted debug log to `~/.pi/mcp-bridge.log`
- provides explicit enable/disable controls with server-name validation and completions
- serializes in-process config mutations to avoid command-handler races
- starts enabled MCP stdio servers only
- initializes MCP client sessions and lists tools
- converts a conservative JSON Schema subset to Pi/typebox tool schemas
- registers supported MCP tools as Pi tools
- forwards Pi tool calls to MCP `tools/call`
- stops/deactivates tools on disable, restart, and session shutdown
- supports project-local `.pi/mcp.json` overrides
- supports `allowServers`, `denyServers`, and `maxOutputChars`
- includes fixtures/tests for hardening

## Commands

```text
/mcp-sync
/mcp-status
/mcp-enable [server]
/mcp-disable [server]
/mcp-restart
```

`/mcp-enable <server>` updates `~/.pi/mcp.json` and immediately attempts to start that enabled server. In interactive Pi sessions, `/mcp-enable` with no argument rescans detected MCP configs, opens a small selector for disabled servers, and enables the selected servers. `/mcp-disable <server>` stops the server and deactivates its Pi tools. In interactive Pi sessions, `/mcp-disable` with no argument opens a small selector for enabled servers and disables the selected servers. `/mcp-restart` restarts one enabled server or all enabled servers.

## Config hardening

Optional settings in `~/.pi/mcp.json` or project-local `.pi/mcp.json`:

```json
{
  "allowServers": ["claude_desktop__filesystem", "codex__*"],
  "denyServers": ["*production*"],
  "maxOutputChars": 20000
}
```

## Safety invariant

Installing or reloading this extension must never execute newly discovered MCP server commands. Discovered servers are synced as disabled by default and must be explicitly enabled before future bridge phases may start them.
