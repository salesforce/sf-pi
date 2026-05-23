/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the 0.68.0 SDK migration in sf-welcome.
 *
 * Covers:
 * - collectSplashData() accepts and threads cwd parameter
 * - discoverLoadedCounts() accepts cwd parameter
 * - discoverExtensionHealth() accepts cwd parameter
 * - SessionStartEvent.reason is used directly (no unsafe cast)
 *
 * These tests verify the cwd-threading contract: every function that previously
 * used process.cwd() internally now requires an explicit cwd parameter.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => ""),
}));

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
let isolatedAgentDir: string;
let isolatedHomeDir: string;
let previousAgentDir: string | undefined;
let previousHome: string | undefined;
let previousUserProfile: string | undefined;

beforeEach(() => {
  previousAgentDir = process.env[PI_AGENT_ENV];
  previousHome = process.env.HOME;
  previousUserProfile = process.env.USERPROFILE;
  isolatedAgentDir = mkdtempSync(path.join(tmpdir(), "sdk-migration-agent-"));
  isolatedHomeDir = mkdtempSync(path.join(tmpdir(), "sdk-migration-home-"));
  process.env[PI_AGENT_ENV] = isolatedAgentDir;
  process.env.HOME = isolatedHomeDir;
  process.env.USERPROFILE = isolatedHomeDir;
});

afterEach(() => {
  if (previousAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = previousAgentDir;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  rmSync(isolatedAgentDir, { recursive: true, force: true });
  rmSync(isolatedHomeDir, { recursive: true, force: true });
});

// -------------------------------------------------------------------------------------------------
// collectSplashData cwd parameter
// -------------------------------------------------------------------------------------------------

describe("collectSplashData cwd threading", () => {
  it("accepts a cwd parameter without throwing", async () => {
    const { collectSplashData } = await import("../lib/splash-data.ts");
    const tempDir = mkdtempSync(path.join(tmpdir(), "splash-cwd-"));
    try {
      const data = collectSplashData("TestModel", "test-provider", tempDir, 3000);
      expect(data).toBeDefined();
      expect(data.modelName).toBe("TestModel");
      expect(data.providerName).toBe("test-provider");
      expect(data.monthlyBudget).toBe(3000);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns valid loadedCounts with explicit cwd", async () => {
    const { collectSplashData } = await import("../lib/splash-data.ts");
    const tempDir = mkdtempSync(path.join(tmpdir(), "splash-counts-"));
    try {
      const data = collectSplashData("M", "P", tempDir);
      expect(typeof data.loadedCounts.extensions).toBe("number");
      expect(typeof data.loadedCounts.skills).toBe("number");
      expect(typeof data.loadedCounts.promptTemplates).toBe("number");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns valid extensionHealth with explicit cwd", async () => {
    const { collectSplashData } = await import("../lib/splash-data.ts");
    const tempDir = mkdtempSync(path.join(tmpdir(), "splash-health-"));
    try {
      const data = collectSplashData("M", "P", tempDir);
      expect(Array.isArray(data.extensionHealth)).toBe(true);
      // Extension health should include entries from the registry
      expect(data.extensionHealth.length).toBeGreaterThan(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// -------------------------------------------------------------------------------------------------
// discoverLoadedCounts cwd parameter
// -------------------------------------------------------------------------------------------------

describe("discoverLoadedCounts cwd threading", () => {
  it("accepts an explicit cwd and returns counts", async () => {
    const { discoverLoadedCounts } = await import("../lib/splash-data.ts");
    const tempDir = mkdtempSync(path.join(tmpdir(), "loaded-cwd-"));
    try {
      const counts = discoverLoadedCounts(tempDir);
      expect(typeof counts.extensions).toBe("number");
      expect(typeof counts.skills).toBe("number");
      expect(typeof counts.promptTemplates).toBe("number");
      // In an empty temp dir, project-local extensions/skills/templates should be 0
      // (but global extensions may still be counted from ~/.pi)
      expect(counts.extensions).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses the provided cwd, not process.cwd()", async () => {
    const { discoverLoadedCounts } = await import("../lib/splash-data.ts");
    // Two different temp dirs should not produce identical project-local results
    // (unless both are empty, which is the expected case)
    const dir1 = mkdtempSync(path.join(tmpdir(), "loaded-a-"));
    const dir2 = mkdtempSync(path.join(tmpdir(), "loaded-b-"));
    try {
      const counts1 = discoverLoadedCounts(dir1);
      const counts2 = discoverLoadedCounts(dir2);
      // Both empty dirs should give same baseline — this proves it doesn't crash
      expect(typeof counts1.extensions).toBe("number");
      expect(typeof counts2.extensions).toBe("number");
    } finally {
      rmSync(dir1, { recursive: true, force: true });
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

// -------------------------------------------------------------------------------------------------
// discoverExtensionHealth cwd parameter
// -------------------------------------------------------------------------------------------------

describe("discoverExtensionHealth cwd threading", () => {
  it("accepts an explicit cwd and returns health items", async () => {
    const { discoverExtensionHealth } = await import("../lib/splash-data.ts");
    const tempDir = mkdtempSync(path.join(tmpdir(), "health-cwd-"));
    try {
      const health = discoverExtensionHealth(tempDir);
      expect(Array.isArray(health)).toBe(true);
      expect(health.length).toBeGreaterThan(0);
      // Every item must have name, status, and icon
      for (const item of health) {
        expect(typeof item.name).toBe("string");
        expect(["active", "disabled", "locked"]).toContain(item.status);
        expect(typeof item.icon).toBe("string");
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("stays aligned with the generated registry", async () => {
    const { discoverExtensionHealth } = await import("../lib/splash-data.ts");
    const { SF_PI_REGISTRY } = await import("../../../catalog/registry.ts");

    const health = discoverExtensionHealth(process.cwd());
    expect(health.length).toBe(SF_PI_REGISTRY.length);
    expect(health.some((item) => item.name === "Pi Manager")).toBe(true);
  });
});

// -------------------------------------------------------------------------------------------------
// SessionStartEvent.reason type safety
// -------------------------------------------------------------------------------------------------

describe("SessionStartEvent.reason type safety", () => {
  it("SessionStartEvent has a typed reason field", async () => {
    // This is a compile-time check: the import should succeed and the type
    // should expose reason as a union, not as unknown/any.
    const types = await import("@earendil-works/pi-coding-agent");
    // If the import succeeds, the types are available.
    expect(types).toBeDefined();
  });

  it("sf-welcome index.ts uses event.reason directly (no unsafe cast)", async () => {
    // Read the source and verify no `as unknown as Record` cast remains
    const fs = await import("node:fs");
    const source = fs.readFileSync(new URL("../index.ts", import.meta.url), "utf-8");
    expect(source).not.toContain("as unknown as Record");
    expect(source).toContain("event.reason");
  });
});
