/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for shared sf-pi extension enablement helpers. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  filterEnabledExtensionStatuses,
  getDisabledExtensionFilesForCwd,
  isSfPiExtensionEnabled,
} from "../sf-pi-extension-state.ts";

function makeCwd(disabledFiles: string[]): string {
  const cwd = mkdtempSync(join(tmpdir(), "sf-pi-extension-state-"));
  const configDir = join(cwd, ".pi");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "settings.json"),
    `${JSON.stringify({
      packages: [
        {
          source: "git:github.com/salesforce/sf-pi",
          extensions: ["extensions/*/index.ts", ...disabledFiles.map((file) => `!${file}`)],
        },
      ],
    })}\n`,
  );
  return cwd;
}

describe("sf-pi extension state", () => {
  it("reads disabled extension filters from project settings", () => {
    const cwd = makeCwd(["extensions/sf-slack/index.ts"]);

    expect(getDisabledExtensionFilesForCwd(cwd)).toEqual(new Set(["extensions/sf-slack/index.ts"]));
    expect(isSfPiExtensionEnabled(cwd, "sf-slack")).toBe(false);
    expect(isSfPiExtensionEnabled(cwd, "sf-data360")).toBe(true);
    expect(isSfPiExtensionEnabled(cwd, "sf-welcome")).toBe(true);
  });

  it("keeps default-enabled extensions enabled when listed as explicitly enabled", () => {
    const cwd = mkdtempSync(join(tmpdir(), "sf-pi-extension-state-"));
    const configDir = join(cwd, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "settings.json"),
      `${JSON.stringify({
        packages: [
          {
            source: "git:github.com/salesforce/sf-pi",
            extensions: ["extensions/*/index.ts"],
            enabledExtensions: ["extensions/sf-data360/index.ts"],
          },
        ],
      })}\n`,
    );

    expect(isSfPiExtensionEnabled(cwd, "sf-data360")).toBe(true);
  });

  it("filters footer statuses by owning extension enablement", () => {
    const cwd = makeCwd(["extensions/sf-slack/index.ts"]);
    const statuses = new Map([
      ["sf-slack-status", "Slack ✓ Connected"],
      ["sf-llm-gateway-internal", "$1/∞"],
      ["sf-pi", "SF Pi Packages: 10/12 extensions"],
      ["unknown", "should not render"],
    ]);

    const filtered = filterEnabledExtensionStatuses(cwd, statuses);

    expect(filtered.has("sf-slack-status")).toBe(false);
    expect(filtered.get("sf-llm-gateway-internal")).toBe("$1/∞");
    expect(filtered.get("sf-pi")).toBe("SF Pi Packages: 10/12 extensions");
    expect(filtered.has("unknown")).toBe(false);
  });
});
