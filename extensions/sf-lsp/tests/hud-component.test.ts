/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the compact HUD visibility predicate.
 */
import { describe, it, expect } from "vitest";
import { createActivityStore, markChecking, recordCheck } from "../lib/activity.ts";
import { HUD_IDLE_HIDE_MS, isLspHudActive } from "../lib/hud-component.ts";

describe("isLspHudActive", () => {
  it("is false when the store has never seen activity", () => {
    const store = createActivityStore();
    expect(isLspHudActive(store)).toBe(false);
  });

  it("is true while a language is checking", () => {
    const store = createActivityStore();
    markChecking(store, "apex", "/p/Foo.cls", "Foo.cls");
    // markChecking doesn't flip hasActivity by design, but checking status
    // still means the HUD should stay up.
    expect(isLspHudActive(store)).toBe(false); // no prior activity yet
    // After the first recordCheck, activity is present.
    recordCheck(store, {
      language: "apex",
      filePath: "/p/Foo.cls",
      startedAt: 0,
      finishedAt: 100,
      diagnostics: [],
      previousFileStatus: undefined,
    });
    markChecking(store, "apex", "/p/Foo.cls", "Foo.cls");
    expect(isLspHudActive(store)).toBe(true);
  });

  it("stays active within HUD_IDLE_HIDE_MS of the last update", () => {
    const store = createActivityStore();
    const base = 1_000_000;
    recordCheck(store, {
      language: "apex",
      filePath: "/p/Foo.cls",
      startedAt: base - 200,
      finishedAt: base,
      diagnostics: [],
      previousFileStatus: undefined,
    });
    expect(isLspHudActive(store, base)).toBe(true);
    expect(isLspHudActive(store, base + HUD_IDLE_HIDE_MS - 1)).toBe(true);
  });

  it("goes inactive once all languages are idle past HUD_IDLE_HIDE_MS", () => {
    const store = createActivityStore();
    const now = Date.now();
    recordCheck(store, {
      language: "apex",
      filePath: "/p/Foo.cls",
      startedAt: now,
      finishedAt: now,
      diagnostics: [],
      previousFileStatus: undefined,
    });
    expect(isLspHudActive(store, now + HUD_IDLE_HIDE_MS + 1)).toBe(false);
  });
});
