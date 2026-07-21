/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, DEFAULT_THINKING_LEVEL, PROVIDER_NAME } from "../lib/config.ts";
import {
  GPT56_DEFAULT_MIGRATION_SENTINEL_FIELD,
  GPT56_DEFAULT_MIGRATION_SENTINEL_KEY,
  OBSOLETE_GATEWAY_DEFAULT_MODEL_IDS,
  migrateGpt56DefaultSettingsFile,
} from "../lib/migrate-gpt56-default.ts";

let root: string;
let file: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "sf-pi-gpt56-default-migrate-"));
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

describe("migrateGpt56DefaultSettingsFile", () => {
  it.each([...OBSOLETE_GATEWAY_DEFAULT_MODEL_IDS])(
    "migrates former product default %s to GPT-5.6 Sol",
    (modelId) => {
      writeFixture({
        defaultProvider: PROVIDER_NAME,
        defaultModel: modelId,
        defaultThinkingLevel: "medium",
      });

      const result = migrateGpt56DefaultSettingsFile(file);
      const next = readBack();

      expect(result.changed).toBe(true);
      expect(next.defaultModel).toBe(DEFAULT_MODEL_ID);
      expect(next.defaultThinkingLevel).toBe(DEFAULT_THINKING_LEVEL);
      expect(
        (next[GPT56_DEFAULT_MIGRATION_SENTINEL_KEY] as Record<string, unknown>)[
          GPT56_DEFAULT_MIGRATION_SENTINEL_FIELD
        ],
      ).toBe(true);
    },
  );

  it("migrates a provider-qualified former default", () => {
    writeFixture({
      defaultProvider: PROVIDER_NAME,
      defaultModel: `${PROVIDER_NAME}/claude-opus-4-8`,
    });

    migrateGpt56DefaultSettingsFile(file);

    expect(readBack().defaultModel).toBe(DEFAULT_MODEL_ID);
  });

  it("preserves an explicitly selected non-default gateway model", () => {
    writeFixture({
      defaultProvider: PROVIDER_NAME,
      defaultModel: "gpt-5.6-terra",
      defaultThinkingLevel: "high",
    });

    const result = migrateGpt56DefaultSettingsFile(file);
    const next = readBack();

    expect(result.changed).toBe(false);
    expect(next.defaultModel).toBe("gpt-5.6-terra");
    expect(next.defaultThinkingLevel).toBe("high");
  });

  it("preserves former defaults after the one-time sentinel is set", () => {
    writeFixture({
      defaultProvider: PROVIDER_NAME,
      defaultModel: "claude-opus-4-8",
      sfPi: { [GPT56_DEFAULT_MIGRATION_SENTINEL_FIELD]: true },
    });

    const result = migrateGpt56DefaultSettingsFile(file);

    expect(result.alreadyMigrated).toBe(true);
    expect(result.changed).toBe(false);
    expect(readBack().defaultModel).toBe("claude-opus-4-8");
  });

  it("preserves unrelated sfPi state when stamping the sentinel", () => {
    writeFixture({
      defaultProvider: "openai",
      defaultModel: "gpt-5",
      sfPi: { announcements: { dismissed: ["abc"] } },
    });

    migrateGpt56DefaultSettingsFile(file);

    const sfPi = readBack().sfPi as Record<string, unknown>;
    expect(sfPi.announcements).toEqual({ dismissed: ["abc"] });
    expect(sfPi[GPT56_DEFAULT_MIGRATION_SENTINEL_FIELD]).toBe(true);
  });

  it("does not create a missing settings file only to stamp a sentinel", () => {
    const missing = path.join(root, "missing-settings.json");

    const result = migrateGpt56DefaultSettingsFile(missing);

    expect(result.changed).toBe(false);
    expect(existsSync(missing)).toBe(false);
  });
});
