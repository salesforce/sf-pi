/* SPDX-License-Identifier: Apache-2.0 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const orgCreateMock = vi.fn();

vi.mock("@salesforce/core", () => ({
  ConfigAggregator: { create: () => Promise.resolve({ getInfo: () => ({ value: undefined }) }) },
  Org: { create: (opts: unknown) => orgCreateMock(opts) },
}));

import {
  buildSfApiRequestArgs,
  responseLooksLikeError,
  resolveRequest,
  resolveRequestForExecution,
  type D360ApiInput,
} from "../lib/api-tool.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";

beforeEach(async () => {
  orgCreateMock.mockReset();
  const conn = await import("../../../lib/common/sf-conn/connection.ts");
  conn.clearConnectionCache();
});

function fakeOrg(opts: { authFields: Record<string, unknown>; apiVersion?: string }) {
  const conn = {
    getAuthInfoFields: () => opts.authFields,
    instanceUrl: (opts.authFields as { instanceUrl?: string }).instanceUrl ?? "",
    getApiVersion: () => opts.apiVersion ?? "66.0",
  };
  return { getConnection: () => conn };
}

const env: SfEnvironment = {
  cli: { installed: true, version: "2.132.14" },
  project: { detected: true, sourceApiVersion: "65.0" },
  config: { hasTargetOrg: true, targetOrg: "my-sandbox", location: "Global" },
  org: {
    detected: true,
    alias: "my-sandbox",
    username: "user@example.invalid",
    instanceUrl: "https://example.my.salesforce.com",
    orgType: "sandbox",
    apiVersion: "66.0",
  },
  detectedAt: 1,
};

describe("sf-data360 request resolution", () => {
  it("uses active org api version and default target org", () => {
    const input: D360ApiInput = {
      method: "GET",
      path: "/services/data/v60.0/ssot/data-model-objects",
    };

    expect(resolveRequest(input, env)).toMatchObject({
      method: "GET",
      apiPath: "/services/data/v66.0/ssot/data-model-objects",
      targetOrg: "my-sandbox",
      apiVersion: "66.0",
      orgType: "sandbox",
      safety: { level: "read", requiresConfirmation: false },
    });
  });

  it("treats non-default target org type as unknown until execution resolves it", () => {
    const input: D360ApiInput = {
      method: "POST",
      path: "/ssot/data-model-objects",
      target_org: "other-org",
    };

    expect(resolveRequest(input, env)).toMatchObject({
      targetOrg: "other-org",
      orgType: "unknown",
      safety: { level: "create", requiresConfirmation: true },
    });
  });

  it("resolves explicit non-default target orgs before execution", async () => {
    const input: D360ApiInput = {
      method: "POST",
      path: "/ssot/data-model-objects",
      target_org: "other-org",
    };
    orgCreateMock.mockResolvedValueOnce(
      fakeOrg({
        authFields: {
          alias: "other-org",
          username: "other@example.invalid",
          instanceUrl: "https://other-dev-ed.develop.my.salesforce.com",
        },
        apiVersion: "66.0",
      }),
    );
    const resolved = await resolveRequestForExecution(input, env, async () => {
      throw new Error("detectOrg should not shell out anymore");
    });

    expect(resolved).toMatchObject({
      targetOrg: "other-org",
      orgType: "developer",
      apiVersion: "66.0",
      safety: { level: "create", requiresConfirmation: false },
    });
    expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername: "other-org" });
  });

  it("keeps explicit target orgs fail-closed when Org.create rejects", async () => {
    const input: D360ApiInput = {
      method: "POST",
      path: "/ssot/data-model-objects",
      target_org: "missing-org",
    };
    orgCreateMock.mockRejectedValueOnce(new Error("auth failed"));
    const resolved = await resolveRequestForExecution(input, env, async () => {
      throw new Error("detectOrg should not shell out anymore");
    });

    expect(resolved).toMatchObject({
      targetOrg: "missing-org",
      orgType: "unknown",
      safety: { level: "create", requiresConfirmation: true },
    });
  });

  it("adds an explicit empty JSON body for DELETE requests", () => {
    const resolved = resolveRequest(
      { method: "DELETE", path: "/ssot/data-model-objects/Test__dlm" },
      env,
    );

    expect(buildSfApiRequestArgs(resolved, undefined)).toContain("--body");
    expect(buildSfApiRequestArgs(resolved, undefined).at(-1)).toBe("{}");
  });

  it("detects application-level REST errors even when the CLI exits zero", () => {
    expect(responseLooksLikeError('{"content":[],"error":{"message":"Nope"},"size":0}')).toBe(true);
    expect(responseLooksLikeError('[{"errorCode":"NOT_FOUND","message":"Missing"}]')).toBe(true);
    expect(responseLooksLikeError('{"dataModelObject":[]}')).toBe(false);
    expect(responseLooksLikeError("not json")).toBe(false);
  });
});
