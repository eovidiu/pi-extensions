import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { MANAGED_BY, type DiscoveredMcpServer, type McpServerConfig, type PiMcpConfig, type SyncResult } from "./types.js";
import { logDebug } from "./logger.js";

export const PI_MCP_CONFIG_PATH = join(homedir(), ".pi", "mcp.json");

export async function readPiMcpConfig(path = PI_MCP_CONFIG_PATH): Promise<PiMcpConfig> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as Partial<PiMcpConfig>;
    return normalizePiConfig(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyConfig();
    }
    await logDebug("Failed to read existing Pi MCP config; using empty config", { path, error: errorMessage(error) });
    return emptyConfig();
  }
}

export async function syncPiMcpConfig(discovered: Record<string, DiscoveredMcpServer>, path = PI_MCP_CONFIG_PATH): Promise<SyncResult> {
  const existing = await readPiMcpConfig(path);
  const next: PiMcpConfig = {
    version: 1,
    autoStart: existing.autoStart === true,
    servers: {},
  };

  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  const preservedManual: string[] = [];

  for (const [name, server] of Object.entries(existing.servers)) {
    if (server.managedBy === MANAGED_BY) {
      if (!discovered[name]) removed.push(name);
      continue;
    }
    next.servers[name] = server;
    preservedManual.push(name);
  }

  for (const [name, server] of Object.entries(discovered)) {
    const previous = existing.servers[name];
    const enabled = previous?.managedBy === MANAGED_BY ? previous.enabled === true : false;
    next.servers[name] = {
      enabled,
      managedBy: MANAGED_BY,
      source: server.source,
      sourceName: server.sourceName,
      command: server.command,
      args: server.args ?? [],
      env: server.env ?? {},
    };
    if (previous?.managedBy === MANAGED_BY) updated.push(name);
    else added.push(name);
  }

  await writeJsonAtomic(path, next);

  const enabled = Object.entries(next.servers).filter(([, s]) => s.enabled).map(([name]) => name);
  const disabled = Object.entries(next.servers).filter(([, s]) => !s.enabled).map(([name]) => name);

  const result: SyncResult = {
    configPath: path,
    discoveredCount: Object.keys(discovered).length,
    added,
    updated,
    removed,
    preservedManual,
    enabled,
    disabled,
  };
  await logDebug("Synced Pi MCP config", result);
  return result;
}

export async function setServerEnabled(name: string, enabled: boolean, path = PI_MCP_CONFIG_PATH): Promise<PiMcpConfig> {
  const config = await readPiMcpConfig(path);
  const server = config.servers[name];
  if (!server) throw new Error(`Unknown MCP server: ${name}`);
  config.servers[name] = { ...server, enabled };
  await writeJsonAtomic(path, config);
  await logDebug(enabled ? "Enabled MCP server" : "Disabled MCP server", { name });
  return config;
}

export function summarizeConfig(config: PiMcpConfig): string {
  const names = Object.keys(config.servers).sort();
  if (names.length === 0) return "No MCP servers configured.";
  return names
    .map((name) => {
      const server = config.servers[name];
      const source = server.source ? ` (${server.source})` : "";
      return `${server.enabled ? "enabled " : "disabled"} ${name}${source}`;
    })
    .join("\n");
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

function normalizePiConfig(parsed: Partial<PiMcpConfig>): PiMcpConfig {
  const servers: Record<string, McpServerConfig> = {};
  const rawServers = parsed.servers && typeof parsed.servers === "object" ? parsed.servers : {};
  for (const [name, raw] of Object.entries(rawServers)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const obj = raw as Partial<McpServerConfig>;
    if (typeof obj.command !== "string") continue;
    servers[name] = {
      enabled: obj.enabled === true,
      managedBy: typeof obj.managedBy === "string" ? obj.managedBy : undefined,
      source: typeof obj.source === "string" ? obj.source : undefined,
      sourceName: typeof obj.sourceName === "string" ? obj.sourceName : undefined,
      command: obj.command,
      args: Array.isArray(obj.args) ? obj.args.filter((arg): arg is string => typeof arg === "string") : [],
      env: normalizeEnv(obj.env),
    };
  }
  return {
    version: 1,
    autoStart: parsed.autoStart === true,
    servers,
  };
}

function emptyConfig(): PiMcpConfig {
  return { version: 1, autoStart: false, servers: {} };
}

function normalizeEnv(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
