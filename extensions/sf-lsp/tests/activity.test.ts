/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pure state tests for the activity store.
 */
import { describe, it, expect } from "vitest";
import {
  createActivityStore,
  markChecking,
  recordCheck,
  resetActivityStore,
  seedFromDoctor,
  statusBadgeLabel,
  statusColor,
  statusGlyph,
  type LspCheckSample,
} from "../lib/activity.ts";
import type { LspDiagnostic, LspDoctorStatus } from "../lib/types.ts";

function errorDiag(line: number, message = "boom"): LspDiagnostic {
  return {
    severity: 1,
    message,
    range: {
      start: { line, character: 0 },
      end: { line, character: 5 },
    },
  };
}

describe("activity store", () => {
  it("starts empty", () => {
    const store = createActivityStore();
    expect(store.hasActivity).toBe(false);
    expect(store.byLanguage.size).toBe(0);
    expect(store.recent).toEqual([]);
  });

  it("marks checking without flipping hasActivity", () => {
    const store = createActivityStore();
    markChecking(store, "apex", "/p/Foo.cls", "Foo.cls");
    expect(store.byLanguage.get("apex")?.status).toBe("checking");
    expect(store.hasActivity).toBe(false);
  });

  it("records error and promotes next clean to transition-clean", () => {
    const store = createActivityStore();
    const now = 1_000_000;
    const baseSample: Omit<LspCheckSample, "diagnostics" | "previousFileStatus" | "unavailable"> = {
      language: "apex",
      filePath: "/p/Foo.cls",
      startedAt: now,
      finishedAt: now + 200,
    };

    recordCheck(store, {
      ...baseSample,
      diagnostics: [errorDiag(10)],
      previousFileStatus: undefined,
    });
    expect(store.byLanguage.get("apex")?.status).toBe("error");
    expect(store.byLanguage.get("apex")?.diagnosticCount).toBe(1);
    expect(store.hasActivity).toBe(true);

    recordCheck(store, {
      ...baseSample,
      diagnostics: [],
      previousFileStatus: "error",
    });
    expect(store.byLanguage.get("apex")?.status).toBe("transition-clean");
  });

  it("records clean with no previous error as plain clean", () => {
    const store = createActivityStore();
    recordCheck(store, {
      language: "lwc",
      filePath: "/p/lwc/c/c.js",
      startedAt: 0,
      finishedAt: 50,
      diagnostics: [],
      previousFileStatus: undefined,
    });
    expect(store.byLanguage.get("lwc")?.status).toBe("clean");
  });

  it("records unavailable with reason", () => {
    const store = createActivityStore();
    const unavailable: LspDoctorStatus = {
      language: "apex",
      available: false,
      detail: "Java not found",
    };
    recordCheck(store, {
      language: "apex",
      filePath: "/p/Foo.cls",
      startedAt: 0,
      finishedAt: 10,
      diagnostics: [],
      unavailable,
      previousFileStatus: undefined,
    });
    expect(store.byLanguage.get("apex")?.status).toBe("unavailable");
    expect(store.byLanguage.get("apex")?.unavailableReason).toBe("Java not found");
  });

  it("pushes recent records newest first and caps at the ring size", () => {
    const store = createActivityStore();
    for (let i = 0; i < 30; i++) {
      recordCheck(store, {
        language: "apex",
        filePath: `/p/Foo${i}.cls`,
        startedAt: i,
        finishedAt: i + 10,
        diagnostics: [],
        previousFileStatus: undefined,
      });
    }
    expect(store.recent.length).toBe(20);
    expect(store.recent[0]!.fileName).toBe("Foo29.cls");
  });

  it("seedFromDoctor flips unavailable languages", () => {
    const store = createActivityStore();
    seedFromDoctor(store, [
      { language: "apex", available: true, source: "vscode", detail: "/path" },
      { language: "lwc", available: false, detail: "missing" },
      { language: "agentscript", available: true, source: "pi-global", detail: "/x" },
    ]);
    expect(store.byLanguage.get("apex")?.status).toBe("idle");
    expect(store.byLanguage.get("apex")?.source).toBe("vscode");
    expect(store.byLanguage.get("lwc")?.status).toBe("unavailable");
    expect(store.byLanguage.get("lwc")?.unavailableReason).toBe("missing");
  });

  it("resetActivityStore clears everything", () => {
    const store = createActivityStore();
    recordCheck(store, {
      language: "apex",
      filePath: "/p/Foo.cls",
      startedAt: 0,
      finishedAt: 10,
      diagnostics: [errorDiag(1)],
      previousFileStatus: undefined,
    });
    resetActivityStore(store);
    expect(store.hasActivity).toBe(false);
    expect(store.byLanguage.size).toBe(0);
    expect(store.recent).toEqual([]);
  });
});

describe("status helpers", () => {
  it("maps glyphs / colors / labels", () => {
    expect(statusGlyph("error")).toBe("●");
    expect(statusGlyph("unavailable")).toBe("○");
    expect(statusGlyph("checking")).toBe("◐");

    expect(statusColor("error")).toBe("error");
    expect(statusColor("clean")).toBe("success");
    expect(statusColor("transition-clean")).toBe("success");
    expect(statusColor("unavailable")).toBe("warning");
    expect(statusColor("idle")).toBe("dim");

    expect(statusBadgeLabel("error")).toBe("err");
    expect(statusBadgeLabel("clean")).toBe("ok");
    expect(statusBadgeLabel("unavailable")).toBe("off");
  });
});
