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
  it("exposes only timeout and rule behavior as normal preference keys", () => {
    const config = configModule.readBundledConfig();
    const descriptors = preferences.buildGuardrailPreferenceDescriptors(config);

    expect(preferences.preferenceValue(config, "confirmTimeoutMs")).toBe("120000");
    expect(descriptors.map((descriptor) => descriptor.key)).not.toEqual(
      expect.arrayContaining([
        "enabled",
        "features.policies",
        "features.commandGate",
        "features.orgAwareGate",
        "features.promptInjection",
      ]),
    );
  });

  it("writes timeout overrides to Pi settings that loadConfig reads", () => {
    preferences.updateUserPreference("confirmTimeoutMs", "60000");

    const { config, source } = configModule.loadConfig();
    const settings = JSON.parse(readFileSync(settingsModule.globalSettingsPath(), "utf8"));

    expect(source).toBe("settings");
    expect(config.confirmTimeoutMs).toBe(60000);
    expect(settings.sfPi.guardrail.confirmTimeoutMs).toBe(60000);
    expect(existsSync(configModule.userConfigPath())).toBe(false);
  });

  it("writes production aliases from comma/newline text that loadConfig reads", () => {
    const aliases = preferences.updateProductionAliasesFromText("Prod, prod\nProd");

    expect(aliases).toEqual(["Prod", "prod"]);
    expect(configModule.loadConfig().config.productionAliases).toEqual(["Prod", "prod"]);
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

  it("exposes custom advanced command rules as rule descriptors", () => {
    const overridePath = configModule.userConfigPath();
    mkdirSync(path.dirname(overridePath), { recursive: true });
    writeFileSync(
      overridePath,
      JSON.stringify(
        {
          commandGate: {
            patterns: [
              {
                id: "custom-prod-reset",
                pattern: "sf data delete bulk",
                description: "Bulk delete command used in reset scripts",
              },
            ],
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const { config } = configModule.loadConfig();
    const descriptors = preferences.buildGuardrailPreferenceDescriptors(config);

    expect(
      descriptors.find(
        (descriptor) => descriptor.key === "commandGate.patterns.custom-prod-reset.enabled",
      ),
    ).toMatchObject({
      section: "commands",
      label: "Bulk delete command used in reset scripts",
      example: "sf data delete bulk",
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

  it("preserves advanced rule overrides when updating timeout", () => {
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

    preferences.updateUserPreference("confirmTimeoutMs", "60000");

    const after = readFileSync(overridePath, "utf8");
    const raw = JSON.parse(after);
    const settings = JSON.parse(readFileSync(settingsModule.globalSettingsPath(), "utf8"));
    expect(after).toBe(before);
    expect(raw.commandGate.patterns[0].id).toBe("custom-danger");
    expect(settings.sfPi.guardrail.confirmTimeoutMs).toBe(60000);
  });
});
