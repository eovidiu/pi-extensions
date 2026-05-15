import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverMcpServers } from "./config-discovery.js";
import {
  getServerOrThrow,
  listDisabledServerNames,
  listEnabledServerNames,
  listServerNames,
  PI_MCP_CONFIG_PATH,
  PROJECT_MCP_CONFIG_PATH,
  readEffectivePiMcpConfig,
  readPiMcpConfig,
  setServerEnabled,
  summarizeConfig,
  syncPiMcpConfig,
  validateServerName,
} from "./config-sync.js";
import { getLogPath, logDebug } from "./logger.js";
import { McpBridgeRuntime } from "./mcp-client.js";
import { McpToolRegistrar } from "./tool-registration.js";

export default function mcpSyncBridge(pi: ExtensionAPI) {
  const runtime = new McpBridgeRuntime();
  const registrar = new McpToolRegistrar(pi, runtime);

  pi.on("session_start", async (_event, ctx) => {
    try {
      const result = await runSync();
      const config = await readEffectivePiMcpConfig();
      const registered = await startEnabledAndRegister(runtime, registrar, config);
      notify(ctx, [
        `MCP sync complete: ${result.discoveredCount} discovered, ${result.added.length} added, ${result.removed.length} removed.`,
        "New servers are disabled by default.",
        `Enabled MCP tools active: ${registered.length}`,
      ].join("\n"));
    } catch (error) {
      await logDebug("MCP startup failed on session_start", { error: errorMessage(error) });
      notify(ctx, `MCP startup failed. See ${getLogPath()}`, "error");
    }
  });

  pi.on("session_shutdown", async () => {
    registrar.deactivateAll();
    await runtime.stopAll();
  });

  pi.registerCommand("mcp-sync", {
    description: "Rescan Claude/Codex MCP configs and update ~/.pi/mcp.json without enabling new servers",
    handler: async (_args, ctx) => {
      try {
        const result = await runSync();
        const config = await readEffectivePiMcpConfig();
        const registered = await startEnabledAndRegister(runtime, registrar, config);
        notify(ctx, [
          `MCP sync complete. Config: ${result.configPath}`,
          `Discovered: ${result.discoveredCount}`,
          `Added: ${result.added.length ? result.added.join(", ") : "none"}`,
          `Updated: ${result.updated.length}`,
          `Removed: ${result.removed.length ? result.removed.join(", ") : "none"}`,
          `Enabled servers: ${result.enabled.length}`,
          `Disabled servers: ${result.disabled.length}`,
          `Active MCP tools: ${registered.length}`,
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
        const config = await readEffectivePiMcpConfig();
        const enabled = listEnabledServerNames(config);
        notify(ctx, [
          `Pi MCP config: ${PI_MCP_CONFIG_PATH}`,
          `Project override: ${PROJECT_MCP_CONFIG_PATH}`,
          summarizeConfig(config),
          "",
          `Enabled servers: ${enabled.length ? enabled.join(", ") : "none"}`,
          runtime.getConnectionSummary(),
          `Log: ${getLogPath()}`,
        ].join("\n"));
      } catch (error) {
        await logDebug("/mcp-status failed", { error: errorMessage(error) });
        notify(ctx, `MCP status failed. See ${getLogPath()}`, "error");
      }
    },
  });

  pi.registerCommand("mcp-enable", {
    description: "Enable and start one or more disabled MCP servers",
    getArgumentCompletions: serverNameCompletions,
    handler: async (args, ctx) => {
      const name = args.trim();
      if (name) {
        const parsed = parseServerArg(args, "/mcp-enable [server]");
        if (!parsed.ok) {
          notify(ctx, parsed.message, "error");
          return;
        }
        try {
          const result = await setServerEnabled(parsed.name, true);
          const config = await readEffectivePiMcpConfig();
          const registered = await startEnabledAndRegister(runtime, registrar, config);
          const status = result.changed ? "Enabled" : "Already enabled";
          notify(ctx, `${status} ${parsed.name}. Active MCP tools: ${registered.length}.`);
        } catch (error) {
          await logDebug("/mcp-enable failed", { name: parsed.name, error: errorMessage(error) });
          notify(ctx, errorMessage(error), "error");
        }
        return;
      }

      try {
        const sync = await runSync();
        const homeConfig = await readPiMcpConfig();
        const disabled = listDisabledServerNames(homeConfig);
        if (disabled.length === 0) {
          notify(ctx, `No disabled MCP servers found. Sync complete: ${sync.discoveredCount} discovered.`);
          return;
        }

        if (!hasSelectableUi(ctx)) {
          notify(ctx, [`Usage: /mcp-enable <server>`, `Disabled servers: ${disabled.join(", ")}`].join("\n"));
          return;
        }

        const selected = await selectDisabledServersToEnable(ctx, homeConfig, disabled);
        if (selected.length === 0) {
          notify(ctx, "No MCP servers enabled.");
          return;
        }

        const changed: string[] = [];
        const alreadyEnabled: string[] = [];
        for (const serverName of selected) {
          const result = await setServerEnabled(serverName, true);
          if (result.changed) changed.push(serverName);
          else alreadyEnabled.push(serverName);
        }

        const config = await readEffectivePiMcpConfig();
        const registered = await startEnabledAndRegister(runtime, registrar, config);
        notify(ctx, [
          `Enabled MCP servers: ${changed.length ? changed.join(", ") : "none"}`,
          alreadyEnabled.length ? `Already enabled: ${alreadyEnabled.join(", ")}` : undefined,
          `Active MCP tools: ${registered.length}`,
        ].filter((line): line is string => Boolean(line)).join("\n"));
      } catch (error) {
        await logDebug("/mcp-enable failed", { error: errorMessage(error) });
        notify(ctx, errorMessage(error), "error");
      }
    },
  });

  pi.registerCommand("mcp-disable", {
    description: "Disable and stop one or more enabled MCP servers",
    getArgumentCompletions: serverNameCompletions,
    handler: async (args, ctx) => {
      const name = args.trim();
      if (name) {
        const parsed = parseServerArg(args, "/mcp-disable [server]");
        if (!parsed.ok) {
          notify(ctx, parsed.message, "error");
          return;
        }
        try {
          const result = await setServerEnabled(parsed.name, false);
          const removed = await runtime.stopServer(parsed.name);
          registrar.deactivateTools(removed);
          const status = result.changed ? "Disabled" : "Already disabled";
          notify(ctx, `${status} ${parsed.name}. Deactivated MCP tools: ${removed.length}.`);
        } catch (error) {
          await logDebug("/mcp-disable failed", { name: parsed.name, error: errorMessage(error) });
          notify(ctx, errorMessage(error), "error");
        }
        return;
      }

      try {
        const config = await readEffectivePiMcpConfig();
        const enabled = listEnabledServerNames(config);
        if (enabled.length === 0) {
          notify(ctx, "No enabled MCP servers found.");
          return;
        }

        if (!hasSelectableUi(ctx)) {
          notify(ctx, [`Usage: /mcp-disable <server>`, `Enabled servers: ${enabled.join(", ")}`].join("\n"));
          return;
        }

        const selected = await selectServersToDisable(ctx, config, enabled);
        if (selected.length === 0) {
          notify(ctx, "No MCP servers disabled.");
          return;
        }

        const changed: string[] = [];
        const alreadyDisabled: string[] = [];
        let deactivatedTools = 0;
        for (const serverName of selected) {
          const result = await setServerEnabled(serverName, false);
          if (result.changed) changed.push(serverName);
          else alreadyDisabled.push(serverName);
          const removed = await runtime.stopServer(serverName);
          registrar.deactivateTools(removed);
          deactivatedTools += removed.length;
        }

        notify(ctx, [
          `Disabled MCP servers: ${changed.length ? changed.join(", ") : "none"}`,
          alreadyDisabled.length ? `Already disabled: ${alreadyDisabled.join(", ")}` : undefined,
          `Deactivated MCP tools: ${deactivatedTools}`,
        ].filter((line): line is string => Boolean(line)).join("\n"));
      } catch (error) {
        await logDebug("/mcp-disable failed", { error: errorMessage(error) });
        notify(ctx, errorMessage(error), "error");
      }
    },
  });

  pi.registerCommand("mcp-restart", {
    description: "Restart one enabled MCP server or all enabled MCP servers",
    getArgumentCompletions: serverNameCompletions,
    handler: async (args, ctx) => {
      try {
        const config = await readEffectivePiMcpConfig();
        const name = args.trim();
        if (name) {
          validateServerName(name);
          getServerOrThrow(config, name);
          const removed = await runtime.stopServer(name);
          registrar.deactivateTools(removed);
          await runtime.restartServer(name, config);
          const active = await registrar.registerBindings(runtime.getToolBindings());
          notify(ctx, `Restarted ${name}. Active MCP tools: ${active.length}.`);
          return;
        }

        const enabled = listEnabledServerNames(config);
        const removed = await runtime.stopAll();
        registrar.deactivateTools(removed);
        const active = await startEnabledAndRegister(runtime, registrar, config);
        notify(ctx, enabled.length
          ? `Restarted enabled MCP servers: ${enabled.join(", ")}. Active MCP tools: ${active.length}.`
          : "No enabled MCP servers to restart.");
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

async function startEnabledAndRegister(runtime: McpBridgeRuntime, registrar: McpToolRegistrar, config: Awaited<ReturnType<typeof readPiMcpConfig>>): Promise<string[]> {
  registrar.setMaxOutputChars(config.maxOutputChars);
  const removed = await runtime.stopNotEnabled(config);
  registrar.deactivateTools(removed);
  const bindings = await runtime.startEnabled(config);
  return registrar.registerBindings(bindings);
}

async function serverNameCompletions(prefix: string) {
  const config = await readEffectivePiMcpConfig();
  const lower = prefix.toLowerCase();
  const items = listServerNames(config)
    .filter((name) => name.toLowerCase().startsWith(lower) || name.toLowerCase().includes(lower))
    .map((name) => ({ value: name, label: `${name}${config.servers[name].enabled ? " (enabled)" : " (disabled)"}` }));
  return items.length ? items : null;
}

async function selectDisabledServersToEnable(ctx: SelectableContext, config: Awaited<ReturnType<typeof readPiMcpConfig>>, disabled: string[]): Promise<string[]> {
  return selectServers(ctx, config, disabled, "Select MCP servers to enable", "Enable selected");
}

async function selectServersToDisable(ctx: SelectableContext, config: Awaited<ReturnType<typeof readPiMcpConfig>>, enabled: string[]): Promise<string[]> {
  return selectServers(ctx, config, enabled, "Select MCP servers to disable", "Disable selected");
}

async function selectServers(ctx: SelectableContext, config: Awaited<ReturnType<typeof readPiMcpConfig>>, names: string[], title: string, actionLabel: string): Promise<string[]> {
  const selected = new Set<string>();

  while (true) {
    const options = [
      ...names.map((name) => formatServerSelectionOption(name, config, selected.has(name))),
      selected.size > 0 ? `${actionLabel} (${selected.size})` : actionLabel,
      "Cancel",
    ];

    const choice = await ctx.ui.select(title, options);
    if (!choice || choice === "Cancel") return [];
    if (choice.startsWith(actionLabel)) return [...selected].sort();

    const serverName = parseServerNameFromSelection(choice);
    if (!serverName) continue;
    if (selected.has(serverName)) selected.delete(serverName);
    else selected.add(serverName);
  }
}

function formatServerSelectionOption(name: string, config: Awaited<ReturnType<typeof readPiMcpConfig>>, selected: boolean): string {
  const server = config.servers[name];
  const source = server.source ? ` source=${server.source}` : "";
  return `${selected ? "[✓]" : "[ ]"} ${name}${source} command=${server.command}`;
}

function parseServerNameFromSelection(choice: string): string | null {
  const match = /^\[[ ✓]\] (\S+)/.exec(choice);
  return match?.[1] ?? null;
}

interface SelectableContext {
  ui: {
    select(title: string, options: string[]): Promise<string | undefined>;
  };
}

function hasSelectableUi(ctx: unknown): ctx is SelectableContext {
  const maybeCtx = ctx as { hasUI?: boolean; ui?: { select?: unknown } };
  return maybeCtx.hasUI !== false && typeof maybeCtx.ui?.select === "function";
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
