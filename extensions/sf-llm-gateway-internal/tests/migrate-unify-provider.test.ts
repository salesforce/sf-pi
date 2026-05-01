/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unit tests for the one-shot settings migration that rewrites references
 * to the retired `sf-llm-gateway-internal-anthropic` provider. Each branch
 * runs against a real temp settings file so writeSettings/readSettings
 * round-trips are exercised.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MIGRATION_SENTINEL_FIELD,
  MIGRATION_SENTINEL_KEY,
  migrateSettingsFile,
} from "../lib/migrate-unify-provider.ts";

let root: string;
let file: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "sf-pi-migrate-"));
  file = path.join(root, "settings.json");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeFixture(data: Record<string, unknown>): void {
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function readBack(): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

describe("migrateSettingsFile", () => {
  it("rewrites legacy defaultProvider", () => {
    writeFixture({ defaultProvider: "sf-llm-gateway-internal-anthropic" });

    const result = migrateSettingsFile(file);

    expect(result.changed).toBe(true);
    expect(result.changes).toContain(
      "defaultProvider: sf-llm-gateway-internal-anthropic → sf-llm-gateway-internal",
    );
    const next = readBack();
    expect(next.defaultProvider).toBe("sf-llm-gateway-internal");
    expect(
      (next[MIGRATION_SENTINEL_KEY] as Record<string, unknown>)[MIGRATION_SENTINEL_FIELD],
    ).toBe(true);
  });

  it("rewrites legacy defaultModel prefix", () => {
    writeFixture({
      defaultModel: "sf-llm-gateway-internal-anthropic/claude-opus-4-7",
    });

    migrateSettingsFile(file);

    expect(readBack().defaultModel).toBe("sf-llm-gateway-internal/claude-opus-4-7");
  });

  it("drops the retired anthropic wildcard from enabledModels and preserves ordering", () => {
    writeFixture({
      enabledModels: [
        "sf-llm-gateway-internal/*",
        "sf-llm-gateway-internal-anthropic/*",
        "openai/*",
      ],
    });

    const result = migrateSettingsFile(file);

    expect(result.changed).toBe(true);
    expect(readBack().enabledModels).toEqual(["sf-llm-gateway-internal/*", "openai/*"]);
  });

  it("ensures the unified wildcard is present when only the retired one existed", () => {
    writeFixture({ enabledModels: ["sf-llm-gateway-internal-anthropic/*", "openai/*"] });

    migrateSettingsFile(file);

    const next = readBack();
    expect(next.enabledModels).toEqual(["sf-llm-gateway-internal/*", "openai/*"]);
  });

  it("rewrites all three keys at once", () => {
    writeFixture({
      defaultProvider: "sf-llm-gateway-internal-anthropic",
      defaultModel: "sf-llm-gateway-internal-anthropic/claude-opus-4-7",
      enabledModels: [
        "sf-llm-gateway-internal/*",
        "sf-llm-gateway-internal-anthropic/*",
        "openai/*",
      ],
      defaultThinkingLevel: "xhigh",
    });

    migrateSettingsFile(file);

    const next = readBack();
    expect(next.defaultProvider).toBe("sf-llm-gateway-internal");
    expect(next.defaultModel).toBe("sf-llm-gateway-internal/claude-opus-4-7");
    expect(next.enabledModels).toEqual(["sf-llm-gateway-internal/*", "openai/*"]);
    // Untouched keys stay untouched.
    expect(next.defaultThinkingLevel).toBe("xhigh");
  });

  it("is idempotent — a second run is a no-op", () => {
    writeFixture({ defaultProvider: "sf-llm-gateway-internal-anthropic" });

    migrateSettingsFile(file);
    const first = readBack();
    // Pretend a user tampers with the file in a way that would re-dirty it
    // if the sentinel did not exist: restore the legacy value.
    writeFileSync(
      file,
      JSON.stringify({ ...first, defaultProvider: "sf-llm-gateway-internal-anthropic" }, null, 2),
      "utf8",
    );

    const second = migrateSettingsFile(file);

    expect(second.alreadyMigrated).toBe(true);
    expect(second.changed).toBe(false);
    expect(readBack().defaultProvider).toBe("sf-llm-gateway-internal-anthropic");
  });

  it("preserves unrelated sfPi namespace keys when stamping the sentinel", () => {
    writeFixture({
      sfPi: { announcements: { dismissed: ["abc"] } },
      defaultProvider: "sf-llm-gateway-internal-anthropic",
    });

    migrateSettingsFile(file);

    const next = readBack();
    const sfPi = next.sfPi as Record<string, unknown>;
    expect(sfPi.announcements).toEqual({ dismissed: ["abc"] });
    expect(sfPi[MIGRATION_SENTINEL_FIELD]).toBe(true);
  });

  it("stamps the sentinel on a clean file without other changes", () => {
    writeFixture({ defaultProvider: "openai", enabledModels: ["openai/*"] });

    const result = migrateSettingsFile(file);

    expect(result.changed).toBe(false);
    const next = readBack();
    expect((next.sfPi as Record<string, unknown>)[MIGRATION_SENTINEL_FIELD]).toBe(true);
    expect(next.defaultProvider).toBe("openai");
  });

  it("survives a missing settings file (writes a minimal sentinel)", () => {
    // Point at a path that does not exist yet.
    const missing = path.join(root, "new-settings.json");
    const result = migrateSettingsFile(missing);

    expect(result.changed).toBe(false);
    const written = JSON.parse(readFileSync(missing, "utf8")) as Record<string, unknown>;
    expect((written.sfPi as Record<string, unknown>)[MIGRATION_SENTINEL_FIELD]).toBe(true);
  });
});
