import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { MANAGED_BY, type DiscoveredMcpServer, type McpServerConfig, type PiMcpConfig, type SyncResult } from "./types.js";
import { logDebug } from "./logger.js";

export const PI_MCP_CONFIG_PATH = join(homedir(), ".pi", "mcp.json");
export const PROJECT_MCP_CONFIG_PATH = join(process.cwd(), ".pi", "mcp.json");

let mutationQueue: Promise<unknown> = Promise.resolve();

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
  return withConfigMutation(async () => {
    const existing = await readPiMcpConfig(path);
    const next: PiMcpConfig = {
      version: 1,
      autoStart: existing.autoStart === true,
      servers: {},
      allowServers: existing.allowServers,
      denyServers: existing.denyServers,
      maxOutputChars: existing.maxOutputChars,
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
  });
}

export interface SetServerEnabledResult {
  config: PiMcpConfig;
  server: McpServerConfig;
  changed: boolean;
}

export async function setServerEnabled(name: string, enabled: boolean, path = PI_MCP_CONFIG_PATH): Promise<SetServerEnabledResult> {
  return withConfigMutation(async () => {
    const config = await readPiMcpConfig(path);
    const server = getServerOrThrow(config, name);
    const changed = server.enabled !== enabled;
    config.servers[name] = { ...server, enabled };
    await writeJsonAtomic(path, config);
    await logDebug(enabled ? "Enabled MCP server" : "Disabled MCP server", { name, changed });
    return { config, server: config.servers[name], changed };
  });
}

export function getServerOrThrow(config: PiMcpConfig, name: string): McpServerConfig {
  validateServerName(name);
  const server = config.servers[name];
  if (!server) {
    const suggestions = suggestServerNames(config, name);
    const hint = suggestions.length ? ` Did you mean: ${suggestions.join(", ")}?` : "";
    throw new Error(`Unknown MCP server: ${name}.${hint}`);
  }
  return server;
}

export function listServerNames(config: PiMcpConfig): string[] {
  return Object.keys(config.servers).sort();
}

export function listEnabledServerNames(config: PiMcpConfig): string[] {
  return listServerNames(config).filter((name) => config.servers[name].enabled);
}

export function listDisabledServerNames(config: PiMcpConfig): string[] {
  return listServerNames(config).filter((name) => !config.servers[name].enabled);
}

export function validateServerName(name: string): void {
  if (!name.trim()) throw new Error("MCP server name is required.");
  if (/\s/.test(name)) throw new Error(`Invalid MCP server name: ${name}. Server names cannot contain whitespace.`);
  if (!/^[A-Za-z0-9_][-A-Za-z0-9_.:]*$/.test(name)) {
    throw new Error(`Invalid MCP server name: ${name}.`);
  }
}

export async function readEffectivePiMcpConfig(homePath = PI_MCP_CONFIG_PATH, projectPath = PROJECT_MCP_CONFIG_PATH): Promise<PiMcpConfig> {
  const home = await readPiMcpConfig(homePath);
  if (projectPath === homePath) return home;
  let project: PiMcpConfig | null = null;
  try {
    const text = await readFile(projectPath, "utf8");
    project = normalizePiConfig(JSON.parse(text) as Partial<PiMcpConfig>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await logDebug("Failed to read project Pi MCP config; ignoring project overrides", { projectPath, error: errorMessage(error) });
    }
  }
  if (!project) return home;
  return {
    version: 1,
    autoStart: project.autoStart || home.autoStart,
    allowServers: project.allowServers ?? home.allowServers,
    denyServers: project.denyServers ?? home.denyServers,
    maxOutputChars: project.maxOutputChars ?? home.maxOutputChars,
    servers: { ...home.servers, ...project.servers },
  };
}

export function summarizeConfig(config: PiMcpConfig): string {
  const names = listServerNames(config);
  if (names.length === 0) return "No MCP servers configured.";
  return names
    .map((name) => {
      const server = config.servers[name];
      const source = server.source ? ` source=${server.source}` : "";
      const managed = server.managedBy === MANAGED_BY ? "managed" : "manual";
      return `${server.enabled ? "enabled " : "disabled"} ${name} [${managed}${source}] command=${server.command}`;
    })
    .join("\n");
}

function suggestServerNames(config: PiMcpConfig, input: string): string[] {
  const normalizedInput = input.toLowerCase();
  return listServerNames(config)
    .filter((name) => name.toLowerCase().includes(normalizedInput) || normalizedInput.includes(name.toLowerCase()))
    .slice(0, 5);
}

async function withConfigMutation<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(fn, fn);
  mutationQueue = run.catch(() => undefined);
  return run;
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
    allowServers: normalizeStringArray(parsed.allowServers),
    denyServers: normalizeStringArray(parsed.denyServers),
    maxOutputChars: typeof parsed.maxOutputChars === "number" && parsed.maxOutputChars > 0 ? Math.floor(parsed.maxOutputChars) : undefined,
    servers,
  };
}

function emptyConfig(): PiMcpConfig {
  return { version: 1, autoStart: false, servers: {} };
}

function normalizeStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const values = raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return values.length ? values : undefined;
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
