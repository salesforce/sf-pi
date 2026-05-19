/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Render-level checks for the Welcome Splash wordmark depth treatment.
 *
 * The subtle shadow is intentionally visual-only, so these assertions strip
 * ANSI and verify the row geometry: the existing spacer below the SALESFORCE
 * wordmark is reused for the final shadow row, and the caption follows
 * immediately after it so the splash height stays unchanged.
 */
import { describe, expect, it } from "vitest";
import type { SplashData } from "../lib/types.ts";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function baseData(): SplashData {
  return {
    modelName: "Claude Sonnet 4",
    providerName: "anthropic",
    loadedCounts: { extensions: 5, skills: 2, promptTemplates: 1 },
    recentSessions: [],
    extensionHealth: [],
    slackConnected: false,
    slackVisible: false,
    monthlyCost: 0,
    monthlyBudget: 3000,
    sfCli: { installed: true, freshness: "latest", loading: false, installedVersion: "2.134.6" },
    privacy: { telemetryEnabled: false, source: "sf-pi-default" },
  };
}

describe("Welcome Splash wordmark shadow", () => {
  it("reuses the spacer below SALESFORCE for the final subtle shadow row", async () => {
    process.env.SF_PI_ASCII_ICONS = "1";
    try {
      const { SfWelcomeOverlay } = await import("../lib/splash-component.ts");
      const overlay = new SfWelcomeOverlay(baseData());
      const lines = overlay.render(220).map(stripAnsi);

      const captionRow = lines.findIndex((line) =>
        line.includes("[ Headless 360 · Pro-code Access ]"),
      );
      expect(captionRow).toBeGreaterThan(-1);

      const shadowRow = lines[captionRow - 1] ?? "";
      expect(shadowRow).toContain("████▀");
      expect(shadowRow).toContain("▀████");

      const lastWordmarkRow = lines[captionRow - 2] ?? "";
      expect(lastWordmarkRow).toContain("████▀");
      expect(lastWordmarkRow).toContain("▀████");
    } finally {
      delete process.env.SF_PI_ASCII_ICONS;
    }
  });

  it("keeps the wider shadowed wordmark untruncated in normal two-column previews", async () => {
    process.env.SF_PI_ASCII_ICONS = "1";
    try {
      const { SfWelcomeOverlay } = await import("../lib/splash-component.ts");
      const overlay = new SfWelcomeOverlay(baseData());
      const lines = overlay.render(160).map(stripAnsi);

      const captionRow = lines.findIndex((line) =>
        line.includes("[ Headless 360 · Pro-code Access ]"),
      );
      expect(captionRow).toBeGreaterThan(-1);

      const wordmarkRows = lines.slice(captionRow - 6, captionRow);
      expect(wordmarkRows).toHaveLength(6);
      for (const row of wordmarkRows) {
        const leftColumn = row.split("│")[1] ?? row;
        expect(leftColumn).not.toContain("…");
      }
    } finally {
      delete process.env.SF_PI_ASCII_ICONS;
    }
  });
});
