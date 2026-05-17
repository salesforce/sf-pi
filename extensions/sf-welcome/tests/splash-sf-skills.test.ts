/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Render-level checks for the SF Skills splash row.
 *
 * Tests the five visual states the row can be in. Strips ANSI before
 * matching so the assertions describe what the user actually sees, not
 * the color-code payload. The row label and ↑ glyph are colored at
 * render time; we verify the text + ASCII glyph here and trust the
 * existing snapshot/visual tests to cover color regressions.
 */
import { describe, expect, it } from "vitest";
import type { SplashData, SfSkillsStatusInfo } from "../lib/types.ts";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function baseData(sfSkills: SfSkillsStatusInfo | undefined): SplashData {
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
    sfSkills,
  };
}

interface RenderedSkillsRow {
  /** The main row containing the SF Skills label. */
  row: string;
  /** Optional muted action sub-line directly under the row, or null. */
  hint: string | null;
  /** Full plain-text render, for ad-hoc assertions. */
  full: string;
}

async function renderRow(sfSkills: SfSkillsStatusInfo | undefined): Promise<RenderedSkillsRow> {
  // Force ASCII glyphs so assertions don't depend on emoji width.
  process.env.SF_PI_ASCII_ICONS = "1";
  try {
    const { SfWelcomeOverlay } = await import("../lib/splash-component.ts");
    const overlay = new SfWelcomeOverlay(baseData(sfSkills));
    // 220 cols matches the wide-layout smoke tests so the right side of
    // the row is never column-clipped by the splash's column rules.
    const lines = overlay.render(220).map(stripAnsi);
    const idx = lines.findIndex((line) => line.includes("SF Skills"));
    if (idx === -1) throw new Error(`SF Skills row not found in:\n${lines.join("\n")}`);
    const next = lines[idx + 1] ?? "";
    // The hint sub-line uses a leading "→ " inside a muted color block.
    const hint = next.includes("→") ? next : null;
    return { row: lines[idx], hint, full: lines.join("\n") };
  } finally {
    delete process.env.SF_PI_ASCII_ICONS;
  }
}

describe("SF Skills splash row — five render states", () => {
  it("loading: shows the hourglass while the deferred refresh runs", async () => {
    const { row, hint } = await renderRow({
      installKind: "not-installed",
      freshness: "checking",
      loading: true,
    });
    expect(row).toContain("SF Skills");
    expect(row).toContain("Checking");
    // No action hint while the row is still loading — we don't know yet.
    expect(hint).toBeNull();
  });

  it("not-installed: opinionated orange ↑ row + muted install-command sub-line", async () => {
    const { row, hint } = await renderRow({
      installKind: "not-installed",
      freshness: "unknown",
      loading: false,
    });
    expect(row).toContain("SF Skills");
    expect(row).toContain("↑");
    expect(row).toContain("Install official skills");
    expect(row).toContain("afv-library");
    // The actionable command lives on the muted sub-line so the row stays
    // inside the column-width cap.
    expect(hint).not.toBeNull();
    expect(hint).toContain("/sf-skills defaults install");
  });

  it("managed + latest: green ✓ with skill count and 'latest' suffix, no hint", async () => {
    const { row, hint } = await renderRow({
      installKind: "managed",
      scope: "global",
      rootPath: "/home/me/.pi/agent/sf-skills/afv-library",
      skillsPath: "/home/me/.pi/agent/sf-skills/afv-library/skills",
      localSha: "a".repeat(40),
      remoteSha: "a".repeat(40),
      commitsBehind: 0,
      skillCount: 53,
      freshness: "latest",
      loading: false,
    });
    expect(row).toContain("✓");
    expect(row).toContain("afv-library installed");
    expect(row).toContain("latest");
    expect(row).toContain("53 skills");
    // Nothing actionable on this state — no sub-line.
    expect(hint).toBeNull();
  });

  it("managed + update-available: orange ↑ row + muted update-command sub-line", async () => {
    const { row, hint } = await renderRow({
      installKind: "managed",
      scope: "global",
      rootPath: "/home/me/.pi/agent/sf-skills/afv-library",
      skillsPath: "/home/me/.pi/agent/sf-skills/afv-library/skills",
      localSha: "a".repeat(40),
      remoteSha: "b".repeat(40),
      commitsBehind: 12,
      freshness: "update-available",
      loading: false,
    });
    expect(row).toContain("↑");
    expect(row).toContain("afv-library");
    expect(row).toContain("12 commits behind");
    expect(hint).not.toBeNull();
    expect(hint).toContain("/sf-skills defaults update");
  });

  it("managed + update-available with behind=1: singular 'commit'", async () => {
    const { row } = await renderRow({
      installKind: "managed",
      scope: "global",
      rootPath: "/home/me/.pi/agent/sf-skills/afv-library",
      skillsPath: "/home/me/.pi/agent/sf-skills/afv-library/skills",
      localSha: "a".repeat(40),
      remoteSha: "b".repeat(40),
      commitsBehind: 1,
      freshness: "update-available",
      loading: false,
    });
    expect(row).toContain("1 commit behind");
    expect(row).not.toContain("1 commits behind");
  });

  it("linked: green ✓, never nags, no action hint", async () => {
    const { row, hint } = await renderRow({
      installKind: "linked",
      scope: "global",
      rootPath: "/Users/me/work/afv-library",
      skillsPath: "/Users/me/work/afv-library/skills",
      localSha: "c".repeat(40),
      skillCount: 7,
      freshness: "unknown",
      loading: false,
    });
    expect(row).toContain("✓");
    expect(row).toContain("afv-library linked");
    expect(row).toContain("7 skills");
    // Linked rows never carry the orange ↑ — they're user-owned working trees.
    expect(row).not.toContain("↑");
    expect(row).not.toContain("commits behind");
    expect(hint).toBeNull();
  });

  it("managed + unknown freshness: still green ✓ (no false 'update' alarm), no hint", async () => {
    const { row, hint } = await renderRow({
      installKind: "managed",
      scope: "global",
      rootPath: "/home/me/.pi/agent/sf-skills/afv-library",
      skillsPath: "/home/me/.pi/agent/sf-skills/afv-library/skills",
      localSha: "a".repeat(40),
      skillCount: 53,
      freshness: "unknown",
      loading: false,
    });
    expect(row).toContain("✓");
    expect(row).toContain("afv-library installed");
    expect(row).not.toContain("↑");
    expect(row).not.toContain("Update");
    expect(hint).toBeNull();
  });
});
