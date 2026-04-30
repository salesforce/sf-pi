/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for package source matching in settings.json.
 *
 * Covers: matchesPackageSource, findSfPiPackageEntry
 *
 * This is the most subtle logic in sf-pi-manager: it needs to recognize
 * the sf-pi package whether installed via git URL, npm name, or local path.
 * Getting it wrong means the manager can't find its own package entry
 * and all enable/disable commands fail silently.
 */
import { describe, it, expect } from "vitest";
import { matchesPackageSource, findSfPiPackageEntry } from "../index.ts";
import { TEST_PACKAGE_SOURCE } from "../../../lib/common/test-fixtures.ts";

// -------------------------------------------------------------------------------------------------
// matchesPackageSource
// -------------------------------------------------------------------------------------------------

describe("matchesPackageSource", () => {
  const settingsDir = "/Users/test/.pi/agent";

  it("matches npm-style 'sf-pi' source", () => {
    expect(matchesPackageSource("sf-pi", settingsDir)).toBe(true);
  });

  it("matches npm-style 'npm:sf-pi' source", () => {
    expect(matchesPackageSource("npm:sf-pi", settingsDir)).toBe(true);
  });

  it("matches the canonical sf-pi git URL", () => {
    expect(matchesPackageSource(TEST_PACKAGE_SOURCE, settingsDir)).toBe(true);
  });

  it("matches legacy jag-pi-extensions git URL (backward-compat)", () => {
    expect(matchesPackageSource("git:github.com/Jaganpro/jag-pi-extensions", settingsDir)).toBe(
      true,
    );
  });

  it("is case-insensitive for name matching", () => {
    expect(matchesPackageSource("SF-PI", settingsDir)).toBe(true);
    expect(matchesPackageSource("Jag-Pi-Extensions", settingsDir)).toBe(true);
  });

  it("rejects unrelated package names", () => {
    expect(matchesPackageSource("some-other-package", settingsDir)).toBe(false);
  });

  it("rejects unrelated git URLs", () => {
    expect(matchesPackageSource("git:github.com/other/package", settingsDir)).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
// findSfPiPackageEntry
// -------------------------------------------------------------------------------------------------

describe("findSfPiPackageEntry", () => {
  const settingsDir = "/Users/test/.pi/agent";

  it("finds string entry by name", () => {
    const settings = {
      packages: ["some-package", "sf-pi", "other-package"],
    };
    const result = findSfPiPackageEntry(settings, settingsDir);
    expect(result).not.toBeNull();
    expect(result!.index).toBe(1);
    expect(result!.isObject).toBe(false);
    expect(result!.source).toBe("sf-pi");
  });

  it("finds object entry by source", () => {
    const settings = {
      packages: ["some-package", { source: TEST_PACKAGE_SOURCE, extensions: ["extensions/*.ts"] }],
    };
    const result = findSfPiPackageEntry(settings, settingsDir);
    expect(result).not.toBeNull();
    expect(result!.index).toBe(1);
    expect(result!.isObject).toBe(true);
  });

  it("returns null when no packages array", () => {
    const result = findSfPiPackageEntry({}, settingsDir);
    expect(result).toBeNull();
  });

  it("returns null when packages array has no matching entry", () => {
    const settings = { packages: ["other-package", "another-one"] };
    const result = findSfPiPackageEntry(settings, settingsDir);
    expect(result).toBeNull();
  });

  it("returns null for empty packages array", () => {
    const settings = { packages: [] };
    const result = findSfPiPackageEntry(settings, settingsDir);
    expect(result).toBeNull();
  });

  it("skips entries with invalid shape", () => {
    const settings = {
      packages: [42, null, { noSource: true }, "sf-pi"],
    };
    const result = findSfPiPackageEntry(settings, settingsDir);
    expect(result).not.toBeNull();
    expect(result!.index).toBe(3);
  });
});
