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

  it("writes policy rule enablement overrides that loadConfig reads", () => {
    const config = configModule.readBundledConfig();

    preferences.updateUserPreference("policies.rules.secret-files.enabled", "off", config);

    const { config: loaded } = configModule.loadConfig();
    expect(loaded.policies.rules.find((rule) => rule.id === "secret-files")?.enabled).toBe(false);
  });

  it("writes command pattern enablement overrides that loadConfig reads", () => {
    const config = configModule.readBundledConfig();

    preferences.updateUserPreference("commandGate.patterns.rm-rf.enabled", "off", config);

    const { config: loaded } = configModule.loadConfig();
    expect(loaded.commandGate.patterns.find((pattern) => pattern.id === "rm-rf")?.enabled).toBe(
      false,
    );
  });

  it("writes org-aware rule enablement overrides that loadConfig reads", () => {
    const config = configModule.readBundledConfig();

    preferences.updateUserPreference("orgAwareGate.rules.sf-deploy-prod.enabled", "off", config);

    const { config: loaded } = configModule.loadConfig();
    expect(loaded.orgAwareGate.rules.find((rule) => rule.id === "sf-deploy-prod")?.enabled).toBe(
      false,
    );
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
