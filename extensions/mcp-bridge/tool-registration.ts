import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { McpBridgeRuntime, McpToolBinding } from "./mcp-client.js";
import { convertMcpInputSchema } from "./schema-conversion.js";
import { logDebug } from "./logger.js";

export class McpToolRegistrar {
  private registered = new Set<string>();
  private active = new Set<string>();

  constructor(private readonly pi: ExtensionAPI, private readonly runtime: McpBridgeRuntime, private maxOutputChars = 20_000) {}

  setMaxOutputChars(maxOutputChars: number | undefined): void {
    this.maxOutputChars = maxOutputChars && maxOutputChars > 0 ? maxOutputChars : 20_000;
  }

  async registerBindings(bindings: McpToolBinding[]): Promise<string[]> {
    const activated: string[] = [];
    for (const binding of bindings) {
      if (!this.registered.has(binding.piToolName)) {
        try {
          this.registerBinding(binding);
          this.registered.add(binding.piToolName);
        } catch (error) {
          await logDebug("Skipped MCP tool with unsupported schema", {
            piToolName: binding.piToolName,
            serverName: binding.serverName,
            mcpToolName: binding.mcpToolName,
            error: errorMessage(error),
          });
          continue;
        }
      }
      this.active.add(binding.piToolName);
      activated.push(binding.piToolName);
    }
    this.applyActiveTools();
    return activated;
  }

  deactivateTools(toolNames: string[]): void {
    for (const toolName of toolNames) this.active.delete(toolName);
    this.applyActiveTools();
  }

  deactivateAll(): void {
    this.active.clear();
    this.applyActiveTools();
  }

  private registerBinding(binding: McpToolBinding): void {
    const parameters = convertMcpInputSchema(binding.inputSchema);
    this.pi.registerTool({
      name: binding.piToolName,
      label: `MCP ${binding.mcpToolName}`,
      description: `${binding.description}\n\nMCP server: ${binding.serverName}; MCP tool: ${binding.mcpToolName}`,
      promptSnippet: `Call MCP tool ${binding.mcpToolName} from server ${binding.serverName}`,
      promptGuidelines: [`Use ${binding.piToolName} only when the user asks for capability provided by MCP server ${binding.serverName}.`],
      parameters,
      execute: async (_toolCallId, params, signal) => {
        const result = await this.runtime.callTool(binding.piToolName, params as Record<string, unknown>, signal);
        return {
          content: [{ type: "text", text: truncateText(formatMcpResult(result), this.maxOutputChars) }],
          details: { serverName: binding.serverName, mcpToolName: binding.mcpToolName, result },
        };
      },
    });
  }

  private applyActiveTools(): void {
    const active = new Set(this.pi.getActiveTools());
    for (const registered of this.registered) active.delete(registered);
    for (const toolName of this.active) active.add(toolName);
    this.pi.setActiveTools([...active]);
  }
}

function formatMcpResult(result: unknown): string {
  if (isObject(result) && Array.isArray(result.content)) {
    const chunks = result.content.map(formatMcpContent).filter(Boolean);
    if (chunks.length) return chunks.join("\n\n");
  }
  if (isObject(result) && "toolResult" in result) return stringify(result.toolResult);
  return stringify(result);
}

function formatMcpContent(content: unknown): string {
  if (!isObject(content)) return stringify(content);
  if (content.type === "text" && typeof content.text === "string") return content.text;
  if (content.type === "image") return `[MCP image content: ${typeof content.mimeType === "string" ? content.mimeType : "unknown mime type"}]`;
  if (content.type === "audio") return `[MCP audio content: ${typeof content.mimeType === "string" ? content.mimeType : "unknown mime type"}]`;
  if (content.type === "resource" && isObject(content.resource)) {
    if (typeof content.resource.text === "string") return content.resource.text;
    if (typeof content.resource.uri === "string") return `[MCP resource: ${content.resource.uri}]`;
  }
  return stringify(content);
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[Truncated ${omitted} characters from MCP tool output]`;
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
