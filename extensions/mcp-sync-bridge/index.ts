import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverMcpServers } from "./config-discovery.js";
import {
  getServerOrThrow,
  listEnabledServerNames,
  listServerNames,
  PI_MCP_CONFIG_PATH,
  readPiMcpConfig,
  setServerEnabled,
  summarizeConfig,
  syncPiMcpConfig,
  validateServerName,
} from "./config-sync.js";
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
        const enabled = listEnabledServerNames(config);
        notify(ctx, [
          `Pi MCP config: ${PI_MCP_CONFIG_PATH}`,
          summarizeConfig(config),
          "",
          `Enabled servers: ${enabled.length ? enabled.join(", ") : "none"}`,
          "Bridge state: MCP server startup/tool registration not implemented yet.",
          `Log: ${getLogPath()}`,
        ].join("\n"));
      } catch (error) {
        await logDebug("/mcp-status failed", { error: errorMessage(error) });
        notify(ctx, `MCP status failed. See ${getLogPath()}`, "error");
      }
    },
  });

  pi.registerCommand("mcp-enable", {
    description: "Enable an MCP server by name. This updates config only until the bridge phase starts enabled servers.",
    getArgumentCompletions: serverNameCompletions,
    handler: async (args, ctx) => {
      const parsed = parseServerArg(args, "/mcp-enable <server>");
      if (!parsed.ok) {
        notify(ctx, parsed.message, "error");
        return;
      }
      try {
        const result = await setServerEnabled(parsed.name, true);
        const already = result.changed ? "Enabled" : "Already enabled";
        notify(ctx, `${already} ${parsed.name} in ${PI_MCP_CONFIG_PATH}. MCP process startup is not implemented until the bridge phase.`);
      } catch (error) {
        await logDebug("/mcp-enable failed", { name: parsed.name, error: errorMessage(error) });
        notify(ctx, errorMessage(error), "error");
      }
    },
  });

  pi.registerCommand("mcp-disable", {
    description: "Disable an MCP server by name",
    getArgumentCompletions: serverNameCompletions,
    handler: async (args, ctx) => {
      const parsed = parseServerArg(args, "/mcp-disable <server>");
      if (!parsed.ok) {
        notify(ctx, parsed.message, "error");
        return;
      }
      try {
        const result = await setServerEnabled(parsed.name, false);
        const already = result.changed ? "Disabled" : "Already disabled";
        notify(ctx, `${already} ${parsed.name} in ${PI_MCP_CONFIG_PATH}.`);
      } catch (error) {
        await logDebug("/mcp-disable failed", { name: parsed.name, error: errorMessage(error) });
        notify(ctx, errorMessage(error), "error");
      }
    },
  });

  pi.registerCommand("mcp-restart", {
    description: "Validate restart target. Actual restart is deferred until MCP stdio bridge is implemented.",
    getArgumentCompletions: serverNameCompletions,
    handler: async (args, ctx) => {
      try {
        const config = await readPiMcpConfig();
        const name = args.trim();
        if (name) {
          validateServerName(name);
          const server = getServerOrThrow(config, name);
          const enabledNote = server.enabled ? "would restart when bridge is implemented" : "is disabled; enable it before bridge startup";
          notify(ctx, `Validated ${name}: ${enabledNote}. No MCP process was started.`, "warn");
          return;
        }

        const enabled = listEnabledServerNames(config);
        notify(ctx, enabled.length
          ? `Validated restart for enabled servers: ${enabled.join(", ")}. No MCP processes were started; bridge phase is not implemented yet.`
          : "No enabled MCP servers to restart. No MCP processes were started.", "warn");
      } catch (error) {
        await logDebug("/mcp-restart failed", { args, error: errorMessage(error) });
        notify(ctx, errorMessage(error), "error");
      }
    },
  });
}

async function runSync() {
  const discovery = await discoverMcpServers();
  await logDebug("MCP discovery complete", discovery.events);
  return syncPiMcpConfig(discovery.servers);
}

async function serverNameCompletions(prefix: string) {
  const config = await readPiMcpConfig();
  const lower = prefix.toLowerCase();
  const items = listServerNames(config)
    .filter((name) => name.toLowerCase().startsWith(lower) || name.toLowerCase().includes(lower))
    .map((name) => ({ value: name, label: `${name}${config.servers[name].enabled ? " (enabled)" : " (disabled)"}` }));
  return items.length ? items : null;
}

function parseServerArg(args: string, usage: string): { ok: true; name: string } | { ok: false; message: string } {
  const trimmed = args.trim();
  if (!trimmed) return { ok: false, message: `Usage: ${usage}` };
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 1) return { ok: false, message: `Usage: ${usage}` };
  try {
    validateServerName(parts[0]);
    return { ok: true, name: parts[0] };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

function notify(ctx: unknown, message: string, level: "info" | "warn" | "error" = "info") {
  const maybeCtx = ctx as { hasUI?: boolean; ui?: { notify?: (message: string, level?: string) => void } };
  if (maybeCtx.hasUI === false) return;
  maybeCtx.ui?.notify?.(message, level);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
