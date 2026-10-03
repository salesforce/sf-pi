/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proof for automatic Ambient Overlay Dismissal before snapshots. */
import { describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const runAgentBrowserMock = vi.fn();
vi.mock("../lib/agent-browser.ts", () => ({
  runAgentBrowser: (...args: unknown[]) => runAgentBrowserMock(...args),
}));
vi.mock("../lib/settings.ts", () => ({
  readEffectiveSfBrowserSettings: () => ({
    evidenceImageMode: "thumbnail",
    dismissOverlays: true,
    includeSetupAuditTrail: false,
    source: "default",
  }),
}));

import { registerSfBrowserSnapshotTool } from "../lib/sf_browser_snapshot-tool.ts";

interface RegisteredSnapshotTool {
  execute(...args: unknown[]): Promise<unknown>;
}

interface SnapshotToolResult {
  content: Array<{ text?: string }>;
  details: {
    overlayDismissal?: {
      dismissedRefs: string[];
      snapshotChecked: boolean;
    };
  };
}

describe("sf_browser_snapshot overlay dismissal", () => {
  it("closes known ambient overlays before publishing snapshot refs", async () => {
    let snapshotCalls = 0;
    runAgentBrowserMock.mockImplementation(async (_pi, args: string[]) => {
      if (args[0] === "snapshot") {
        snapshotCalls += 1;
        if (snapshotCalls === 1) {
          return {
            stdout: [
              '- heading "My Service Journey" [level=2, ref=e16]',
              '- button "Minimize" [ref=e19]',
              '- button "Maximize" [ref=e20]',
              '- button "Close" [ref=e21]',
            ].join("\n"),
            stderr: "",
            code: 0,
          };
        }
        return {
          stdout: '- heading "External Client App Manager" [level=1, ref=e161]',
          stderr: "",
          code: 0,
        };
      }
      if (args[0] === "get" && args[1] === "url") {
        return {
          stdout:
            "https://example.develop.my.salesforce-setup.com/lightning/setup/ManageExternalClientApplication/home",
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    });

    let tool: RegisteredSnapshotTool | undefined;
    const pi = {
      registerTool: vi.fn((definition: unknown) => {
        tool = definition as RegisteredSnapshotTool;
      }),
    } as unknown as ExtensionAPI;
    registerSfBrowserSnapshotTool(pi);

    const result = (await tool?.execute("call-1", { outputMode: "summary" }, undefined, undefined, {
      cwd: "/project",
      sessionManager: { getSessionId: () => "snapshot-overlay-dismissal-test" },
    })) as SnapshotToolResult | undefined;

    expect(runAgentBrowserMock).toHaveBeenCalledWith(
      expect.anything(),
      ["click", "e21"],
      expect.objectContaining({ cwd: "/project" }),
    );
    expect(result?.details.overlayDismissal).toMatchObject({
      dismissedRefs: ["e21"],
      snapshotChecked: true,
    });
    expect(result?.content[0]?.text).toContain("Dismissed ambient overlays: e21");
  });
});
