import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig, PiMcpConfig } from "./types.js";
import { logDebug } from "./logger.js";

export interface McpToolBinding {
  piToolName: string;
  serverName: string;
  mcpToolName: string;
  description: string;
  inputSchema: unknown;
}

interface ConnectedServer {
  name: string;
  config: McpServerConfig;
  client: Client;
  transport: StdioClientTransport;
  tools: McpToolBinding[];
}

export class McpBridgeRuntime {
  private servers = new Map<string, ConnectedServer>();
  private bindings = new Map<string, McpToolBinding>();

  getToolBindings(): McpToolBinding[] {
    return [...this.bindings.values()].sort((a, b) => a.piToolName.localeCompare(b.piToolName));
  }

  getConnectedServerNames(): string[] {
    return [...this.servers.keys()].sort();
  }

  getConnectionSummary(): string {
    const connected = this.getConnectedServerNames();
    const tools = this.getToolBindings();
    return [
      `Connected servers: ${connected.length ? connected.join(", ") : "none"}`,
      `Registered MCP tool bindings: ${tools.length}`,
      ...tools.map((tool) => `- ${tool.piToolName} -> ${tool.serverName}/${tool.mcpToolName}`),
    ].join("\n");
  }

  async startEnabled(config: PiMcpConfig): Promise<McpToolBinding[]> {
    const enabled = Object.entries(config.servers).filter(([serverName, server]) => server.enabled && isServerAllowed(serverName, config));
    for (const [serverName, server] of enabled) {
      if (this.servers.has(serverName)) continue;
      try {
        await this.startServer(serverName, server);
      } catch (error) {
        await logDebug("Failed to start MCP server", { serverName, error: errorMessage(error) });
      }
    }
    return this.getToolBindings();
  }

  async restartServer(serverName: string, config: PiMcpConfig): Promise<McpToolBinding[]> {
    await this.stopServer(serverName);
    const server = config.servers[serverName];
    if (!server) throw new Error(`Unknown MCP server: ${serverName}`);
    if (!server.enabled) throw new Error(`MCP server is disabled: ${serverName}`);
    if (!isServerAllowed(serverName, config)) throw new Error(`MCP server is blocked by allow/deny filters: ${serverName}`);
    await this.startServer(serverName, server);
    return this.getToolBindings();
  }

  async restartEnabled(config: PiMcpConfig): Promise<McpToolBinding[]> {
    await this.stopAll();
    return this.startEnabled(config);
  }

  async stopNotEnabled(config: PiMcpConfig): Promise<string[]> {
    const removed: string[] = [];
    for (const serverName of this.getConnectedServerNames()) {
      if (!config.servers[serverName]?.enabled) removed.push(...await this.stopServer(serverName));
    }
    return removed;
  }

  async stopServer(serverName: string): Promise<string[]> {
    const existing = this.servers.get(serverName);
    if (!existing) return [];
    this.servers.delete(serverName);
    const removedTools = existing.tools.map((tool) => tool.piToolName);
    for (const toolName of removedTools) this.bindings.delete(toolName);
    try {
      await existing.transport.close();
    } catch (error) {
      await logDebug("Error while closing MCP transport", { serverName, error: errorMessage(error) });
    }
    await logDebug("Stopped MCP server", { serverName, removedTools });
    return removedTools;
  }

  async stopAll(): Promise<string[]> {
    const names = this.getConnectedServerNames();
    const removed: string[] = [];
    for (const name of names) removed.push(...await this.stopServer(name));
    return removed;
  }

  async callTool(piToolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const binding = this.bindings.get(piToolName);
    if (!binding) throw new Error(`MCP tool is not active: ${piToolName}`);
    const server = this.servers.get(binding.serverName);
    if (!server) throw new Error(`MCP server is not connected: ${binding.serverName}`);
    return server.client.callTool(
      { name: binding.mcpToolName, arguments: args },
      undefined,
      signal ? { signal } : undefined,
    );
  }

  private async startServer(serverName: string, config: McpServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...getDefaultEnvironment(), ...(config.env ?? {}) },
      stderr: "pipe",
    });

    transport.stderr?.on("data", (chunk: Buffer | string) => {
      void logDebug("MCP server stderr", { serverName, stderr: String(chunk).slice(0, 4000) });
    });

    const client = new Client({ name: "pi-mcp-bridge", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    const listed = await client.listTools();
    const tools = listed.tools.map((tool) => ({
      piToolName: this.makePiToolName(serverName, tool.name),
      serverName,
      mcpToolName: tool.name,
      description: tool.description ?? `MCP tool ${tool.name} from ${serverName}`,
      inputSchema: tool.inputSchema,
    }));

    const connected: ConnectedServer = { name: serverName, config, client, transport, tools };
    this.servers.set(serverName, connected);
    for (const tool of tools) this.bindings.set(tool.piToolName, tool);
    await logDebug("Started MCP server", { serverName, toolCount: tools.length, tools: tools.map((tool) => tool.piToolName) });
  }

  private makePiToolName(serverName: string, mcpToolName: string): string {
    const base = normalizeToolName(`mcp_${serverName}_${mcpToolName}`);
    if (!this.bindings.has(base)) return base;
    return `${base}_${shortHash(`${serverName}/${mcpToolName}`)}`;
  }
}

function normalizeToolName(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "mcp_tool";
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 6);
}

function isServerAllowed(serverName: string, config: PiMcpConfig): boolean {
  if (config.allowServers?.length && !config.allowServers.some((pattern) => matchesPattern(serverName, pattern))) return false;
  if (config.denyServers?.some((pattern) => matchesPattern(serverName, pattern))) return false;
  return true;
}

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === "*" || pattern === value) return true;
  if (!pattern.includes("*")) return false;
  const escaped = pattern.split("*").map(escapeRegExp).join(".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
