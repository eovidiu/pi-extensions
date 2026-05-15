import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverMcpServers } from "./config-discovery.js";
import { PI_MCP_CONFIG_PATH, readPiMcpConfig, setServerEnabled, summarizeConfig, syncPiMcpConfig } from "./config-sync.js";
import { getLogPath, logDebug } from "./logger.js";

export default function mcpSyncBridge(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    try {
      const result = await runSync();
      notify(ctx, `MCP sync complete: ${result.discoveredCount} discovered, ${result.added.length} added, ${result.removed.length} removed. New servers are disabled by default.`);
    } catch (error) {
      await logDebug("MCP sync failed on session_start", { error: errorMessage(error) });
      notify(ctx, `MCP sync failed. See ${getLogPath()}`, "error");
    }
  });

  pi.registerCommand("mcp-sync", {
    description: "Rescan Claude/Codex MCP configs and update ~/.pi/mcp.json without enabling new servers",
    handler: async (_args, ctx) => {
      try {
        const result = await runSync();
        notify(ctx, [
          `MCP sync complete. Config: ${result.configPath}`,
          `Discovered: ${result.discoveredCount}`,
          `Added: ${result.added.length ? result.added.join(", ") : "none"}`,
          `Updated: ${result.updated.length}`,
          `Removed: ${result.removed.length ? result.removed.join(", ") : "none"}`,
          `Enabled: ${result.enabled.length}`,
          `Disabled: ${result.disabled.length}`,
          `Log: ${getLogPath()}`,
        ].join("\n"));
      } catch (error) {
        await logDebug("/mcp-sync failed", { error: errorMessage(error) });
        notify(ctx, `MCP sync failed. See ${getLogPath()}`, "error");
      }
    },
  });

  pi.registerCommand("mcp-status", {
    description: "Show MCP servers tracked by the Pi MCP sync bridge",
    handler: async (_args, ctx) => {
      try {
        const config = await readPiMcpConfig();
        notify(ctx, `Pi MCP config: ${PI_MCP_CONFIG_PATH}\n${summarizeConfig(config)}\n\nLog: ${getLogPath()}`);
      } catch (error) {
        await logDebug("/mcp-status failed", { error: errorMessage(error) });
        notify(ctx, `MCP status failed. See ${getLogPath()}`, "error");
      }
    },
  });

  pi.registerCommand("mcp-enable", {
    description: "Enable an MCP server by name. Phase 2 only updates config; it does not start the server yet.",
    handler: async (args, ctx) => {
      const name = args.trim();
      if (!name) {
        notify(ctx, "Usage: /mcp-enable <server>", "error");
        return;
      }
      try {
        await setServerEnabled(name, true);
        notify(ctx, `Enabled ${name} in ${PI_MCP_CONFIG_PATH}. MCP process startup is not implemented until the bridge phase.`);
      } catch (error) {
        await logDebug("/mcp-enable failed", { name, error: errorMessage(error) });
        notify(ctx, errorMessage(error), "error");
      }
    },
  });

  pi.registerCommand("mcp-disable", {
    description: "Disable an MCP server by name",
    handler: async (args, ctx) => {
      const name = args.trim();
      if (!name) {
        notify(ctx, "Usage: /mcp-disable <server>", "error");
        return;
      }
      try {
        await setServerEnabled(name, false);
        notify(ctx, `Disabled ${name} in ${PI_MCP_CONFIG_PATH}.`);
      } catch (error) {
        await logDebug("/mcp-disable failed", { name, error: errorMessage(error) });
        notify(ctx, errorMessage(error), "error");
      }
    },
  });

  pi.registerCommand("mcp-restart", {
    description: "Restart MCP servers. Placeholder until MCP stdio bridge is implemented.",
    handler: async (_args, ctx) => {
      notify(ctx, "MCP restart is not implemented yet. Phase 2 sync/config commands are available; server startup comes in the bridge phase.", "warn");
    },
  });
}

async function runSync() {
  const discovery = await discoverMcpServers();
  await logDebug("MCP discovery complete", discovery.events);
  return syncPiMcpConfig(discovery.servers);
}

function notify(ctx: unknown, message: string, level: "info" | "warn" | "error" = "info") {
  const maybeCtx = ctx as { hasUI?: boolean; ui?: { notify?: (message: string, level?: string) => void } };
  if (maybeCtx.hasUI === false) return;
  maybeCtx.ui?.notify?.(message, level);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
