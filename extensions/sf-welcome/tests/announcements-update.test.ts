/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the update-nudge synthesizer.
 *
 * The nudge is the most behavior-sensitive piece of the feature: it must
 * appear only when the installed version is behind and must never appear
 * when versions match. CHANGELOG integration is optional — the nudge is
 * still produced without it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildUpdateAnnouncement, UPDATE_NUDGE_ID } from "../lib/announcements-update.ts";

const tempDirs: string[] = [];

function tempPackageRoot(changelog?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ann-update-"));
  tempDirs.push(dir);
  if (changelog !== undefined) writeFileSync(join(dir, "CHANGELOG.md"), changelog, "utf8");
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("announcements-update", () => {
  it("returns undefined when no version info is supplied", () => {
    expect(buildUpdateAnnouncement({})).toBeUndefined();
  });

  it("returns undefined when installed >= latest", () => {
    expect(
      buildUpdateAnnouncement({ installedVersion: "0.17.0", latestVersion: "0.17.0" }),
    ).toBeUndefined();
    expect(
      buildUpdateAnnouncement({ installedVersion: "0.18.0", latestVersion: "0.17.0" }),
    ).toBeUndefined();
  });

  it("builds a warn-severity announcement when installed < latest", () => {
    const item = buildUpdateAnnouncement({
      installedVersion: "0.16.0",
      latestVersion: "0.17.0",
    });
    expect(item).toBeDefined();
    expect(item?.id).toBe(UPDATE_NUDGE_ID);
    expect(item?.kind).toBe("update");
    expect(item?.severity).toBe("warn");
    expect(item?.title).toContain("0.17.0");
    expect(item?.title).toContain("0.16.0");
    expect(item?.link).toContain("releases/tag/v0.17.0");
  });

  it("includes changelog bullets when CHANGELOG.md is available", () => {
    const changelog = [
      "# Changelog",
      "",
      "## [0.17.0] - 2026-04-29",
      "",
      "### Added",
      "- Announcements panel for maintainer notes",
      "- Update nudge synthesizer",
      "",
      "### Fixed",
      "- Minor rendering fix",
      "",
      "## [0.16.0] - 2026-04-15",
      "",
      "### Added",
      "- Earlier feature that should NOT appear",
    ].join("\n");
    const root = tempPackageRoot(changelog);

    const item = buildUpdateAnnouncement({
      installedVersion: "0.16.0",
      latestVersion: "0.17.0",
      packageRoot: root,
    });
    expect(item).toBeDefined();
    expect(item?.body).toContain("Announcements panel for maintainer notes");
    expect(item?.body).toContain("Update nudge synthesizer");
    // Items from the installed version should not appear.
    expect(item?.body).not.toContain("Earlier feature that should NOT appear");
  });

  it("falls back to an empty highlights section when no CHANGELOG is found", () => {
    const root = tempPackageRoot();
    const item = buildUpdateAnnouncement({
      installedVersion: "0.16.0",
      latestVersion: "0.17.0",
      packageRoot: root,
    });
    expect(item?.body).toContain("pi update git:github.com/salesforce/sf-pi");
    expect(item?.body).not.toContain("Highlights since");
  });
});
