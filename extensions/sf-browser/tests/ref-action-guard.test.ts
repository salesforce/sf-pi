/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { registerSfBrowserClickTool } from "../lib/sf_browser_click-tool.ts";
import { runAgentBrowser } from "../lib/agent-browser.ts";

vi.mock("../lib/agent-browser.ts", () => ({
  runAgentBrowser: vi.fn(),
}));

it("rejects an unpublished ref before invoking agent-browser", async () => {
  const registerTool = vi.fn();
  registerSfBrowserClickTool({ registerTool } as unknown as ExtensionAPI);
  const tool = registerTool.mock.calls[0]![0];

  await expect(
    tool.execute("call-1", { ref: "e42", mutation: false }, undefined, undefined, {
      cwd: "/workspace",
      sessionManager: { getSessionId: () => "missing-ref-action-session" },
    }),
  ).rejects.toThrow(/no current sf_browser_snapshot/i);
  expect(runAgentBrowser).not.toHaveBeenCalled();
});
