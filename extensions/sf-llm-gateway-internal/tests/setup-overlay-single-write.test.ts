/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Regression guard for the Pass 2 cleanup: the gateway setup flow must
 * write the saved config to disk exactly once per apply.
 *
 * Before Pass 2, the config panel wrote via writeGatewaySavedConfig and
 * then the extension entry point re-wrote the same values via a removed
 * saveSetupOverlayInputs helper. These static checks prevent that pattern
 * from silently coming back.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const extensionDir = path.resolve(fileURLToPath(import.meta.url), "../..");

function readSource(file: string): string {
  return readFileSync(path.join(extensionDir, file), "utf-8");
}

describe("setup overlay single-write invariant", () => {
  it("setup-overlay.ts does not call writeGatewaySavedConfig (the panel is the sole writer)", () => {
    const source = readSource("lib/setup-overlay.ts");
    expect(source).not.toContain("writeGatewaySavedConfig");
  });

  it("setup-overlay.ts does not export saveSetupOverlayInputs", () => {
    const source = readSource("lib/setup-overlay.ts");
    expect(source).not.toContain("saveSetupOverlayInputs");
  });

  it("index.ts does not import saveSetupOverlayInputs", () => {
    const source = readSource("index.ts");
    expect(source).not.toContain("saveSetupOverlayInputs");
  });

  it("config-panel.ts is the writer for the interactive setup flow", () => {
    const configPanel = readSource("lib/config-panel.ts");
    expect(configPanel).toContain("writeGatewaySavedConfig(configPath, saved)");
  });

  it("runSetupWizard does not re-write the saved config after the panel returns", () => {
    const source = readSource("index.ts");
    // Extract the runSetupWizard function body and assert no write happens
    // inside it. Enable/disable helpers legitimately write elsewhere.
    const match = source.match(/async function runSetupWizard[\s\S]*?\n}/);
    expect(match, "runSetupWizard function not found").toBeTruthy();
    expect(match![0]).not.toContain("writeGatewaySavedConfig");
  });
});
