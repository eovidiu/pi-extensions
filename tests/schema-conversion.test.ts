import { describe, expect, it } from "vitest";
import { convertMcpInputSchema } from "../extensions/mcp-bridge/schema-conversion.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe("convertMcpInputSchema", () => {
  it("converts object schemas with required and optional fields", () => {
    const converted = asRecord(convertMcpInputSchema({
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "Path to read" },
        limit: { type: "integer" },
        flags: { type: "array", items: { type: "string" } },
      },
    }));

    expect(converted.type).toBe("object");
    expect(asRecord(converted.properties).path).toBeTruthy();
    expect(converted.required).toEqual(["path"]);
  });

  it("rejects unsupported combinators", () => {
    expect(() => convertMcpInputSchema({
      type: "object",
      properties: {
        value: { oneOf: [{ type: "string" }, { type: "number" }] },
      },
    })).toThrow(/Unsupported schema combinator/);
  });
});
