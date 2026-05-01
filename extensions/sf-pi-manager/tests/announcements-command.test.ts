/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for `/sf-pi announcements` argument parsing and the footer nudge.
 *
 * Mirrors recommendations-command.test.ts — both commands share the
 * "nudge on unseen revision" pattern and the "parse with optional tail
 * scope" shape, so the tests read symmetrically.
 */
import { describe, it, expect } from "vitest";
import type { AnnouncementsManifest, AnnouncementItem } from "../../../catalog/types.ts";
import { computeAnnouncementsNudge, parseAnnouncementsArgs } from "../lib/announcements.ts";
import type { AnnouncementsState } from "../../../lib/common/catalog-state/announcements-state.ts";
import type { AnnouncementsPayload } from "../../sf-welcome/lib/announcements.ts";

// -------------------------------------------------------------------------------------------------
// parseAnnouncementsArgs
// -------------------------------------------------------------------------------------------------

describe("parseAnnouncementsArgs", () => {
  it("defaults to list for empty input", () => {
    expect(parseAnnouncementsArgs("")).toEqual({ subcommand: "list" });
  });

  it("accepts list / ls aliases", () => {
    expect(parseAnnouncementsArgs("list").subcommand).toBe("list");
    expect(parseAnnouncementsArgs("ls").subcommand).toBe("list");
  });

  it("parses dismiss with a target id", () => {
    expect(parseAnnouncementsArgs("dismiss my-id")).toEqual({
      subcommand: "dismiss",
      target: "my-id",
    });
  });

  it("treats 'hide' as an alias for dismiss", () => {
    expect(parseAnnouncementsArgs("hide my-id")).toEqual({
      subcommand: "dismiss",
      target: "my-id",
    });
  });

  it("routes reset / clear", () => {
    expect(parseAnnouncementsArgs("reset").subcommand).toBe("reset");
    expect(parseAnnouncementsArgs("clear").subcommand).toBe("reset");
  });

  it("falls back to list for unknown subcommands", () => {
    expect(parseAnnouncementsArgs("wat").subcommand).toBe("list");
  });

  it("dismiss without target leaves target undefined", () => {
    expect(parseAnnouncementsArgs("dismiss")).toEqual({
      subcommand: "dismiss",
      target: undefined,
    });
  });
});

// -------------------------------------------------------------------------------------------------
// computeAnnouncementsNudge
// -------------------------------------------------------------------------------------------------

function manifest(revision: string, items: AnnouncementItem[] = []): AnnouncementsManifest {
  return { schemaVersion: 1, revision, announcements: items };
}

function state(partial: Partial<AnnouncementsState> = {}): AnnouncementsState {
  return { acknowledgedRevision: "", dismissed: {}, ...partial };
}

function payload(visibleCount: number): AnnouncementsPayload {
  return {
    revision: "r",
    totalActive: visibleCount,
    hasUnacknowledged: visibleCount > 0,
    visible: Array.from({ length: visibleCount }, (_, i) => ({
      id: `v${i}`,
      kind: "note",
      severity: "info",
      title: `Item ${i}`,
    })),
  };
}

describe("computeAnnouncementsNudge", () => {
  it("is hidden when SF_PI_ANNOUNCEMENTS=off", () => {
    const info = computeAnnouncementsNudge(manifest("r"), state(), payload(1), {
      SF_PI_ANNOUNCEMENTS: "off",
    } as NodeJS.ProcessEnv);
    expect(info.show).toBe(false);
  });

  it("is hidden when manifest revision is empty", () => {
    const info = computeAnnouncementsNudge(
      manifest(""),
      state(),
      payload(1),
      {} as NodeJS.ProcessEnv,
    );
    expect(info.show).toBe(false);
  });

  it("is hidden when user has already acknowledged the current revision", () => {
    const info = computeAnnouncementsNudge(
      manifest("r"),
      state({ acknowledgedRevision: "r" }),
      payload(1),
      {} as NodeJS.ProcessEnv,
    );
    expect(info.show).toBe(false);
  });

  it("is hidden when nothing is visible after filtering", () => {
    const info = computeAnnouncementsNudge(
      manifest("r"),
      state(),
      payload(0),
      {} as NodeJS.ProcessEnv,
    );
    expect(info.show).toBe(false);
  });

  it("is shown when revision is unseen and items are visible", () => {
    const info = computeAnnouncementsNudge(
      manifest("r"),
      state(),
      payload(2),
      {} as NodeJS.ProcessEnv,
    );
    expect(info.show).toBe(true);
    expect(info.visibleCount).toBe(2);
  });
});
