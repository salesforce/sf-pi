/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Guardrail preference tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => tempAgentDir,
}));

let configModule: typeof import("../lib/config.ts");
let preferences: typeof import("../lib/preferences.ts");

beforeEach(async () => {
  vi.resetModules();
  tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-guardrail-prefs-agent-"));
  configModule = await import("../lib/config.ts");
  preferences = await import("../lib/preferences.ts");
});

afterEach(() => {
  rmSync(tempAgentDir, { recursive: true, force: true });
});

describe("guardrail preferences", () => {
  it("renders current preference values from effective config", () => {
    const config = configModule.readBundledConfig();

    expect(preferences.preferenceValue(config, "enabled")).toBe("on");
    expect(preferences.preferenceValue(config, "features.commandGate")).toBe("on");
    expect(preferences.preferenceValue(config, "confirmTimeoutMs")).toBe("120000");
  });

  it("applies Power Tool preset as confirm for every rule", () => {
    const config = configModule.readBundledConfig();

    preferences.applyGuardrailPreset("powerTool", config);

    const loaded = configModule.loadConfig().config;
    expect(loaded.policies.rules.every((rule) => rule.behavior === "confirm")).toBe(true);
    expect(loaded.commandGate.patterns.every((pattern) => pattern.behavior === "confirm")).toBe(
      true,
    );
    expect(loaded.orgAwareGate.rules.every((rule) => rule.behavior === "confirm")).toBe(true);
  });

  it("applies Strict preset as hard block for sensitive rules only", () => {
    const config = configModule.readBundledConfig();

    preferences.applyGuardrailPreset("strict", config);

    const loaded = configModule.loadConfig().config;
    expect(loaded.policies.rules.find((rule) => rule.id === "secret-files")?.behavior).toBe(
      "block",
    );
    expect(loaded.policies.rules.find((rule) => rule.id === "sf-cli-state")?.behavior).toBe(
      "block",
    );
    expect(
      loaded.commandGate.patterns.find((pattern) => pattern.id === "sf-org-auth-show-access-token")
        ?.behavior,
    ).toBe("block");
    expect(loaded.orgAwareGate.rules.find((rule) => rule.id === "sf-deploy-prod")?.behavior).toBe(
      "confirm",
    );
  });

  it("writes production aliases from comma/newline text that loadConfig reads", () => {
    const aliases = preferences.updateProductionAliasesFromText("Prod, prod\nProd");

    expect(aliases).toEqual(["Prod", "prod"]);
    expect(configModule.loadConfig().config.productionAliases).toEqual(["Prod", "prod"]);
  });

  it("writes common preference overrides that loadConfig reads", () => {
    preferences.updateUserPreference("features.commandGate", "off");
    preferences.updateUserPreference("confirmTimeoutMs", "60000");

    const { config, source } = configModule.loadConfig();

    expect(source).toBe("override");
    expect(config.features.commandGate).toBe(false);
    expect(config.confirmTimeoutMs).toBe(60000);
  });

  it("exposes bundled policy and org-aware rules as preference descriptors", () => {
    const config = configModule.readBundledConfig();
    const descriptors = preferences.buildGuardrailPreferenceDescriptors(config);

    expect(descriptors.map((descriptor) => descriptor.key)).toEqual(
      expect.arrayContaining([
        "policies.rules.secret-files.enabled",
        "commandGate.patterns.rm-rf.enabled",
        "orgAwareGate.rules.sf-deploy-prod.enabled",
      ]),
    );
  });

  it("writes policy rule behavior overrides that loadConfig reads", () => {
    const config = configModule.readBundledConfig();

    preferences.updateUserPreference("policies.rules.secret-files.enabled", "hard block", config);

    const { config: loaded } = configModule.loadConfig();
    const rule = loaded.policies.rules.find((candidate) => candidate.id === "secret-files");
    expect(rule?.behavior).toBe("block");
    expect(rule?.enabled).toBe(true);
    expect(preferences.preferenceValue(loaded, "policies.rules.secret-files.enabled")).toBe(
      "hard block",
    );
  });

  it("writes command pattern behavior overrides that loadConfig reads", () => {
    const config = configModule.readBundledConfig();

    preferences.updateUserPreference("commandGate.patterns.rm-rf.enabled", "off", config);

    const { config: loaded } = configModule.loadConfig();
    const pattern = loaded.commandGate.patterns.find((candidate) => candidate.id === "rm-rf");
    expect(pattern?.behavior).toBe("off");
    expect(pattern?.enabled).toBe(false);
  });

  it("writes org-aware rule behavior overrides that loadConfig reads", () => {
    const config = configModule.readBundledConfig();

    preferences.updateUserPreference(
      "orgAwareGate.rules.sf-deploy-prod.enabled",
      "confirm",
      config,
    );

    const { config: loaded } = configModule.loadConfig();
    const rule = loaded.orgAwareGate.rules.find((candidate) => candidate.id === "sf-deploy-prod");
    expect(rule?.behavior).toBe("confirm");
    expect(rule?.enabled).toBe(true);
  });

  it("preserves advanced rule overrides when updating common preferences", () => {
    const overridePath = configModule.userConfigPath();
    mkdirSync(path.dirname(overridePath), { recursive: true });
    writeFileSync(
      overridePath,
      JSON.stringify(
        {
          commandGate: {
            patterns: [
              {
                id: "custom-danger",
                pattern: "custom danger",
                description: "custom advanced rule",
              },
            ],
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    preferences.updateUserPreference("enabled", "off");

    const raw = JSON.parse(readFileSync(overridePath, "utf8"));
    expect(raw.enabled).toBe(false);
    expect(raw.commandGate.patterns[0].id).toBe("custom-danger");
  });
});
