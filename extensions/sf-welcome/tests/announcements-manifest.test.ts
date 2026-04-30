/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the bundled manifest loader.
 *
 * Covers the failure-tolerant contract: missing file, malformed JSON, wrong
 * schema version, and partial/invalid entries all resolve to an empty but
 * well-shaped manifest so the splash never crashes.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  announcementsManifestPath,
  loadAnnouncementsManifest,
  isValidAnnouncement,
} from "../lib/announcements-manifest.ts";

const tempDirs: string[] = [];

function makePackageRoot(contents: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "announcements-pkg-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "catalog"), { recursive: true });
  if (contents !== null) {
    writeFileSync(announcementsManifestPath(dir), contents, "utf8");
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("announcements-manifest", () => {
  it("returns empty manifest when file is missing", () => {
    const root = makePackageRoot(null);
    const manifest = loadAnnouncementsManifest(root);
    expect(manifest).toEqual({ schemaVersion: 1, revision: "", announcements: [] });
  });

  it("returns empty manifest for malformed JSON", () => {
    const root = makePackageRoot("{ not json");
    const manifest = loadAnnouncementsManifest(root);
    expect(manifest.announcements).toEqual([]);
  });

  it("returns empty manifest when schemaVersion is unsupported", () => {
    const root = makePackageRoot(
      JSON.stringify({ schemaVersion: 2, revision: "r", announcements: [] }),
    );
    const manifest = loadAnnouncementsManifest(root);
    expect(manifest.announcements).toEqual([]);
  });

  it("parses a valid manifest and keeps only well-formed entries", () => {
    const root = makePackageRoot(
      JSON.stringify({
        schemaVersion: 1,
        revision: "2026-04-29",
        latestVersion: "0.17.0",
        feedUrl: "https://example.com/feed.json",
        announcements: [
          { id: "good", kind: "note", title: "Hello" },
          { id: "", kind: "note", title: "Missing id" },
          { id: "bad-kind", kind: "spam", title: "Bad kind" },
          "totally invalid",
        ],
      }),
    );
    const manifest = loadAnnouncementsManifest(root);
    expect(manifest.revision).toBe("2026-04-29");
    expect(manifest.latestVersion).toBe("0.17.0");
    expect(manifest.feedUrl).toBe("https://example.com/feed.json");
    expect(manifest.announcements.map((a) => a.id)).toEqual(["good"]);
  });

  it("isValidAnnouncement rejects objects with bad severity", () => {
    expect(isValidAnnouncement({ id: "a", kind: "note", title: "t", severity: "panic" })).toBe(
      false,
    );
    expect(isValidAnnouncement({ id: "a", kind: "note", title: "t", severity: "warn" })).toBe(true);
  });
});
