/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for recommendations state I/O.
 *
 * Covers: readRecommendationsState, writeRecommendationsState,
 *         recordDecision, acknowledgeRevision
 *
 * State file is machine-managed bookkeeping, so the contract is:
 *   - missing/invalid file \u2192 empty state, never throw
 *   - writes are idempotent and additive
 *   - decisions are sticky across writes
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  acknowledgeRevision,
  readRecommendationsState,
  recordDecision,
  writeRecommendationsState,
} from "../lib/recommendations-state.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sf-pi-rec-state-"));
  file = path.join(dir, "recommendations.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readRecommendationsState", () => {
  it("returns empty state when file is missing", () => {
    const state = readRecommendationsState(file);
    expect(state.acknowledgedRevision).toBe("");
    expect(state.decisions).toEqual({});
  });

  it("returns empty state when file is invalid JSON", () => {
    writeFileSync(file, "not-json", "utf8");
    const state = readRecommendationsState(file);
    expect(state.acknowledgedRevision).toBe("");
    expect(state.decisions).toEqual({});
  });

  it("ignores unknown decision values", () => {
    writeFileSync(
      file,
      JSON.stringify({
        acknowledgedRevision: "r1",
        decisions: { known: "installed", bad: "maybe" },
      }),
      "utf8",
    );
    const state = readRecommendationsState(file);
    expect(state.acknowledgedRevision).toBe("r1");
    expect(state.decisions).toEqual({ known: "installed" });
  });
});

describe("writeRecommendationsState", () => {
  it("creates parent directories", () => {
    const nested = path.join(dir, "a", "b", "recommendations.json");
    writeRecommendationsState({ acknowledgedRevision: "r1", decisions: { x: "declined" } }, nested);
    const state = readRecommendationsState(nested);
    expect(state.acknowledgedRevision).toBe("r1");
    expect(state.decisions.x).toBe("declined");
  });
});

describe("recordDecision", () => {
  it("merges new decisions without clobbering existing ones", () => {
    recordDecision("a", "installed", file);
    recordDecision("b", "declined", file);
    const state = readRecommendationsState(file);
    expect(state.decisions).toEqual({ a: "installed", b: "declined" });
  });

  it("overwrites an existing decision for the same id", () => {
    recordDecision("a", "declined", file);
    recordDecision("a", "installed", file);
    const state = readRecommendationsState(file);
    expect(state.decisions.a).toBe("installed");
  });
});

describe("acknowledgeRevision", () => {
  it("updates the revision without touching decisions", () => {
    recordDecision("a", "installed", file);
    acknowledgeRevision("2026-05-01", file);
    const state = readRecommendationsState(file);
    expect(state.acknowledgedRevision).toBe("2026-05-01");
    expect(state.decisions.a).toBe("installed");
  });
});
