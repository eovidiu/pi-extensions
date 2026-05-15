# Security

Pi extensions execute with your user permissions. MCP servers started by this package also execute with your user permissions.

Before enabling an MCP server:

1. Review the command and arguments in `~/.pi/mcp.json`.
2. Prefer environment-variable references over literal secrets.
3. Use `enabled: false` until you intentionally want to start a server.
4. Use `allowServers` / `denyServers` to restrict startup when needed.
5. Review project-local `.pi/mcp.json` files before running Pi in untrusted repositories.

This extension redacts common secret key names in logs, but you should still avoid storing literal secrets in config files.
