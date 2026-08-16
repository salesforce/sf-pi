/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACTIVE_COMPACTION_MODEL,
  buildGatewayCompactionModelOptions,
  readEffectiveCompactionSettings,
  writeScopedCompactionModel,
} from "../lib/compaction-settings.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-compaction-settings-"));
  tempDirs.push(dir);
  return dir;
}

describe("gateway compaction settings", () => {
  it("defaults to the active Pi model and persists an explicit global gateway model", () => {
    const cwd = tempDir();
    const globalSettings = path.join(tempDir(), "settings.json");

    expect(readEffectiveCompactionSettings(cwd, globalSettings)).toMatchObject({
      model: ACTIVE_COMPACTION_MODEL,
      source: "default",
    });

    writeScopedCompactionModel(cwd, "global", "sf-llm-gateway/claude-sonnet-5", globalSettings);

    expect(readEffectiveCompactionSettings(cwd, globalSettings)).toMatchObject({
      model: "sf-llm-gateway/claude-sonnet-5",
      source: "global",
    });
    expect(JSON.parse(readFileSync(globalSettings, "utf8"))).toMatchObject({
      sfPi: { compaction: { model: "sf-llm-gateway/claude-sonnet-5" } },
    });
  });

  it("builds a dynamic picker from available Gateway models only", () => {
    expect(
      buildGatewayCompactionModelOptions([
        {
          provider: "sf-llm-gateway",
          id: "claude-sonnet-5",
          name: "[SF LLM Gateway] Claude Sonnet 5",
          contextWindow: 1_000_000,
          maxTokens: 128_000,
        },
        {
          provider: "sf-llm-gateway",
          id: "gemini-2.5-flash",
          name: "[SF LLM Gateway] Gemini 2.5 Flash",
          contextWindow: 1_000_000,
          maxTokens: 65_536,
        },
        {
          provider: "openai",
          id: "gpt-5-mini",
          name: "GPT-5 Mini",
          contextWindow: 400_000,
          maxTokens: 128_000,
        },
      ] as never),
    ).toEqual([
      {
        value: "sf-llm-gateway/claude-sonnet-5",
        label: "Claude Sonnet 5",
        description: "1M context · 128K output",
      },
      {
        value: "sf-llm-gateway/gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        description: "1M context · 65.5K output",
      },
    ]);
  });

  it("preserves unrelated Pi settings when writing and clearing the preference", () => {
    const cwd = tempDir();
    const globalSettings = path.join(tempDir(), "settings.json");
    writeFileSync(
      globalSettings,
      `${JSON.stringify(
        {
          theme: "dark",
          compaction: { enabled: false },
          sfPi: { display: { profile: "compact" } },
        },
        null,
        2,
      )}\n`,
    );

    writeScopedCompactionModel(cwd, "global", "sf-llm-gateway/gemini-2.5-flash", globalSettings);
    writeScopedCompactionModel(cwd, "global", undefined, globalSettings);

    expect(JSON.parse(readFileSync(globalSettings, "utf8"))).toEqual({
      theme: "dark",
      compaction: { enabled: false },
      sfPi: { display: { profile: "compact" } },
    });
  });

  it("lets a project select active-model compaction or inherit the global model", () => {
    const cwd = tempDir();
    const globalSettings = path.join(tempDir(), "settings.json");
    writeScopedCompactionModel(cwd, "global", "sf-llm-gateway/claude-sonnet-5", globalSettings);

    writeScopedCompactionModel(cwd, "project", ACTIVE_COMPACTION_MODEL, globalSettings);
    expect(readEffectiveCompactionSettings(cwd, globalSettings)).toMatchObject({
      model: ACTIVE_COMPACTION_MODEL,
      source: "project",
    });

    writeScopedCompactionModel(cwd, "project", undefined, globalSettings);
    expect(readEffectiveCompactionSettings(cwd, globalSettings)).toMatchObject({
      model: "sf-llm-gateway/claude-sonnet-5",
      source: "global",
    });
  });
});
