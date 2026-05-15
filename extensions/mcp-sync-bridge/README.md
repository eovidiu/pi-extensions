# mcp-sync-bridge

Explicit opt-in MCP compatibility bridge for Pi.

Current implementation covers Phase 1 through Phase 4:

- discovers MCP config candidates from Claude Desktop, Claude Code, and Codex
- syncs supported server entries into `~/.pi/mcp.json`
- preserves manually added Pi MCP server entries
- preserves `enabled` values for previously discovered managed entries
- defaults newly discovered servers to `enabled: false`
- writes a redacted debug log to `~/.pi/mcp-sync-bridge.log`
- provides explicit enable/disable controls with server-name validation and completions
- serializes in-process config mutations to avoid command-handler races
- starts enabled MCP stdio servers only
- initializes MCP client sessions and lists tools
- converts a conservative JSON Schema subset to Pi/typebox tool schemas
- registers supported MCP tools as Pi tools
- forwards Pi tool calls to MCP `tools/call`
- stops/deactivates tools on disable, restart, and session shutdown

## Commands

```text
/mcp-sync
/mcp-status
/mcp-enable <server>
/mcp-disable <server>
/mcp-restart
```

`/mcp-enable` updates `~/.pi/mcp.json` and immediately attempts to start that enabled server. `/mcp-disable` stops the server and deactivates its Pi tools. `/mcp-restart` restarts one enabled server or all enabled servers.

## Safety invariant

Installing or reloading this extension must never execute newly discovered MCP server commands. Discovered servers are synced as disabled by default and must be explicitly enabled before future bridge phases may start them.
