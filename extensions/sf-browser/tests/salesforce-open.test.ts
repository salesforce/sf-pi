/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateSalesforceFrontdoorUrlMock, resolveVerifiedRoutePathMock } = vi.hoisted(() => ({
  generateSalesforceFrontdoorUrlMock: vi.fn(),
  resolveVerifiedRoutePathMock: vi.fn(),
}));

vi.mock("../../../lib/common/sf-conn/index.ts", () => ({
  generateSalesforceFrontdoorUrl: generateSalesforceFrontdoorUrlMock,
}));

vi.mock("../lib/salesforce-route-verifier.ts", () => ({
  resolveVerifiedRoutePath: resolveVerifiedRoutePathMock,
}));

import { resolveOpenOrgUrl } from "../lib/salesforce-open.ts";
import type { SalesforceNavigationTarget } from "../lib/salesforce-path-resolver.ts";

function harness() {
  const exec = vi.fn().mockResolvedValue({
    code: 0,
    stdout: JSON.stringify({ result: { url: "https://example.my.salesforce.com/frontdoor" } }),
    stderr: "",
  });
  return {
    pi: { exec } as unknown as ExtensionAPI,
    ctx: { cwd: "/workspace" } as ExtensionContext,
    exec,
  };
}

beforeEach(() => {
  resolveVerifiedRoutePathMock.mockReset();
  generateSalesforceFrontdoorUrlMock.mockReset();
  generateSalesforceFrontdoorUrlMock.mockResolvedValue(
    "https://example.my.salesforce.com/secur/frontdoor.jsp?sid=single-use",
  );
});

describe("Salesforce org open route resolution", () => {
  it.each([
    [{ type: "home" }, "/lightning/page/home"],
    [{ type: "setup", destination: "setup-home" }, "/lightning/setup/SetupOneHome/home"],
    [{ type: "data-cloud", destination: "setup-home" }, "/lightning/setup/CDPSetupHome/home"],
    [{ type: "object-list", objectApiName: "Account" }, "/lightning/o/Account/list"],
    [{ type: "object-new", objectApiName: "Account" }, "/lightning/o/Account/new"],
    [
      { type: "record-view", objectApiName: "Account", recordId: "001000000000001AAA" },
      "/lightning/r/Account/001000000000001AAA/view",
    ],
  ] as Array<[SalesforceNavigationTarget, string]>)(
    "resolves local target %j without Salesforce API discovery",
    async (target, expectedPath) => {
      const { pi, ctx, exec } = harness();
      resolveVerifiedRoutePathMock.mockResolvedValue({
        path: "/unexpected-live-verification",
      });

      const result = await resolveOpenOrgUrl(pi, ctx, {
        target_org: "ExampleDev",
        target,
      });

      expect(resolveVerifiedRoutePathMock).not.toHaveBeenCalled();
      expect(generateSalesforceFrontdoorUrlMock).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: "/workspace",
          targetOrg: "ExampleDev",
          path: expectedPath,
          signal: undefined,
        }),
      );
      expect(exec).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        targetOrg: "ExampleDev",
        path: expectedPath,
        verifiedRoute: undefined,
        openMethod: "in-process-singleaccess",
      });
    },
  );

  it.each([
    { type: "external-client-app", appName: "ExampleEca" },
    { type: "list-view", objectApiName: "Account", filterName: "AllAccounts" },
    {
      type: "record-related-list",
      objectApiName: "Account",
      recordId: "001000000000001AAA",
      relatedListApiName: "Contacts",
    },
  ] as SalesforceNavigationTarget[])(
    "uses Salesforce verification when target %j needs exact org resolution",
    async (target) => {
      const { pi, ctx } = harness();
      resolveVerifiedRoutePathMock.mockResolvedValue({
        path: "/lightning/verified/path",
      });

      const result = await resolveOpenOrgUrl(pi, ctx, {
        target_org: "ExampleDev",
        target,
      });

      expect(resolveVerifiedRoutePathMock).toHaveBeenCalledWith("ExampleDev", target, "/workspace");
      expect(result).toMatchObject({
        path: "/lightning/verified/path",
        verifiedRoute: { path: "/lightning/verified/path" },
        openMethod: "in-process-singleaccess",
      });
    },
  );

  it("falls back to sf org open only when in-process single-access generation fails", async () => {
    const { pi, ctx, exec } = harness();
    generateSalesforceFrontdoorUrlMock.mockRejectedValue(
      new Error("Salesforce single-access URL request failed with HTTP 503."),
    );

    const result = await resolveOpenOrgUrl(pi, ctx, {
      target_org: "ExampleDev",
      target: { type: "setup", destination: "setup-home" },
    });

    expect(exec).toHaveBeenCalledWith(
      "sf",
      [
        "org",
        "open",
        "--url-only",
        "--json",
        "-o",
        "ExampleDev",
        "--path",
        "/lightning/setup/SetupOneHome/home",
      ],
      expect.objectContaining({ cwd: "/workspace" }),
    );
    expect(result.openMethod).toBe("sf-cli-fallback");
    expect(result.fallbackReason).toContain("HTTP 503");
  });

  it("keeps sf org open fallback failures concise and omits CLI stack traces", async () => {
    const { pi, ctx, exec } = harness();
    generateSalesforceFrontdoorUrlMock.mockRejectedValue(new Error("singleaccess unavailable"));
    exec.mockResolvedValue({
      code: 2,
      stdout: JSON.stringify({
        name: "NamedOrgNotFoundError",
        message: "No authorization information found for MissingOrg.",
        actions: ["Check the alias and authenticate the org."],
        stack: "private stack trace",
      }),
      stderr: "",
    });

    await expect(
      resolveOpenOrgUrl(pi, ctx, {
        target_org: "MissingOrg",
        target: { type: "setup", destination: "setup-home" },
      }),
    ).rejects.toSatisfy((error: Error) => {
      expect(error.message).toContain("No authorization information found for MissingOrg");
      expect(error.message).toContain("Check the alias");
      expect(error.message).not.toContain("private stack trace");
      return true;
    });
  });
});
