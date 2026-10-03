/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Browser open-org snapshot invalidation. */
import { describe, expect, it, vi } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  findLatestBrowserSnapshotRefLookup,
  writeLatestBrowserSnapshotRefs,
} from "../../../lib/common/sf-browser-snapshot-state.ts";
import { openOrgInAgentBrowser } from "../lib/operations.ts";
import { runAgentBrowser } from "../lib/agent-browser.ts";

vi.mock("../lib/agent-browser.ts", () => ({
  runAgentBrowser: vi.fn(async () => ({ stdout: "", stderr: "", code: 0 })),
}));

vi.mock("../lib/salesforce-open.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/salesforce-open.ts")>();
  return {
    ...actual,
    resolveOpenOrgUrl: vi.fn(async () => ({
      url: "https://example.my.salesforce.com/secur/frontdoor.jsp?sid=REDACTED",
      targetOrg: "DevSandbox",
      path: "/lightning/setup/SetupOneHome/home",
    })),
  };
});

describe("openOrgInAgentBrowser", () => {
  it("invalidates cached snapshot refs before navigating", async () => {
    vi.mocked(runAgentBrowser).mockClear();
    const sessionId = "sf-browser-open-org-invalidation-test";
    writeLatestBrowserSnapshotRefs({
      sessionId,
      snapshot: '- button "Save" [ref=e7]',
      url: "https://example.my.salesforce.com/lightning/pageA",
    });
    expect(findLatestBrowserSnapshotRefLookup(sessionId, "@e7").status).toBe("fresh");

    await openOrgInAgentBrowser(
      {} as ExtensionAPI,
      {
        cwd: "/project",
        sessionManager: { getSessionId: () => sessionId },
      } as unknown as ExtensionContext,
      { path: "/lightning/setup/SetupOneHome/home" },
      undefined,
    );

    expect(runAgentBrowser).toHaveBeenCalledWith(
      expect.anything(),
      ["open", "https://example.my.salesforce.com/secur/frontdoor.jsp?sid=REDACTED"],
      expect.objectContaining({ cwd: "/project" }),
    );
    const lookup = findLatestBrowserSnapshotRefLookup(sessionId, "@e7");
    expect(lookup.status).toBe("stale");
    expect(lookup.session?.targetOrg).toBe("DevSandbox");
  });

  it("corrects the path once when Salesforce frontdoor ignores the requested start URL", async () => {
    vi.mocked(runAgentBrowser).mockReset();
    let urlReads = 0;
    vi.mocked(runAgentBrowser).mockImplementation(async (_pi, args) => {
      if (args[0] === "get" && args[1] === "url") {
        urlReads += 1;
        return {
          stdout:
            urlReads === 1
              ? "https://example.lightning.force.com/lightning/n/devedapp__Welcome"
              : "https://example.my.salesforce-setup.com/lightning/setup/SetupOneHome/home",
          stderr: "",
          code: 0,
          durationMs: 1,
          durationText: "1ms",
        };
      }
      return { stdout: "", stderr: "", code: 0, durationMs: 1, durationText: "1ms" };
    });

    const result = await openOrgInAgentBrowser(
      {} as ExtensionAPI,
      {
        cwd: "/project",
        sessionManager: { getSessionId: () => "sf-browser-path-correction-test" },
      } as unknown as ExtensionContext,
      { path: "/lightning/setup/SetupOneHome/home" },
      undefined,
    );

    expect(runAgentBrowser).toHaveBeenCalledWith(
      expect.anything(),
      ["open", "https://example.lightning.force.com/lightning/setup/SetupOneHome/home"],
      expect.objectContaining({ cwd: "/project" }),
    );
    expect(result.text).toContain("Post-login path correction: applied");
    expect(result.details.navigationCorrectionApplied).toBe(true);
  });
});
