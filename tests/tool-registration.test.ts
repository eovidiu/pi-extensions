import { describe, expect, it } from "vitest";
import { truncateText } from "../extensions/mcp-sync-bridge/tool-registration.js";

describe("truncateText", () => {
  it("leaves short text unchanged", () => {
    expect(truncateText("hello", 10)).toBe("hello");
  });

  it("truncates long text with an explicit marker", () => {
    const result = truncateText("abcdefghijklmnopqrstuvwxyz", 10);
    expect(result).toContain("abcdefghij");
    expect(result).toContain("Truncated 16 characters");
  });
});
