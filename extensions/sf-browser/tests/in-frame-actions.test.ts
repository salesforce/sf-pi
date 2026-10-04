/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for internal iframe-context action recovery planning. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { runAgentBrowser } from "../lib/agent-browser.ts";
import {
  expandMissingIframeSnapshots,
  findInFrameRetryPlan,
  readRememberedFrameUrl,
} from "../lib/in-frame-actions.ts";

vi.mock("../lib/agent-browser.ts", () => ({
  runAgentBrowser: vi.fn(),
}));

const SNAPSHOT = `- heading "Salesforce login" [level=1, ref=e2]
- button "Top action" [ref=e3]
- Iframe "Classic Setup" [ref=e4] focusable [tabindex]
  - textbox "Domain" [ref=e5]
  - button "Check Availability" [ref=e6]
  - group "Nested"
    - button "Save" [ref=e7]
- button "Footer" [ref=e8]`;

describe("in-frame action planning", () => {
  it("finds the nearest iframe ancestor for a nested target ref", () => {
    expect(findInFrameRetryPlan(SNAPSHOT, "@e6")).toEqual({
      iframeRef: "@e4",
      targetRef: "@e6",
    });
  });

  it("handles deeper nested target refs inside an iframe", () => {
    expect(findInFrameRetryPlan(SNAPSHOT, "e7")).toEqual({
      iframeRef: "@e4",
      targetRef: "@e7",
    });
  });

  it("does not plan frame retry for top-document refs", () => {
    expect(findInFrameRetryPlan(SNAPSHOT, "@e3")).toBeUndefined();
    expect(findInFrameRetryPlan(SNAPSHOT, "@e8")).toBeUndefined();
  });

  it("does not treat the iframe host itself as an in-frame target", () => {
    expect(findInFrameRetryPlan(SNAPSHOT, "@e4")).toBeUndefined();
  });

  it("returns undefined for missing or invalid target refs", () => {
    expect(findInFrameRetryPlan(SNAPSHOT, "@e99")).toBeUndefined();
    expect(findInFrameRetryPlan(SNAPSHOT, undefined)).toBeUndefined();
  });

  it("scopes into an iframe when agent-browser did not inline its controls", async () => {
    vi.mocked(runAgentBrowser).mockReset();
    vi.mocked(runAgentBrowser)
      .mockResolvedValueOnce({
        stdout: "https://example.my.salesforce.com/setup/classic",
        stderr: "",
        code: 0,
        durationMs: 1,
        durationText: "1ms",
      })
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        code: 0,
        durationMs: 1,
        durationText: "1ms",
      })
      .mockResolvedValueOnce({
        stdout: '- checkbox "Disable timeout warning" [checked=false, ref=e10]',
        stderr: "",
        code: 0,
        durationMs: 1,
        durationText: "1ms",
      })
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        code: 0,
        durationMs: 1,
        durationText: "1ms",
      });

    const result = await expandMissingIframeSnapshots(
      {} as ExtensionAPI,
      {
        cwd: "/project",
        snapshot: '- heading "Session Settings" [ref=e1]\n- Iframe "accessibility title" [ref=e2]',
        sessionId: "frame-expansion-test",
      },
      undefined,
    );

    expect(result.expandedFrameRefs).toEqual(["e2"]);
    expect(readRememberedFrameUrl("frame-expansion-test", "@e2")).toBe(
      "https://example.my.salesforce.com/setup/classic",
    );
    expect(result.snapshot).toContain(
      '  - checkbox "Disable timeout warning" [checked=false, ref=e10]',
    );
    expect(runAgentBrowser).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      ["get", "attr", "@e2", "src"],
      expect.objectContaining({ cwd: "/project" }),
    );
    expect(runAgentBrowser).toHaveBeenNthCalledWith(
      4,
      expect.anything(),
      ["frame", "main"],
      expect.objectContaining({ cwd: "/project" }),
    );
  });
});
