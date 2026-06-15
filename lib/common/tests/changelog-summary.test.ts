/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior tests for the shared changelog summarizer used by sf-pi update announcements. */
import { describe, expect, it } from "vitest";

import {
  WHATSNEW_MAX_BULLETS,
  cleanBullet,
  compareVersions,
  isVersionGreater,
  parseChangelog,
  sliceChangelog,
  summarizeChangelog,
} from "../catalog-state/whats-new.ts";

const TINY_CHANGELOG = `
# Changelog

## [0.68.1] - 2026-04-22

### New Features

- Fireworks provider support with built-in models

### Fixed

- Fixed interactive inline tool images ([#3508](https://example.test/3508))
- Fixed \`sessionDir\` in \`settings.json\` to expand ~

## [0.68.0] - 2026-04-20

### Breaking Changes

- Changed SDK tool selection to allowlists

### Added

- Added extension support for \`ctx.ui.setWorkingIndicator()\`

### Fixed

- Fixed shell-path resolution to stop consulting ambient process.cwd() ([#3452](https://example.test/3452))

## [0.67.68] - 2026-04-17

### Fixed

- Minor fix unrelated to provider behavior
`;

describe("compareVersions", () => {
  it("orders dotted release versions numerically, not lexically", () => {
    expect(compareVersions("0.67.67", "0.67.68")).toBeLessThan(0);
    expect(compareVersions("0.68.0", "0.67.68")).toBeGreaterThan(0);
    expect(compareVersions("0.68.1", "0.68.1")).toBe(0);
  });

  it("treats a release as greater than its prerelease", () => {
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0-beta.2")).toBeLessThan(0);
  });
});

describe("isVersionGreater", () => {
  it("matches compareVersions for release pairs", () => {
    expect(isVersionGreater("0.68.1", "0.68.0")).toBe(true);
    expect(isVersionGreater("0.68.0", "0.68.0")).toBe(false);
    expect(isVersionGreater("0.67.5", "0.68.0")).toBe(false);
  });
});

describe("cleanBullet", () => {
  it("strips trailing GitHub issue / PR references", () => {
    expect(cleanBullet("Added X provider support ([#3519](https://example.test/3519))")).toBe(
      "Added X provider support",
    );
  });

  it("strips multiple inline issue links", () => {
    const input =
      "Fixed Bedrock resolution ([#3481](https://example.test/3481), [#3485](https://example.test/3485))";
    expect(cleanBullet(input)).toBe("Fixed Bedrock resolution");
  });

  it("removes author attribution", () => {
    const input =
      "Changed foo ([#100](https://example.test/100) by [@contributor](https://example.test/u))";
    expect(cleanBullet(input)).toBe("Changed foo");
  });

  it("leaves plain text untouched", () => {
    expect(cleanBullet("Fireworks provider support with built-in models")).toBe(
      "Fireworks provider support with built-in models",
    );
  });
});

describe("parseChangelog", () => {
  it("extracts versions and bullets", () => {
    const sections = parseChangelog(TINY_CHANGELOG);
    expect(sections.map((s) => s.version)).toEqual(["0.68.1", "0.68.0", "0.67.68"]);
    expect(sections[0].sections["New Features"]).toEqual([
      "Fireworks provider support with built-in models",
    ]);
    expect(sections[0].sections.Fixed.length).toBe(2);
    expect(sections[1].sections.Added[0]).toContain("setWorkingIndicator");
  });
});

describe("sliceChangelog", () => {
  it("keeps strictly-greater versions up to and including the target", () => {
    const all = parseChangelog(TINY_CHANGELOG);
    const subset = sliceChangelog(all, "0.67.68", "0.68.1");
    expect(subset.map((s) => s.version)).toEqual(["0.68.1", "0.68.0"]);
  });

  it("returns empty when from === to", () => {
    const all = parseChangelog(TINY_CHANGELOG);
    expect(sliceChangelog(all, "0.68.1", "0.68.1")).toEqual([]);
  });

  it("returns empty when the target version is older than from", () => {
    const all = parseChangelog(TINY_CHANGELOG);
    expect(sliceChangelog(all, "0.68.1", "0.67.5")).toEqual([]);
  });
});

describe("summarizeChangelog", () => {
  it("keeps all feature bullets and caps fixes per version", () => {
    const all = parseChangelog(TINY_CHANGELOG);
    const bullets = summarizeChangelog(sliceChangelog(all, "0.67.68", "0.68.1"));
    const featureBullets = bullets.filter((b) => b.section === "feature");
    const fixBullets = bullets.filter((b) => b.section === "fix");
    expect(featureBullets.length).toBeGreaterThan(0);
    expect(featureBullets[0].text).toContain("Fireworks");
    expect(bullets.length).toBeLessThanOrEqual(WHATSNEW_MAX_BULLETS);
    for (const bullet of fixBullets) {
      expect(bullet.text).not.toMatch(/#\d+/);
    }
  });

  it("hard-caps the combined bullet count", () => {
    const lines = ["# Changelog", "", "## [1.1.0] - 2026-01-01", "", "### New Features"];
    for (let i = 0; i < 20; i++) {
      lines.push(`- Feature number ${i}`);
    }
    const longSections = parseChangelog(lines.join("\n"));
    const bullets = summarizeChangelog(longSections);
    expect(bullets.length).toBe(WHATSNEW_MAX_BULLETS);
    expect(bullets.every((b) => b.section === "feature")).toBe(true);
  });
});
