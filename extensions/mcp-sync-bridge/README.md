# mcp-sync-bridge

Explicit opt-in MCP compatibility bridge for Pi.

Current implementation covers Phase 1 and Phase 2:

- discovers MCP config candidates from Claude Desktop, Claude Code, and Codex
- syncs supported server entries into `~/.pi/mcp.json`
- preserves manually added Pi MCP server entries
- preserves `enabled` values for previously discovered managed entries
- defaults newly discovered servers to `enabled: false`
- writes a redacted debug log to `~/.pi/mcp-sync-bridge.log`
- does **not** start MCP servers or register MCP tools yet

## Commands

```text
/mcp-sync
/mcp-status
/mcp-enable <server>
/mcp-disable <server>
/mcp-restart
```

`/mcp-enable` and `/mcp-disable` currently only update `~/.pi/mcp.json`. Server process startup is intentionally deferred to the MCP bridge phase.

## Safety invariant

Installing or reloading this extension must never execute newly discovered MCP server commands. Discovered servers are synced as disabled by default and must be explicitly enabled before future bridge phases may start them.
