export const MANAGED_BY = "pi-mcp-sync-bridge";

export type McpSource = "claude-desktop" | "claude-code" | "codex" | "manual" | string;

export interface McpServerConfig {
  enabled: boolean;
  managedBy?: string;
  source?: McpSource;
  sourceName?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface PiMcpConfig {
  version: 1;
  autoStart: boolean;
  servers: Record<string, McpServerConfig>;
}

export interface DiscoveredMcpServer extends McpServerConfig {
  managedBy: typeof MANAGED_BY;
  source: McpSource;
  sourceName: string;
  configPath: string;
}

export interface DiscoveryEvent {
  path: string;
  source: McpSource;
  status: "missing" | "found" | "parsed" | "contains-mcp" | "unsupported" | "parse-error";
  message?: string;
}

export interface DiscoveryResult {
  servers: Record<string, DiscoveredMcpServer>;
  events: DiscoveryEvent[];
}

export interface SyncResult {
  configPath: string;
  discoveredCount: number;
  added: string[];
  updated: string[];
  removed: string[];
  preservedManual: string[];
  enabled: string[];
  disabled: string[];
}
