# @eovidiu/pi-extensions

Personal [Pi](https://pi.dev) extensions.

## Extensions

- `mcp-sync-bridge`: explicit opt-in compatibility layer that discovers MCP server configs from other tools and syncs them into `~/.pi/mcp.json` without starting newly discovered servers.

## Local use

```bash
pi install /Users/fameftimie/work/pi-extensions
```

Or temporarily:

```bash
pi -e /Users/fameftimie/work/pi-extensions
```

After edits, use `/reload` in Pi.

## Security

Pi extensions and MCP servers execute with your user permissions. Review extension source and MCP server commands before enabling servers.
