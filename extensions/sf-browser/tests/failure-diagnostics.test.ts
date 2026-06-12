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

  it("classifies covered Salesforce UI layers before generic element failures", () => {
    expect(classifyBrowserFailure("Element is covered by <force-aloha-page>")).toBe(
      "covered-element",
    );
    expect(classifyBrowserFailure("element receives events but has a covering element")).toBe(
      "covered-element",
    );
  });

  it("classifies browser launch failures after missing agent-browser checks", () => {
    expect(classifyBrowserFailure("spawn agent-browser ENOENT")).toBe("agent-browser-missing");
    expect(classifyBrowserFailure("Chrome exited early without writing DevToolsActivePort")).toBe(
      "browser-launch",
    );
    expect(classifyBrowserFailure("requires the chromium snap")).toBe("browser-launch");
    expect(classifyBrowserFailure("Failed to launch the browser process")).toBe("browser-launch");
    expect(classifyBrowserFailure("No usable sandbox")).toBe("browser-launch");
    expect(classifyBrowserFailure("cannot open display")).toBe("browser-launch");
  });

  it("returns recovery hints for known failure kinds", () => {
    expect(recoveryHint("stale-ref")).toContain("fresh ref");
    expect(recoveryHint("covered-element")).toContain("Classic Setup frame host");
    expect(recoveryHint("covered-element")).toContain("force-aloha-page");
    expect(recoveryHint("timeout")).toContain("timed out");
    expect(recoveryHint("agent-browser-missing")).toContain("/sf-browser doctor");
    expect(recoveryHint("browser-launch")).toContain("AGENT_BROWSER_EXECUTABLE_PATH");
    expect(recoveryHint("browser-launch")).toContain("AGENT_BROWSER_ARGS");
  });

  it("formats diagnostics with artifact paths without losing the original error", () => {
    const diagnostics: BrowserFailureDiagnostics = {
      kind: "stale-ref",
      recovery: recoveryHint("stale-ref"),
      originalError: "agent-browser failed with code 1. Element not found: @e42",
      currentUrl: "https://example.lightning.force.com/lightning/page/home",
      snapshotPath: "/tmp/snapshot.txt",
      screenshotPath: "/tmp/failure.png",
      screenshotThumbnailPath: "/tmp/failure.thumb.jpg",
    };

    const text = formatBrowserFailure(
      { toolName: "sf_browser_click", action: "click @e42", ref: "@e42", durationMs: 1234 },
      diagnostics,
    );

    expect(text).toContain("SF Browser action failed: stale-ref");
    expect(text).toContain("Attempted: click @e42");
    expect(text).toContain("Diagnostic snapshot: /tmp/snapshot.txt");
    expect(text).toContain("Diagnostic screenshot: /tmp/failure.png");
    expect(text).toContain("Diagnostic thumbnail: /tmp/failure.thumb.jpg");
    expect(text).toContain("Element not found: @e42");
  });
});
