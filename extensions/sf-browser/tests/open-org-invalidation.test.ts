/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Browser open-org snapshot invalidation. */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  findLatestBrowserSnapshotRefLookup,
  recordBrowserSessionTargetOrg,
  writeLatestBrowserSnapshotRefs,
} from "../../../lib/common/sf-browser-snapshot-state.ts";
import { openOrgInAgentBrowser } from "../lib/operations.ts";
import { runAgentBrowser } from "../lib/agent-browser.ts";

vi.mock("../lib/agent-browser.ts", () => ({
  runAgentBrowser: vi.fn(async () => ({ stdout: "", stderr: "", code: 0 })),
}));

const { resolveOpenOrgPlanMock, resolveOpenOrgUrlFromPlanMock } = vi.hoisted(() => ({
  resolveOpenOrgPlanMock: vi.fn(async (_pi, _ctx, input) => ({
    targetOrg: input.target_org ?? "DevSandbox",
    path:
      input.target?.type === "path"
        ? input.target.path
        : (input.path ?? "/lightning/setup/SetupOneHome/home"),
  })),
  resolveOpenOrgUrlFromPlanMock: vi.fn(async (_pi, _ctx, plan) => ({
    ...plan,
    url: "https://example.my.salesforce.com/secur/frontdoor.jsp?sid=REDACTED",
    openMethod: "in-process-singleaccess",
  })),
}));

vi.mock("../lib/salesforce-open.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/salesforce-open.ts")>();
  return {
    ...actual,
    resolveOpenOrgPlan: resolveOpenOrgPlanMock,
    resolveOpenOrgUrlFromPlan: resolveOpenOrgUrlFromPlanMock,
  };
});

function freshSessionId(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

describe("openOrgInAgentBrowser", () => {
  beforeEach(() => {
    vi.mocked(runAgentBrowser).mockReset();
    vi.mocked(runAgentBrowser).mockResolvedValue({
      stdout: "",
      stderr: "",
      code: 0,
      durationMs: 1,
      durationText: "1ms",
    });
    resolveOpenOrgPlanMock.mockClear();
    resolveOpenOrgUrlFromPlanMock.mockClear();
  });

  it("reuses the authenticated host for same-org navigation without generating a frontdoor URL", async () => {
    vi.mocked(runAgentBrowser).mockReset();
    resolveOpenOrgPlanMock.mockClear();
    resolveOpenOrgUrlFromPlanMock.mockClear();
    const sessionId = freshSessionId("sf-browser-same-org-direct-test");
    recordBrowserSessionTargetOrg(sessionId, "DevSandbox");
    let urlReads = 0;
    vi.mocked(runAgentBrowser).mockImplementation(async (_pi, args) => {
      if (args[0] === "get" && args[1] === "url") {
        urlReads += 1;
        return {
          stdout:
            urlReads === 1
              ? "https://example.my.salesforce-setup.com/lightning/setup/SetupOneHome/home"
              : "https://example.my.salesforce-setup.com/lightning/setup/PermSets/home",
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
        sessionManager: { getSessionId: () => sessionId },
      } as unknown as ExtensionContext,
      {
        target_org: "DevSandbox",
        target: { type: "path", path: "/lightning/setup/PermSets/home" },
      },
      undefined,
    );

    expect(resolveOpenOrgUrlFromPlanMock).not.toHaveBeenCalled();
    expect(runAgentBrowser).toHaveBeenCalledWith(
      expect.anything(),
      ["open", "https://example.my.salesforce-setup.com/lightning/setup/PermSets/home"],
      expect.objectContaining({ cwd: "/project" }),
    );
    expect(result.details.openMethod).toBe("same-org-direct");
  });

  it("invalidates cached snapshot refs before navigating", async () => {
    vi.mocked(runAgentBrowser).mockClear();
    const sessionId = freshSessionId("sf-browser-open-org-invalidation-test");
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

  it("reopens the target org once when the shared browser drifts to another Salesforce org", async () => {
    vi.mocked(runAgentBrowser).mockReset();
    let urlReads = 0;
    vi.mocked(runAgentBrowser).mockImplementation(async (_pi, args) => {
      if (args[0] === "get" && args[1] === "url") {
        urlReads += 1;
        return {
          stdout:
            urlReads === 1
              ? "https://other-org.my.salesforce-setup.com/lightning/setup/PermSetGroups/home"
              : "https://example.my.salesforce-setup.com/lightning/setup/SetupOneHome/home",
          stderr: "",
          code: 0,
          durationMs: 1,
          durationText: "1ms",
        };
      }
      return { stdout: "", stderr: "", code: 0, durationMs: 1, durationText: "1ms" };
    });

    const sessionId = freshSessionId("sf-browser-org-correction-test");
    const result = await openOrgInAgentBrowser(
      {} as ExtensionAPI,
      {
        cwd: "/project",
        sessionManager: { getSessionId: () => sessionId },
      } as unknown as ExtensionContext,
      { target: { type: "setup", destination: "setup-home" } },
      undefined,
    );

    expect(runAgentBrowser).toHaveBeenCalledTimes(4);
    expect(runAgentBrowser).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      ["open", "https://example.my.salesforce.com/secur/frontdoor.jsp?sid=REDACTED"],
      expect.objectContaining({ cwd: "/project" }),
    );
    expect(result.text).toContain("Post-login org correction: applied");
    expect(result.details.orgCorrectionApplied).toBe(true);
  });

  it("preserves query parameters during one same-org path correction", async () => {
    vi.mocked(runAgentBrowser).mockReset();
    let urlReads = 0;
    vi.mocked(runAgentBrowser).mockImplementation(async (_pi, args) => {
      if (args[0] === "get" && args[1] === "url") {
        urlReads += 1;
        return {
          stdout:
            urlReads <= 2
              ? "https://example.lightning.force.com/lightning/page/home"
              : "https://example.lightning.force.com/lightning/o/Account/list",
          stderr: "",
          code: 0,
          durationMs: 1,
          durationText: "1ms",
        };
      }
      return { stdout: "", stderr: "", code: 0, durationMs: 1, durationText: "1ms" };
    });

    const sessionId = freshSessionId("sf-browser-query-correction-test");
    const result = await openOrgInAgentBrowser(
      {} as ExtensionAPI,
      {
        cwd: "/project",
        sessionManager: { getSessionId: () => sessionId },
      } as unknown as ExtensionContext,
      {
        target: {
          type: "path",
          path: "/lightning/o/Account/list?filterName=__Recent",
        },
      },
      undefined,
    );

    expect(runAgentBrowser).toHaveBeenCalledWith(
      expect.anything(),
      ["open", "https://example.lightning.force.com/lightning/o/Account/list?filterName=__Recent"],
      expect.objectContaining({ cwd: "/project" }),
    );
    expect(result.details.pathCorrectionApplied).toBe(true);
  });

  it("corrects the path once when Salesforce frontdoor ignores the requested start URL", async () => {
    vi.mocked(runAgentBrowser).mockReset();
    let urlReads = 0;
    vi.mocked(runAgentBrowser).mockImplementation(async (_pi, args) => {
      if (args[0] === "get" && args[1] === "url") {
        urlReads += 1;
        return {
          stdout:
            urlReads <= 2
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

    const sessionId = freshSessionId("sf-browser-path-correction-test");
    const result = await openOrgInAgentBrowser(
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
      ["open", "https://example.lightning.force.com/lightning/setup/SetupOneHome/home"],
      expect.objectContaining({ cwd: "/project" }),
    );
    expect(result.text).toContain("Post-login path correction: applied");
    expect(result.details.navigationCorrectionApplied).toBe(true);
  });
});
