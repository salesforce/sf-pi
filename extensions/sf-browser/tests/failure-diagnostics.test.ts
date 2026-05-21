/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Browser failure diagnostics. */
import { describe, expect, it } from "vitest";
import {
  classifyBrowserFailure,
  formatBrowserFailure,
  recoveryHint,
  type BrowserFailureDiagnostics,
} from "../lib/failure-diagnostics.ts";

describe("failure diagnostics", () => {
  it("classifies stale refs before generic element failures", () => {
    expect(classifyBrowserFailure("Element not found: @e42")).toBe("stale-ref");
    expect(classifyBrowserFailure("Reference not found for @e7 after rerender")).toBe("stale-ref");
  });

  it("classifies common browser failure kinds", () => {
    expect(classifyBrowserFailure("Timeout 25000ms exceeded")).toBe("timeout");
    expect(classifyBrowserFailure("execution context was destroyed during navigation")).toBe(
      "navigation",
    );
    expect(classifyBrowserFailure("spawn agent-browser ENOENT")).toBe("agent-browser-missing");
    expect(classifyBrowserFailure("button is not visible")).toBe("element-not-found");
  });

  it("returns recovery hints for known failure kinds", () => {
    expect(recoveryHint("stale-ref")).toContain("fresh ref");
    expect(recoveryHint("timeout")).toContain("timed out");
    expect(recoveryHint("agent-browser-missing")).toContain("/sf-browser doctor");
  });

  it("formats diagnostics with artifact paths without losing the original error", () => {
    const diagnostics: BrowserFailureDiagnostics = {
      kind: "stale-ref",
      recovery: recoveryHint("stale-ref"),
      originalError: "agent-browser failed with code 1. Element not found: @e42",
      currentUrl: "https://example.lightning.force.com/lightning/page/home",
      snapshotPath: "/tmp/snapshot.txt",
      screenshotPath: "/tmp/failure.png",
    };

    const text = formatBrowserFailure(
      { toolName: "sf_browser_click", action: "click @e42", ref: "@e42", durationMs: 1234 },
      diagnostics,
    );

    expect(text).toContain("SF Browser action failed: stale-ref");
    expect(text).toContain("Attempted: click @e42");
    expect(text).toContain("Diagnostic snapshot: /tmp/snapshot.txt");
    expect(text).toContain("Diagnostic screenshot: /tmp/failure.png");
    expect(text).toContain("Element not found: @e42");
  });
});
