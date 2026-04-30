/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the sf-welcome persistent state store.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readWelcomeState, writeWelcomeState } from "../lib/state-store.ts";

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

describe("state-store", () => {
  it("returns empty object when state file is missing", () => {
    const dir = makeTempDir("welcome-state-");
    const state = readWelcomeState(join(dir, "does-not-exist.json"));
    expect(state).toEqual({});
  });

  it("round-trips lastSeenPiVersion", () => {
    const dir = makeTempDir("welcome-state-");
    const path = join(dir, "state.json");
    writeWelcomeState({ lastSeenPiVersion: "0.68.0" }, path);
    expect(readWelcomeState(path)).toEqual({ lastSeenPiVersion: "0.68.0" });
  });

  it("merges updates rather than overwriting unknown keys", () => {
    const dir = makeTempDir("welcome-state-");
    const path = join(dir, "state.json");
    // Pre-populate with a forward-compatible field that the store doesn't
    // know about. A partial write should preserve it rather than dropping it.
    writeFileSync(
      path,
      JSON.stringify({ lastSeenPiVersion: "0.67.5", futureKey: "still here" }),
      "utf-8",
    );

    writeWelcomeState({ lastSeenPiVersion: "0.68.1" }, path);
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    expect(raw.lastSeenPiVersion).toBe("0.68.1");
    expect(raw.futureKey).toBe("still here");
    // The typed read should still return only the known slice.
    expect(readWelcomeState(path)).toEqual({ lastSeenPiVersion: "0.68.1" });
  });

  it("treats malformed JSON as an empty state", () => {
    const dir = makeTempDir("welcome-state-");
    const path = join(dir, "state.json");
    writeFileSync(path, "{not-json", "utf-8");
    expect(readWelcomeState(path)).toEqual({});
  });

  it("drops whitespace-only lastSeenPiVersion values on read", () => {
    const dir = makeTempDir("welcome-state-");
    const path = join(dir, "state.json");
    writeFileSync(path, JSON.stringify({ lastSeenPiVersion: "   " }), "utf-8");
    expect(readWelcomeState(path)).toEqual({});
  });

  it("round-trips the font install decision + prompted-at timestamp", () => {
    const dir = makeTempDir("welcome-state-");
    const path = join(dir, "state.json");
    writeWelcomeState(
      { fontInstallDecision: "yes", fontInstallPromptedAt: "2026-04-28T17:00:00Z" },
      path,
    );
    expect(readWelcomeState(path)).toEqual({
      fontInstallDecision: "yes",
      fontInstallPromptedAt: "2026-04-28T17:00:00Z",
    });
  });

  it("ignores unexpected fontInstallDecision values", () => {
    const dir = makeTempDir("welcome-state-");
    const path = join(dir, "state.json");
    writeFileSync(path, JSON.stringify({ fontInstallDecision: "maybe" }), "utf-8");
    expect(readWelcomeState(path)).toEqual({});
  });
});
