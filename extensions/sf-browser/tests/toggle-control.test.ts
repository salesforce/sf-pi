/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentBrowser } from "../lib/agent-browser.ts";
import {
  buildSameOriginToggleExpression,
  findToggleInSnapshot,
  setToggleState,
  toggleStateFromSnapshotLine,
} from "../lib/toggle-control.ts";

vi.mock("../lib/agent-browser.ts", () => ({
  runAgentBrowser: vi.fn(),
}));

beforeEach(() => vi.mocked(runAgentBrowser).mockReset());

describe("toggle controls", () => {
  it("reads explicit checked state and finds controls by accessible label", () => {
    expect(
      toggleStateFromSnapshotLine('- checkbox "Disable timeout warning" [checked=false, ref=e10]'),
    ).toBe(false);
    expect(toggleStateFromSnapshotLine('- switch "Agentforce" [checked=true, ref=e11]')).toBe(true);
    expect(
      findToggleInSnapshot(
        [
          '- checkbox "Disable timeout warning" [checked=true, ref=e10]',
          '- button "Save" [ref=e12]',
        ].join("\n"),
        "Disable timeout warning",
      ),
    ).toMatchObject({ checked: true, ref: "e10", role: "checkbox" });
  });

  it("builds a bounded same-origin iframe expression using the exact accessible label", () => {
    const expression = buildSameOriginToggleExpression("Disable timeout warning", true);

    expect(expression).toContain("contentDocument");
    expect(expression).toContain(JSON.stringify("Disable timeout warning"));
    expect(expression).toContain("const desired = true");
    expect(expression).toContain("aria-checked");
  });

  it("uses focus plus Space for Classic refs that cannot receive pointer clicks", async () => {
    vi.mocked(runAgentBrowser)
      .mockResolvedValueOnce({
        stdout: "",
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
        stdout: '- checkbox "Disable timeout warning" [checked=true, ref=e10]',
        stderr: "",
        code: 0,
        durationMs: 1,
        durationText: "1ms",
      });

    const result = await setToggleState(
      {} as ExtensionAPI,
      {
        cwd: "/project",
        ref: "e10",
        role: "checkbox",
        label: "Disable timeout warning",
        desiredState: true,
        frameRef: "@e2",
      },
      undefined,
    );

    expect(result).toMatchObject({ ok: true, recoveredClassicSetup: true, after: true });
    expect(runAgentBrowser).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      ["focus", "e10"],
      expect.objectContaining({ cwd: "/project" }),
    );
    expect(runAgentBrowser).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      ["press", "Space"],
      expect.objectContaining({ cwd: "/project" }),
    );
  });

  it("promotes a discovered Classic iframe when keyboard interaction is unavailable", async () => {
    vi.mocked(runAgentBrowser)
      .mockRejectedValueOnce(new Error("Focus failed"))
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
      })
      .mockResolvedValueOnce({
        stdout: '- checkbox "Disable timeout warning" [checked=true, ref=e10]',
        stderr: "",
        code: 0,
        durationMs: 1,
        durationText: "1ms",
      });

    const result = await setToggleState(
      {} as ExtensionAPI,
      {
        cwd: "/project",
        ref: "e10",
        role: "checkbox",
        label: "Disable timeout warning",
        desiredState: true,
        frameRef: "@e2",
        frameUrl: "https://example.my.salesforce.com/setup/session/SessionSettingsPage",
      },
      undefined,
    );

    expect(result).toMatchObject({ ok: true, recoveredClassicSetup: true, after: true });
    expect(runAgentBrowser).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      ["open", "https://example.my.salesforce.com/setup/session/SessionSettingsPage"],
      expect.objectContaining({ cwd: "/project" }),
    );
    expect(runAgentBrowser).toHaveBeenNthCalledWith(
      4,
      expect.anything(),
      ["check", "e10"],
      expect.objectContaining({ cwd: "/project" }),
    );
  });

  it("falls back to the same-origin Classic Setup adapter after a covered-element failure", async () => {
    vi.mocked(runAgentBrowser)
      .mockRejectedValueOnce(new Error("Element is covered by <force-aloha-page>"))
      .mockResolvedValueOnce({
        stdout: JSON.stringify(
          JSON.stringify({ found: true, before: false, after: true, changed: true, frame: true }),
        ),
        stderr: "",
        code: 0,
        durationMs: 1,
        durationText: "1ms",
      });

    const result = await setToggleState(
      {} as ExtensionAPI,
      {
        cwd: "/project",
        ref: "e10",
        role: "checkbox",
        label: "Disable timeout warning",
        desiredState: true,
      },
      undefined,
    );

    expect(result).toMatchObject({ ok: true, recoveredClassicSetup: true, after: true });
    expect(runAgentBrowser).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      ["check", "e10"],
      expect.objectContaining({ cwd: "/project" }),
    );
    expect(runAgentBrowser).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      ["eval", expect.stringContaining("contentDocument")],
      expect.objectContaining({ cwd: "/project" }),
    );
  });
});
