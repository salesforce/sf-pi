/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the sf-welcome What's New pipeline.
 *
 * Covers:
 * - Version comparison (including prereleases)
 * - CHANGELOG parsing + filtering by version range
 * - Bullet cleaning (strips GitHub refs + author attribution)
 * - Summarization ordering + caps
 * - Integration: buildWhatsNewPayload end-to-end with a fixture package
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  WHATSNEW_MAX_BULLETS,
  buildWhatsNewPayload,
  cleanBullet,
  compareVersions,
  isVersionGreater,
  parseChangelog,
  readCurrentPiVersion,
  resolveChangelogPath,
  sliceChangelog,
  summarizeChangelog,
} from "../lib/whats-new.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------------------------------
// Version comparison
// -------------------------------------------------------------------------------------------------

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

// -------------------------------------------------------------------------------------------------
// Bullet cleaning
// -------------------------------------------------------------------------------------------------

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

// -------------------------------------------------------------------------------------------------
// Changelog parsing + slicing
// -------------------------------------------------------------------------------------------------

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

// -------------------------------------------------------------------------------------------------
// Summarization
// -------------------------------------------------------------------------------------------------

describe("summarizeChangelog", () => {
  it("keeps all feature bullets and caps fixes per version", () => {
    const all = parseChangelog(TINY_CHANGELOG);
    const bullets = summarizeChangelog(sliceChangelog(all, "0.67.68", "0.68.1"));
    const featureBullets = bullets.filter((b) => b.section === "feature");
    const fixBullets = bullets.filter((b) => b.section === "fix");
    expect(featureBullets.length).toBeGreaterThan(0);
    expect(featureBullets[0].text).toContain("Fireworks");
    expect(bullets.length).toBeLessThanOrEqual(WHATSNEW_MAX_BULLETS);
    // Fix bullets should have no GitHub refs
    for (const bullet of fixBullets) {
      expect(bullet.text).not.toMatch(/#\d+/);
    }
  });

  it("hard-caps the combined bullet count", () => {
    // Generate a synthetic long changelog
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

// -------------------------------------------------------------------------------------------------
// buildWhatsNewPayload integration
// -------------------------------------------------------------------------------------------------

/**
 * Create a fake pi-coding-agent package directory containing a package.json
 * and CHANGELOG.md. We point buildWhatsNewPayload at it via options so the
 * test never depends on the real installed version.
 */
function createFakePiPackage(version: string, changelog: string): string {
  const dir = makeTempDir("whats-new-pi-");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "@mariozechner/pi-coding-agent", version }, null, 2),
    "utf-8",
  );
  writeFileSync(join(dir, "CHANGELOG.md"), changelog, "utf-8");
  return dir;
}

function createStateFile(dir: string, lastSeen: string | undefined): string {
  const statePath = join(dir, "welcome-state.json");
  if (lastSeen !== undefined) {
    writeFileSync(statePath, JSON.stringify({ lastSeenPiVersion: lastSeen }), "utf-8");
  }
  return statePath;
}

describe("buildWhatsNewPayload", () => {
  it("returns null when the user has never seen any version", () => {
    const pkg = createFakePiPackage("0.68.1", TINY_CHANGELOG);
    const stateDir = makeTempDir("whats-new-state-");
    const statePath = createStateFile(stateDir, undefined);

    const payload = buildWhatsNewPayload({ piPackagePath: pkg, statePath });
    expect(payload).toBeNull();
  });

  it("returns null when current === lastSeen", () => {
    const pkg = createFakePiPackage("0.68.1", TINY_CHANGELOG);
    const stateDir = makeTempDir("whats-new-state-");
    const statePath = createStateFile(stateDir, "0.68.1");

    const payload = buildWhatsNewPayload({ piPackagePath: pkg, statePath });
    expect(payload).toBeNull();
  });

  it("returns null on downgrade (no panel for past versions)", () => {
    const pkg = createFakePiPackage("0.67.68", TINY_CHANGELOG);
    const stateDir = makeTempDir("whats-new-state-");
    const statePath = createStateFile(stateDir, "0.68.1");

    const payload = buildWhatsNewPayload({ piPackagePath: pkg, statePath });
    expect(payload).toBeNull();
  });

  it("builds a payload spanning last-seen to current", () => {
    const pkg = createFakePiPackage("0.68.1", TINY_CHANGELOG);
    const stateDir = makeTempDir("whats-new-state-");
    const statePath = createStateFile(stateDir, "0.67.68");

    const payload = buildWhatsNewPayload({ piPackagePath: pkg, statePath });
    expect(payload).not.toBeNull();
    expect(payload!.fromVersion).toBe("0.67.68");
    expect(payload!.toVersion).toBe("0.68.1");
    expect(payload!.bullets.length).toBeGreaterThan(0);
    expect(payload!.bullets[0].text).toContain("Fireworks");
  });

  it("returns null when CHANGELOG.md is missing", () => {
    // Only create package.json, not CHANGELOG
    const dir = makeTempDir("whats-new-pi-");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "@mariozechner/pi-coding-agent", version: "0.68.1" }),
      "utf-8",
    );
    const stateDir = makeTempDir("whats-new-state-");
    const statePath = createStateFile(stateDir, "0.67.68");

    const payload = buildWhatsNewPayload({ piPackagePath: dir, statePath });
    expect(payload).toBeNull();
  });
});

describe("readCurrentPiVersion", () => {
  it("reads version from a provided package path", () => {
    const pkg = createFakePiPackage("0.99.9", "# Changelog\n");
    expect(readCurrentPiVersion(pkg)).toBe("0.99.9");
  });

  it("returns undefined when package.json is missing", () => {
    const dir = makeTempDir("whats-new-bare-");
    // Intentionally empty — no package.json
    // mkdirSync is a no-op here because makeTempDir already created it, but
    // we call it to make the intent explicit.
    mkdirSync(dir, { recursive: true });
    expect(readCurrentPiVersion(dir)).toBeUndefined();
  });
});

describe("resolveChangelogPath", () => {
  it("returns the CHANGELOG.md sibling of the provided package path", () => {
    const pkg = createFakePiPackage("1.0.0", "# Changelog\n");
    const changelogPath = resolveChangelogPath(pkg);
    expect(changelogPath).toBe(join(pkg, "CHANGELOG.md"));
  });
});
