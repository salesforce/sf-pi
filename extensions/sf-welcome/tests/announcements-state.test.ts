/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for announcements state persistence.
 *
 * Exercises dismissals, revision ack, ETag/cache bookkeeping, and reset —
 * each one via its own path override so we never touch the real agent dir.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acknowledgeAnnouncementsRevision,
  dismissAnnouncement,
  readAnnouncementsState,
  resetAnnouncementsState,
  updateRemoteCache,
  writeAnnouncementsState,
} from "../lib/announcements-state.ts";

const tempDirs: string[] = [];

function tempStatePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "announcements-state-"));
  tempDirs.push(dir);
  return join(dir, "announcements.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("announcements-state", () => {
  it("returns empty state when file is missing", () => {
    const state = readAnnouncementsState(tempStatePath());
    expect(state).toEqual({ acknowledgedRevision: "", dismissed: {} });
  });

  it("writes and reads acknowledgedRevision", () => {
    const path = tempStatePath();
    acknowledgeAnnouncementsRevision("2026-04-29-01", path);
    expect(readAnnouncementsState(path).acknowledgedRevision).toBe("2026-04-29-01");
  });

  it("records a dismissal with a timestamp and round-trips it", () => {
    const path = tempStatePath();
    dismissAnnouncement("my-id", path);
    const state = readAnnouncementsState(path);
    expect(state.dismissed["my-id"]).toBeTruthy();
    // Should parse as a real ISO date.
    expect(Number.isFinite(Date.parse(state.dismissed["my-id"]))).toBe(true);
  });

  it("accumulates multiple dismissals without overwriting", () => {
    const path = tempStatePath();
    dismissAnnouncement("a", path);
    dismissAnnouncement("b", path);
    const state = readAnnouncementsState(path);
    expect(Object.keys(state.dismissed).sort()).toEqual(["a", "b"]);
  });

  it("treats malformed JSON as an empty state", () => {
    const path = tempStatePath();
    writeFileSync(path, "{ broken", "utf8");
    expect(readAnnouncementsState(path)).toEqual({
      acknowledgedRevision: "",
      dismissed: {},
    });
  });

  it("round-trips ETag + cached remote payload", () => {
    const path = tempStatePath();
    updateRemoteCache(
      {
        lastFetchAt: "2026-04-29T00:00:00Z",
        lastFetchEtag: 'W/"abc"',
        cachedRemote: '{"schemaVersion":1,"revision":"r","announcements":[]}',
      },
      path,
    );
    const state = readAnnouncementsState(path);
    expect(state.lastFetchEtag).toBe('W/"abc"');
    expect(state.lastFetchAt).toBe("2026-04-29T00:00:00Z");
    expect(state.cachedRemote).toContain("schemaVersion");
  });

  it("resetAnnouncementsState clears everything", () => {
    const path = tempStatePath();
    dismissAnnouncement("x", path);
    acknowledgeAnnouncementsRevision("r", path);
    resetAnnouncementsState(path);
    const state = readAnnouncementsState(path);
    expect(state).toEqual({ acknowledgedRevision: "", dismissed: {} });
  });

  it("writeAnnouncementsState creates parent directory if missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "announcements-state-"));
    tempDirs.push(dir);
    const deeper = join(dir, "nested", "deeper", "announcements.json");
    writeAnnouncementsState({ acknowledgedRevision: "r", dismissed: { a: "t" } }, deeper);
    const raw = JSON.parse(readFileSync(deeper, "utf8"));
    expect(raw.acknowledgedRevision).toBe("r");
  });
});
