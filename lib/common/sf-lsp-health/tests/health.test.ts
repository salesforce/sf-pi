/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the shared sf-lsp health registry.
 *
 * Module is a process-scoped singleton so each test resets it before
 * running — mirrors how the other shared caches in `lib/common` are tested.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSfLspHealth,
  onSfLspHealthChange,
  resetSfLspHealth,
  setSfLspActivity,
  setSfLspAvailability,
  setSfLspHealthFromDoctor,
} from "../index.ts";

beforeEach(() => {
  resetSfLspHealth();
});

afterEach(() => {
  resetSfLspHealth();
});

describe("sf-lsp-health registry", () => {
  it("starts with all languages unknown and idle", () => {
    const snap = getSfLspHealth();
    for (const language of ["apex", "lwc", "agentscript"] as const) {
      expect(snap.byLanguage[language].availability).toBe("unknown");
      expect(snap.byLanguage[language].activity).toBe("idle");
    }
  });

  it("setSfLspAvailability flips a single language without touching activity", () => {
    setSfLspAvailability("apex", "available");
    const snap = getSfLspHealth();
    expect(snap.byLanguage.apex.availability).toBe("available");
    expect(snap.byLanguage.apex.activity).toBe("idle");
    expect(snap.byLanguage.lwc.availability).toBe("unknown");
  });

  it("setSfLspAvailability is a no-op when value and detail are unchanged", () => {
    const listener = vi.fn();
    setSfLspAvailability("apex", "unavailable", "missing jar");
    onSfLspHealthChange(listener);
    setSfLspAvailability("apex", "unavailable", "missing jar");
    expect(listener).not.toHaveBeenCalled();
  });

  it("setSfLspHealthFromDoctor bulk-updates availability", () => {
    setSfLspHealthFromDoctor([
      { language: "apex", available: true, detail: "/path" },
      { language: "lwc", available: false, detail: "not found" },
      { language: "agentscript", available: true, detail: "/path" },
    ]);
    const snap = getSfLspHealth();
    expect(snap.byLanguage.apex.availability).toBe("available");
    expect(snap.byLanguage.apex.unavailableDetail).toBeUndefined();
    expect(snap.byLanguage.lwc.availability).toBe("unavailable");
    expect(snap.byLanguage.lwc.unavailableDetail).toBe("not found");
    expect(snap.byLanguage.agentscript.availability).toBe("available");
  });

  it("setSfLspActivity records checking → clean → error progression", () => {
    setSfLspActivity("apex", "checking", { fileName: "Foo.cls" });
    expect(getSfLspHealth().byLanguage.apex.activity).toBe("checking");
    expect(getSfLspHealth().byLanguage.apex.lastFileName).toBe("Foo.cls");

    setSfLspActivity("apex", "clean", { fileName: "Foo.cls" });
    expect(getSfLspHealth().byLanguage.apex.activity).toBe("clean");
    expect(getSfLspHealth().byLanguage.apex.lastErrorCount).toBeUndefined();

    setSfLspActivity("apex", "error", { fileName: "Foo.cls", errorCount: 3 });
    expect(getSfLspHealth().byLanguage.apex.activity).toBe("error");
    expect(getSfLspHealth().byLanguage.apex.lastErrorCount).toBe(3);
  });

  it("availability and activity evolve independently", () => {
    setSfLspAvailability("apex", "available");
    setSfLspActivity("apex", "checking", { fileName: "Foo.cls" });
    // Changing availability later should not wipe activity.
    setSfLspAvailability("apex", "available", "noop");
    expect(getSfLspHealth().byLanguage.apex.activity).toBe("checking");
  });

  it("onSfLspHealthChange fires on mutations", () => {
    const listener = vi.fn();
    const off = onSfLspHealthChange(listener);
    setSfLspAvailability("lwc", "available");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    setSfLspAvailability("apex", "available");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("resetSfLspHealth returns every language to zero state", () => {
    setSfLspAvailability("apex", "available");
    setSfLspActivity("apex", "error", { fileName: "Foo.cls", errorCount: 2 });
    resetSfLspHealth();
    const snap = getSfLspHealth();
    expect(snap.byLanguage.apex.availability).toBe("unknown");
    expect(snap.byLanguage.apex.activity).toBe("idle");
    expect(snap.byLanguage.apex.lastErrorCount).toBeUndefined();
    expect(snap.byLanguage.apex.lastFileName).toBeUndefined();
  });

  it("bumps revision on every change", () => {
    const initial = getSfLspHealth().revision;
    setSfLspAvailability("apex", "available");
    expect(getSfLspHealth().revision).toBe(initial + 1);
    setSfLspActivity("apex", "checking", { fileName: "Foo.cls" });
    expect(getSfLspHealth().revision).toBe(initial + 2);
  });
});
