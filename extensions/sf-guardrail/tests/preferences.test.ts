/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Guardrail preference tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => tempAgentDir,
}));

let configModule: typeof import("../lib/config.ts");
let preferences: typeof import("../lib/preferences.ts");
let settingsModule: typeof import("../../../lib/common/sf-pi-settings.ts");

beforeEach(async () => {
  vi.resetModules();
  tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-guardrail-prefs-agent-"));
  configModule = await import("../lib/config.ts");
  preferences = await import("../lib/preferences.ts");
  settingsModule = await import("../../../lib/common/sf-pi-settings.ts");
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

  it("writes common preference overrides to Pi settings that loadConfig reads", () => {
    preferences.updateUserPreference("features.commandGate", "off");
    preferences.updateUserPreference("confirmTimeoutMs", "60000");

    const { config, source } = configModule.loadConfig();
    const settings = JSON.parse(readFileSync(settingsModule.globalSettingsPath(), "utf8"));

    expect(source).toBe("settings");
    expect(config.features.commandGate).toBe(false);
    expect(config.confirmTimeoutMs).toBe(60000);
    expect(settings.sfPi.guardrail.features.commandGate).toBe(false);
    expect(settings.sfPi.guardrail.confirmTimeoutMs).toBe(60000);
    expect(existsSync(configModule.userConfigPath())).toBe(false);
  });

  it("exposes sectioned, example-rich rule descriptors", () => {
    const config = configModule.readBundledConfig();
    const descriptors = preferences.buildGuardrailPreferenceDescriptors(config);

    expect(descriptors.map((descriptor) => descriptor.key)).toEqual(
      expect.arrayContaining([
        "policies.rules.secret-files.enabled",
        "commandGate.patterns.rm-rf.enabled",
        "orgAwareGate.rules.sf-deploy-prod.enabled",
      ]),
    );
    expect(
      descriptors.find((descriptor) => descriptor.key === "policies.rules.secret-files.enabled"),
    ).toMatchObject({
      section: "files",
      label: "Secret files",
      example: "read .env, write .env.production",
      powerToolRecommendation: "Ask me",
      strictRecommendation: "Block",
    });
    expect(
      descriptors.find((descriptor) => descriptor.key === "commandGate.patterns.rm-rf.enabled"),
    ).toMatchObject({
      section: "commands",
      label: "Recursive force delete",
      example: "rm -rf tmp/",
    });
    expect(
      descriptors.find(
        (descriptor) => descriptor.key === "orgAwareGate.rules.sf-deploy-prod.enabled",
      ),
    ).toMatchObject({
      section: "orgs",
      label: "Production deploy",
      example: "sf project deploy start -o Prod",
    });
  });

  it("writes policy rule behavior overrides to Pi settings that loadConfig reads", () => {
    const config = configModule.readBundledConfig();

    preferences.updateUserPreference("policies.rules.secret-files.enabled", "hard block", config);

    const { config: loaded, source } = configModule.loadConfig();
    const settings = JSON.parse(readFileSync(settingsModule.globalSettingsPath(), "utf8"));
    const rule = loaded.policies.rules.find((candidate) => candidate.id === "secret-files");
    expect(source).toBe("settings");
    expect(rule?.behavior).toBe("block");
    expect(rule?.enabled).toBe(true);
    expect(settings.sfPi.guardrail.ruleBehaviors.policies["secret-files"]).toBe("block");
    expect(existsSync(configModule.userConfigPath())).toBe(false);
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

  it("uses Pi settings rule behavior in safety decisions without advanced override files", async () => {
    const { evaluateSafety } = await import("../lib/safety-kernel.ts");
    const config = configModule.readBundledConfig();

    preferences.updateUserPreference("commandGate.patterns.rm-rf.enabled", "off", config);

    const { config: loaded } = configModule.loadConfig();
    expect(
      await evaluateSafety({
        toolName: "bash",
        input: { command: "rm -rf build" },
        cwd: "/project",
        config: loaded,
      }),
    ).toBeUndefined();
    expect(existsSync(configModule.userConfigPath())).toBe(false);
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

    const before = readFileSync(overridePath, "utf8");

    preferences.updateUserPreference("features.commandGate", "off");

    const after = readFileSync(overridePath, "utf8");
    const raw = JSON.parse(after);
    const settings = JSON.parse(readFileSync(settingsModule.globalSettingsPath(), "utf8"));
    expect(after).toBe(before);
    expect(raw.commandGate.patterns[0].id).toBe("custom-danger");
    expect(settings.sfPi.guardrail.features.commandGate).toBe(false);
  });
});
