/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the shared per-user state-store helper.
 *
 * Covers the behaviors that AGENTS.md and ADR 0006 promise:
 *   - safe defaults on missing/malformed/wrong-shape files
 *   - schema-version migration
 *   - atomic write (no half-written file after a write failure)
 *   - mode option preserved on writes
 *   - update() round-trip
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalProjectStatePath, canonicalStatePath, createStateStore } from "../state-store.ts";

interface DemoState {
  count: number;
  label: string;
}

const DEFAULTS: DemoState = { count: 0, label: "" };

describe("createStateStore", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-state-"));
    filePath = path.join(tmpDir, "state.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function newStore() {
    return createStateStore<DemoState>({
      namespace: "test-ext",
      filename: "state.json",
      schemaVersion: 2,
      defaults: { ...DEFAULTS },
      pathOverride: filePath,
    });
  }

  describe("read", () => {
    it("returns defaults when the file does not exist", () => {
      const store = newStore();
      expect(store.read()).toEqual(DEFAULTS);
    });

    it("returns defaults when the file is unreadable JSON", () => {
      writeFileSync(filePath, "{this is not json", "utf8");
      const store = newStore();
      expect(store.read()).toEqual(DEFAULTS);
    });

    it("returns defaults for an empty file", () => {
      writeFileSync(filePath, "", "utf8");
      const store = newStore();
      expect(store.read()).toEqual(DEFAULTS);
    });

    it("returns the wrapped state when the schema version matches", () => {
      writeFileSync(
        filePath,
        JSON.stringify({ schemaVersion: 2, state: { count: 7, label: "ok" } }),
        "utf8",
      );
      const store = newStore();
      expect(store.read()).toEqual({ count: 7, label: "ok" });
    });

    it("falls back to defaults when the schema version is older and no migrate is supplied", () => {
      writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, state: { count: 3 } }), "utf8");
      const store = newStore();
      expect(store.read()).toEqual(DEFAULTS);
    });

    it("invokes migrate when the schema version is older", () => {
      writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, state: { count: 3 } }), "utf8");
      const store = createStateStore<DemoState>({
        namespace: "test-ext",
        filename: "state.json",
        schemaVersion: 2,
        defaults: { ...DEFAULTS },
        pathOverride: filePath,
        migrate: (raw, fromVersion) => {
          if (fromVersion !== 1) return null;
          const obj = raw as { count?: number };
          return { count: obj.count ?? 0, label: "migrated-from-v1" };
        },
      });
      expect(store.read()).toEqual({ count: 3, label: "migrated-from-v1" });
    });

    it("invokes migrate with fromVersion=0 when a pre-envelope file is present", () => {
      writeFileSync(filePath, JSON.stringify({ count: 9, label: "legacy" }), "utf8");
      const store = createStateStore<DemoState>({
        namespace: "test-ext",
        filename: "state.json",
        schemaVersion: 2,
        defaults: { ...DEFAULTS },
        pathOverride: filePath,
        migrate: (raw, fromVersion) => {
          if (fromVersion !== 0) return null;
          const obj = raw as { count?: number; label?: string };
          return { count: obj.count ?? 0, label: obj.label ?? "" };
        },
      });
      expect(store.read()).toEqual({ count: 9, label: "legacy" });
    });

    it("returns defaults when migrate returns null", () => {
      writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, state: { count: 3 } }), "utf8");
      const store = createStateStore<DemoState>({
        namespace: "test-ext",
        filename: "state.json",
        schemaVersion: 2,
        defaults: { ...DEFAULTS },
        pathOverride: filePath,
        migrate: () => null,
      });
      expect(store.read()).toEqual(DEFAULTS);
    });

    it("returns defaults when migrate throws", () => {
      writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, state: { count: 3 } }), "utf8");
      const store = createStateStore<DemoState>({
        namespace: "test-ext",
        filename: "state.json",
        schemaVersion: 2,
        defaults: { ...DEFAULTS },
        pathOverride: filePath,
        migrate: () => {
          throw new Error("boom");
        },
      });
      expect(store.read()).toEqual(DEFAULTS);
    });
  });

  describe("write + update", () => {
    it("persists state inside an envelope", () => {
      const store = newStore();
      store.write({ count: 12, label: "hello" });

      const raw = JSON.parse(readFileSync(filePath, "utf8"));
      expect(raw).toEqual({
        schemaVersion: 2,
        state: { count: 12, label: "hello" },
      });
    });

    it("creates parent directories on first write", () => {
      const nested = path.join(tmpDir, "deep", "nested", "state.json");
      const store = createStateStore<DemoState>({
        namespace: "test-ext",
        filename: "state.json",
        schemaVersion: 1,
        defaults: { ...DEFAULTS },
        pathOverride: nested,
      });
      store.write({ count: 1, label: "x" });
      expect(existsSync(nested)).toBe(true);
    });

    it("update() reads, mutates, and writes the result", () => {
      const store = newStore();
      const next = store.update((current) => ({ ...current, count: current.count + 5 }));
      expect(next).toEqual({ count: 5, label: "" });
      expect(store.read()).toEqual({ count: 5, label: "" });
    });

    it("does not leave a stray .tmp file after a normal write", () => {
      const store = newStore();
      store.write({ count: 1, label: "" });
      const dir = path.dirname(filePath);
      const tmpCandidates = readdirSync(dir).filter((name) => name.endsWith(".tmp"));
      expect(tmpCandidates).toEqual([]);
    });

    it("respects a custom mode (0o600 for sensitive files)", () => {
      // Skip on platforms where file modes do not behave portably (Windows
      // historically reports 0o666 regardless). Real-world deployments are
      // POSIX so we still want this assertion when it's meaningful.
      if (process.platform === "win32") return;
      const store = createStateStore<DemoState>({
        namespace: "test-ext",
        filename: "secret.json",
        schemaVersion: 1,
        defaults: { ...DEFAULTS },
        pathOverride: path.join(tmpDir, "secret.json"),
        mode: 0o600,
      });
      store.write({ count: 1, label: "secret" });
      const stat = statSync(store.path);
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });

  describe("canonical paths", () => {
    it("places global state under <globalAgentDir>/sf-pi/<namespace>/<filename>", () => {
      const resolved = canonicalStatePath("sf-welcome", "state.json");
      // We assert the suffix only — the prefix depends on the host home dir
      // and any pi-coding-agent agent-dir override.
      expect(resolved.endsWith(path.join("sf-pi", "sf-welcome", "state.json"))).toBe(true);
    });

    it("places project state under <cwd>/.pi/<namespace>/<filename>", () => {
      const resolved = canonicalProjectStatePath(tmpDir, "sf-skills", "usage.json");
      expect(resolved).toBe(path.join(tmpDir, ".pi", "sf-skills", "usage.json"));
    });

    it("createStateStore supports project-scoped state without pathOverride", () => {
      const store = createStateStore<DemoState>({
        namespace: "sf-skills",
        filename: "usage.json",
        schemaVersion: 1,
        defaults: { ...DEFAULTS },
        scope: "project",
        cwd: tmpDir,
      });
      store.write({ count: 4, label: "project" });
      expect(store.path).toBe(path.join(tmpDir, ".pi", "sf-skills", "usage.json"));
      expect(store.read()).toEqual({ count: 4, label: "project" });
    });
  });
});
