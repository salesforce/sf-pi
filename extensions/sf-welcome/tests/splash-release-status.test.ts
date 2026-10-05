/* SPDX-License-Identifier: Apache-2.0 */
/** Render-level checks for the SF Pi package freshness row. */
import { describe, expect, it } from "vitest";
import type { ReleaseStatusInfo, SplashData } from "../lib/types.ts";

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, "g");

function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, "");
}

function baseData(overrides: Partial<SplashData> = {}): SplashData {
  return {
    modelName: "Claude Sonnet 4",
    providerName: "anthropic",
    loadedCounts: { extensions: 5, skills: 2, promptTemplates: 1 },
    recentSessions: [],
    extensionHealth: [
      { name: "Pi Manager", status: "locked", icon: "◆" },
      { name: "Welcome", status: "active", icon: "●" },
      { name: "Slack", status: "disabled", icon: "○" },
    ],
    slackConnected: false,
    slackVisible: false,
    monthlyCost: 0,
    monthlyBudget: 3000,
    sfCli: { installed: true, freshness: "latest", loading: false, installedVersion: "2.134.6" },
    privacy: { telemetryEnabled: false, source: "sf-pi-default" },
    sfSkills: {
      installKind: "managed",
      freshness: "latest",
      loading: false,
      skillCount: 53,
    },
    sfPiRelease: {
      installedVersion: "0.141.1",
      latestVersion: "0.141.1",
      freshness: "latest",
      loading: false,
    },
    ...overrides,
  };
}

async function render(data: SplashData): Promise<string> {
  process.env.SF_PI_ASCII_ICONS = "1";
  try {
    const { SfWelcomeOverlay } = await import("../lib/splash-component.ts");
    return new SfWelcomeOverlay(data).render(220).map(stripAnsi).join("\n");
  } finally {
    delete process.env.SF_PI_ASCII_ICONS;
  }
}

function findStatusLine(rendered: string, label: string): string {
  const line = rendered
    .split("\n")
    .find(
      (candidate) =>
        candidate.includes(label) &&
        (candidate.includes("latest") ||
          candidate.includes("checking latest") ||
          candidate.includes("update available") ||
          candidate.includes("installed")),
    );
  if (!line) throw new Error(`Could not find ${label} status row in:\n${rendered}`);
  return line;
}

describe("release freshness splash row", () => {
  it("replaces the old top sf-pi Extensions row with a compact sf-pi release row", async () => {
    const rendered = await render(baseData());

    expect(rendered).not.toContain("sf-pi Extensions");
    const sfPi = findStatusLine(rendered, "sf-pi");
    expect(sfPi).toContain("latest");
    expect(sfPi).toContain("v0.141.1");
    expect(sfPi).toContain("2/3 extensions active");
  });

  it("shows the installed SF Pi version while freshness is still checking", async () => {
    const checking: ReleaseStatusInfo = {
      installedVersion: "0.141.1",
      freshness: "checking",
      loading: true,
    };
    const rendered = await render(baseData({ sfPiRelease: checking }));

    expect(findStatusLine(rendered, "sf-pi")).toContain("checking latest");
    expect(findStatusLine(rendered, "sf-pi")).toContain("v0.141.1");
  });

  it("renders an update hint only for an available SF Pi package update", async () => {
    const rendered = await render(
      baseData({
        sfPiRelease: {
          installedVersion: "0.140.0",
          latestVersion: "0.141.1",
          freshness: "update-available",
          loading: false,
          updateCommand: "pi update git:github.com/salesforce/sf-pi",
        },
      }),
    );

    expect(findStatusLine(rendered, "sf-pi")).toContain("update available");
    expect(rendered).toContain("→ pi update git:github.com/salesforce/sf-pi");
  });

  it("leaves Pi Runtime release checks and update guidance to Pi", async () => {
    const rendered = await render(baseData());

    expect(() => findStatusLine(rendered, "Pi")).toThrow("Could not find Pi status row");
  });
});
