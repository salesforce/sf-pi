/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readLspInstallState,
  recordComponentDecision,
  writeLspInstallState,
} from "../lib/install/state.ts";

describe("lsp install state", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sf-lsp-state-"));
    file = join(dir, "sf-lsp-install-state.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty state when the file is missing", () => {
    const state = readLspInstallState(file);
    expect(state).toEqual({ decisions: {} });
  });

  it("round-trips an install decision", () => {
    recordComponentDecision(
      "apex",
      { action: "install", acceptedVersion: "58.13.1", at: "2026-05-01T00:00:00Z" },
      file,
    );
    const state = readLspInstallState(file);
    expect(state.decisions.apex).toEqual({
      action: "install",
      acceptedVersion: "58.13.1",
      at: "2026-05-01T00:00:00Z",
    });
  });

  it("round-trips a decline decision", () => {
    recordComponentDecision(
      "lwc",
      { action: "decline", declinedVersion: "4.12.3", at: "2026-05-01T00:00:00Z" },
      file,
    );
    const state = readLspInstallState(file);
    expect(state.decisions.lwc).toEqual({
      action: "decline",
      declinedVersion: "4.12.3",
      at: "2026-05-01T00:00:00Z",
    });
  });

  it("preserves unrelated decisions on partial write", () => {
    recordComponentDecision(
      "apex",
      { action: "install", acceptedVersion: "58.13.1", at: "2026-05-01T00:00:00Z" },
      file,
    );
    recordComponentDecision(
      "lwc",
      { action: "decline", declinedVersion: "4.12.3", at: "2026-05-02T00:00:00Z" },
      file,
    );
    const state = readLspInstallState(file);
    expect(state.decisions.apex?.action).toBe("install");
    expect(state.decisions.lwc?.action).toBe("decline");
  });

  it("ignores malformed decisions on read", () => {
    writeLspInstallState(
      {
        decisions: {
          // @ts-expect-error intentional bogus payload
          apex: { action: "bogus" },
        },
      },
      file,
    );
    const state = readLspInstallState(file);
    expect(state.decisions.apex).toBeUndefined();
  });
});
