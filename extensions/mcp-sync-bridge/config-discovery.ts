import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import TOML from "@iarna/toml";
import { MANAGED_BY, type DiscoveredMcpServer, type DiscoveryEvent, type DiscoveryResult, type McpSource } from "./types.js";

interface Candidate {
  source: McpSource;
  path: string;
  format: "json" | "toml";
}

const CANDIDATES: Candidate[] = [
  { source: "claude-desktop", path: "~/Library/Application Support/Claude/claude_desktop_config.json", format: "json" },
  { source: "claude-code", path: "~/.claude.json", format: "json" },
  { source: "claude-code", path: "~/.claude/settings.json", format: "json" },
  { source: "claude-code", path: "~/.config/claude-code/config.json", format: "json" },
  { source: "claude-code", path: "~/.config/claude-code/settings.json", format: "json" },
  { source: "codex", path: "~/.codex/config.toml", format: "toml" },
  { source: "codex", path: "~/.codex/config.json", format: "json" },
  { source: "codex", path: "~/.config/codex/config.toml", format: "toml" },
  { source: "codex", path: "~/.config/codex/config.json", format: "json" },
];

export function expandHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

export async function discoverMcpServers(): Promise<DiscoveryResult> {
  const servers: Record<string, DiscoveredMcpServer> = {};
  const events: DiscoveryEvent[] = [];

  for (const candidate of CANDIDATES) {
    const path = expandHome(candidate.path);
    try {
      await access(path, constants.R_OK);
      events.push({ path, source: candidate.source, status: "found" });
    } catch {
      events.push({ path, source: candidate.source, status: "missing" });
      continue;
    }

    let parsed: unknown;
    try {
      const text = await readFile(path, "utf8");
      parsed = candidate.format === "toml" ? TOML.parse(text) : JSON.parse(text);
      events.push({ path, source: candidate.source, status: "parsed" });
    } catch (error) {
      events.push({ path, source: candidate.source, status: "parse-error", message: errorMessage(error) });
      continue;
    }

    const maps = findMcpServerMaps(parsed);
    if (maps.length === 0) {
      events.push({ path, source: candidate.source, status: "unsupported", message: "No mcpServers or mcp_servers map found" });
      continue;
    }

    let accepted = 0;
    for (const map of maps) {
      for (const [sourceName, rawServer] of Object.entries(map)) {
        const normalized = normalizeServer(candidate.source, sourceName, rawServer, path);
        if (!normalized) continue;
        servers[makeServerKey(candidate.source, sourceName)] = normalized;
        accepted++;
      }
    }

    events.push({
      path,
      source: candidate.source,
      status: accepted > 0 ? "contains-mcp" : "unsupported",
      message: accepted > 0 ? `${accepted} MCP server(s)` : "MCP map found, but no supported server entries",
    });
  }

  return { servers, events };
}

function findMcpServerMaps(value: unknown, depth = 0): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 5) return [];
  const obj = value as Record<string, unknown>;
  const maps: Array<Record<string, unknown>> = [];

  for (const key of ["mcpServers", "mcp_servers", "mcpServersConfig"]) {
    const maybe = obj[key];
    if (maybe && typeof maybe === "object" && !Array.isArray(maybe)) {
      maps.push(maybe as Record<string, unknown>);
    }
  }

  for (const child of Object.values(obj)) {
    if (child && typeof child === "object") {
      maps.push(...findMcpServerMaps(child, depth + 1));
    }
  }

  return maps;
}

function normalizeServer(source: McpSource, sourceName: string, raw: unknown, configPath: string): DiscoveredMcpServer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const command = typeof obj.command === "string" ? obj.command : undefined;
  if (!command) return null;

  const args = Array.isArray(obj.args) ? obj.args.filter((arg): arg is string => typeof arg === "string") : [];
  const env = normalizeEnv(obj.env);

  return {
    enabled: false,
    managedBy: MANAGED_BY,
    source,
    sourceName,
    command,
    args,
    env,
    configPath,
  };
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

function makeServerKey(source: McpSource, sourceName: string): string {
  return `${normalizeName(source)}__${normalizeName(sourceName)}`;
}

function normalizeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase() || "server";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
