/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the SF Browser agent-browser process adapter. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { runAgentBrowser } from "../lib/agent-browser.ts";

function fakePiExec(result: { stdout?: string; stderr?: string; code: number }): ExtensionAPI {
  return {
    exec: async () => result,
  } as unknown as ExtensionAPI;
}

describe("agent-browser process adapter", () => {
  it("adds browser launch recovery guidance for direct agent-browser failures", async () => {
    const pi = fakePiExec({
      stdout: "",
      stderr: "Chrome exited early without writing DevToolsActivePort",
      code: 1,
    });

    await expect(runAgentBrowser(pi, ["snapshot"], { cwd: "." })).rejects.toThrow(
      /AGENT_BROWSER_EXECUTABLE_PATH[\s\S]*AGENT_BROWSER_ARGS=--no-sandbox,--disable-dev-shm-usage[\s\S]*\/sf-browser doctor/,
    );
  });
});
