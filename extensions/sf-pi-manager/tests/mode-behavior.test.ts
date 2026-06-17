/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Behavior tests for Pi mode-aware manager surfaces.
 *
 * RPC mode has ctx.hasUI=true, but custom TUI components are not available.
 * Manager commands should therefore fall back to text/dialog behavior unless
 * ctx.mode === "tui".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sfPiManagerExtension from "../index.ts";
import { handleRecommended, parseRecommendedArgs } from "../lib/recommendations.ts";
import { TEST_PACKAGE_SOURCE } from "../../../lib/common/test-fixtures.ts";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeRpcContext(cwd: string) {
  return {
    cwd,
    mode: "rpc",
    hasUI: true,
    ui: {
      custom: vi.fn(async () => undefined),
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWorkingVisible: vi.fn(),
    },
    reload: vi.fn(),
  };
}

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("sf-pi manager mode behavior", () => {
  it("does not mount the manager custom overlay in RPC mode", async () => {
    const homeDir = makeTempDir("sf-pi-mode-home-");
    const projectDir = makeTempDir("sf-pi-mode-project-");
    process.env.HOME = homeDir;
    writeJson(path.join(projectDir, ".pi", "settings.json"), {
      packages: [TEST_PACKAGE_SOURCE],
    });

    let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
    const pi = {
      events: { on: vi.fn() },
      on: vi.fn(),
      registerCommand: vi.fn((_name, definition) => {
        handler = definition.handler;
      }),
    };
    sfPiManagerExtension(pi as never);
    expect(handler).toBeDefined();

    const ctx = makeRpcContext(projectDir);
    await handler!("", ctx);

    expect(ctx.ui.custom).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("sf-pi v"), "info");
  });

  it("does not mount the recommendations custom overlay in RPC mode", async () => {
    const packageRoot = makeTempDir("sf-pi-mode-rec-package-");
    writeJson(path.join(packageRoot, "catalog", "recommendations.json"), {
      schemaVersion: 1,
      revision: "r1",
      bundles: [],
      items: {
        helper: {
          id: "helper",
          name: "Helper",
          description: "A helper package",
          source: "git:example.com/helper",
          homepage: "https://example.com/helper",
          license: "MIT",
          rationale: "Useful in tests",
        },
      },
    });

    const ctx = makeRpcContext(makeTempDir("sf-pi-mode-rec-cwd-"));
    await handleRecommended(
      {} as never,
      ctx as never,
      "1.2.3",
      packageRoot,
      parseRecommendedArgs(""),
    );

    expect(ctx.ui.custom).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("sf-pi recommended extensions"),
      "info",
    );
  });
});
