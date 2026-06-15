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

  it("merges updates rather than overwriting unknown keys", () => {
    const dir = makeTempDir("welcome-state-");
    const path = join(dir, "state.json");
    // Pre-populate with a forward-compatible field that the store doesn't
    // know about, written in the legacy pre-envelope shape. A partial write
    // should preserve the unknown key rather than dropping it, even after
    // the store rewrites the file as a schema-versioned envelope.
    writeFileSync(
      path,
      JSON.stringify({ lastSeenPiVersion: "0.67.5", futureKey: "still here" }),
      "utf-8",
    );

    writeWelcomeState({ fontInstallDecision: "yes" }, path);
    const raw = JSON.parse(readFileSync(path, "utf-8")) as {
      schemaVersion?: number;
      state?: Record<string, unknown>;
    };
    expect(raw.schemaVersion).toBe(1);
    expect(raw.state?.lastSeenPiVersion).toBe("0.67.5");
    expect(raw.state?.fontInstallDecision).toBe("yes");
    expect(raw.state?.futureKey).toBe("still here");
    // The typed read should still return only the current known slice.
    expect(readWelcomeState(path)).toEqual({ fontInstallDecision: "yes" });
  });

  it("treats malformed JSON as an empty state", () => {
    const dir = makeTempDir("welcome-state-");
    const path = join(dir, "state.json");
    writeFileSync(path, "{not-json", "utf-8");
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
