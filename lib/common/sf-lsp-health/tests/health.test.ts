/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the shared sf-lsp health registry.
 *
 * The module is a process-scoped singleton so each test resets it before
 * running — mirrors how the other shared caches in `lib/common` are tested.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSfLspHealth,
  onSfLspHealthChange,
  resetSfLspHealth,
  setSfLspHealthFromDoctor,
  setSfLspLanguageHealth,
} from "../index.ts";

beforeEach(() => {
  resetSfLspHealth();
});

afterEach(() => {
  resetSfLspHealth();
});

describe("sf-lsp-health registry", () => {
  it("starts with all languages unknown", () => {
    const snap = getSfLspHealth();
    expect(snap.byLanguage.apex.health).toBe("unknown");
    expect(snap.byLanguage.lwc.health).toBe("unknown");
    expect(snap.byLanguage.agentscript.health).toBe("unknown");
  });

  it("setSfLspLanguageHealth flips a single language", () => {
    setSfLspLanguageHealth("apex", "available");
    const snap = getSfLspHealth();
    expect(snap.byLanguage.apex.health).toBe("available");
    expect(snap.byLanguage.lwc.health).toBe("unknown");
  });

  it("setSfLspLanguageHealth is a no-op when value and detail are unchanged", () => {
    const listener = vi.fn();
    setSfLspLanguageHealth("apex", "unavailable", "missing jar");
    onSfLspHealthChange(listener);
    setSfLspLanguageHealth("apex", "unavailable", "missing jar");
    expect(listener).not.toHaveBeenCalled();
  });

  it("setSfLspHealthFromDoctor bulk-updates from doctor statuses", () => {
    setSfLspHealthFromDoctor([
      { language: "apex", available: true, detail: "/path/to/apex.jar" },
      { language: "lwc", available: false, detail: "not found" },
      { language: "agentscript", available: true, detail: "/path/to/server.mjs" },
    ]);
    const snap = getSfLspHealth();
    expect(snap.byLanguage.apex.health).toBe("available");
    expect(snap.byLanguage.apex.detail).toBeUndefined();
    expect(snap.byLanguage.lwc.health).toBe("unavailable");
    expect(snap.byLanguage.lwc.detail).toBe("not found");
    expect(snap.byLanguage.agentscript.health).toBe("available");
  });

  it("onSfLspHealthChange fires on mutations", () => {
    const listener = vi.fn();
    const off = onSfLspHealthChange(listener);
    setSfLspLanguageHealth("lwc", "available");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    setSfLspLanguageHealth("apex", "available");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("resetSfLspHealth clears all languages back to unknown", () => {
    setSfLspLanguageHealth("apex", "available");
    setSfLspLanguageHealth("lwc", "unavailable", "missing binary");
    resetSfLspHealth();
    const snap = getSfLspHealth();
    expect(snap.byLanguage.apex.health).toBe("unknown");
    expect(snap.byLanguage.lwc.health).toBe("unknown");
    expect(snap.byLanguage.lwc.detail).toBeUndefined();
  });

  it("bumps revision on every change", () => {
    const initial = getSfLspHealth().revision;
    setSfLspLanguageHealth("apex", "available");
    expect(getSfLspHealth().revision).toBe(initial + 1);
    setSfLspLanguageHealth("apex", "unavailable");
    expect(getSfLspHealth().revision).toBe(initial + 2);
  });
});
