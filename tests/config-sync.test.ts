import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { listDisabledServerNames, readEffectivePiMcpConfig, readPiMcpConfig, syncPiMcpConfig } from "../extensions/mcp-bridge/config-sync.js";
import { MANAGED_BY, type DiscoveredMcpServer } from "../extensions/mcp-bridge/types.js";

let dirs: string[] = [];

async function tempFile(name: string) {
  const dir = await mkdtemp(join(tmpdir(), "pi-mcp-test-"));
  dirs.push(dir);
  return join(dir, name);
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe("syncPiMcpConfig", () => {
  it("adds discovered servers disabled by default and preserves enabled on resync", async () => {
    const path = await tempFile("mcp.json");
    const discovered: Record<string, DiscoveredMcpServer> = {
      "claude_desktop__filesystem": {
        enabled: false,
        managedBy: MANAGED_BY,
        source: "claude-desktop",
        sourceName: "filesystem",
        command: "npx",
        args: ["server"],
        env: {},
        configPath: "fixture",
      },
    };

    await syncPiMcpConfig(discovered, path);
    let config = await readPiMcpConfig(path);
    expect(config.servers.claude_desktop__filesystem.enabled).toBe(false);

    config.servers.claude_desktop__filesystem.enabled = true;
    await import("node:fs/promises").then((fs) => fs.writeFile(path, JSON.stringify(config), "utf8"));

    await syncPiMcpConfig(discovered, path);
    config = await readPiMcpConfig(path);
    expect(config.servers.claude_desktop__filesystem.enabled).toBe(true);
  });

  it("merges project overrides over home config", async () => {
    const home = await tempFile("home-mcp.json");
    const project = await tempFile("project-mcp.json");
    const fs = await import("node:fs/promises");
    await fs.writeFile(home, JSON.stringify({ version: 1, autoStart: false, servers: { shared: { enabled: false, command: "home" } } }), "utf8");
    await fs.writeFile(project, JSON.stringify({ version: 1, autoStart: false, maxOutputChars: 123, servers: { shared: { enabled: true, command: "project" } } }), "utf8");

    const config = await readEffectivePiMcpConfig(home, project);
    expect(config.maxOutputChars).toBe(123);
    expect(config.servers.shared.command).toBe("project");
    expect(config.servers.shared.enabled).toBe(true);
  });

  it("lists disabled server names in sorted order", () => {
    const disabled = listDisabledServerNames({
      version: 1,
      autoStart: false,
      servers: {
        z_disabled: { enabled: false, command: "z" },
        a_enabled: { enabled: true, command: "a" },
        b_disabled: { enabled: false, command: "b" },
      },
    });

    expect(disabled).toEqual(["b_disabled", "z_disabled"]);
  });
});
