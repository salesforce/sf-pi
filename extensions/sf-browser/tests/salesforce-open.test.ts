/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveVerifiedRoutePathMock } = vi.hoisted(() => ({
  resolveVerifiedRoutePathMock: vi.fn(),
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

beforeEach(() => resolveVerifiedRoutePathMock.mockReset());

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
      expect(exec).toHaveBeenCalledWith(
        "sf",
        ["org", "open", "--url-only", "--json", "-o", "ExampleDev", "--path", expectedPath],
        expect.objectContaining({ cwd: "/workspace" }),
      );
      expect(result).toMatchObject({
        targetOrg: "ExampleDev",
        path: expectedPath,
        verifiedRoute: undefined,
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
      });
    },
  );
});
