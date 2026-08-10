/* SPDX-License-Identifier: Apache-2.0 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SalesforceSession, SalesforceTarget } from "../../../lib/common/sf-conn/index.ts";

const connectSalesforceMock = vi.fn();
vi.mock("../../../lib/common/sf-conn/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/common/sf-conn/index.ts")>();
  return { ...actual, connectSalesforce: (options: unknown) => connectSalesforceMock(options) };
});

import {
  responseLooksLikeError,
  resolveRequest,
  resolveRequestForExecution,
  type D360ApiInput,
} from "../lib/api-tool.ts";

function fakeSession(overrides: Partial<SalesforceTarget> = {}): SalesforceSession {
  const target = Object.freeze({
    targetOrg: "my-sandbox",
    alias: "my-sandbox",
    instanceUrl: "https://example.sandbox.my.salesforce.com",
    orgType: "sandbox" as const,
    apiVersion: "67.0",
    maxApiVersion: "67.0",
    versionSource: "org-latest" as const,
    ...overrides,
  });
  return {
    target,
    connection: {} as SalesforceSession["connection"],
    identity: vi.fn(),
    path: vi.fn((resource: string) => {
      if (/^\/?services\/data\/v\d/i.test(resource)) {
        throw new Error("Salesforce callers must provide a versionless resource path.");
      }
      return `/services/data/v${target.apiVersion}${resource}`;
    }),
    request: vi.fn() as SalesforceSession["request"],
    continueRequest: vi.fn() as SalesforceSession["continueRequest"],
    query: vi.fn() as SalesforceSession["query"],
  };
}

beforeEach(() => connectSalesforceMock.mockReset());

describe("sf-data360 request resolution", () => {
  it("uses the shared session target, org type, and selected version", () => {
    const input: D360ApiInput = { method: "GET", path: "/ssot/data-model-objects" };

    expect(resolveRequest(input, fakeSession())).toMatchObject({
      method: "GET",
      apiPath: "/services/data/v67.0/ssot/data-model-objects",
      targetOrg: "my-sandbox",
      apiVersion: "67.0",
      orgType: "sandbox",
      safety: { level: "read", requiresConfirmation: false },
    });
  });

  it("rejects caller-owned versioned Data 360 paths", () => {
    const input: D360ApiInput = {
      method: "GET",
      path: "/services/data/v60.0/ssot/data-model-objects",
    };

    expect(() => resolveRequest(input, fakeSession())).toThrow(/versionless/i);
  });

  it("resolves explicit target orgs through the shared connection before execution", async () => {
    const input: D360ApiInput = {
      method: "POST",
      path: "/ssot/data-model-objects",
      target_org: "other-org",
    };
    const session = fakeSession({
      targetOrg: "other-org",
      alias: "other-org",
      instanceUrl: "https://other-dev-ed.develop.my.salesforce.com",
      orgType: "developer",
    });
    connectSalesforceMock.mockResolvedValue(session);
    const signal = new AbortController().signal;

    const execution = await resolveRequestForExecution(input, "/workspace", signal);

    expect(execution.resolved).toMatchObject({
      targetOrg: "other-org",
      orgType: "developer",
      apiVersion: "67.0",
      safety: { level: "create", requiresConfirmation: false },
    });
    expect(execution.session).toBe(session);
    expect(connectSalesforceMock).toHaveBeenCalledWith({
      cwd: "/workspace",
      targetOrg: "other-org",
      signal,
      timeoutMs: undefined,
    });
  });

  it("fails explicitly when the shared connection cannot resolve the target", async () => {
    connectSalesforceMock.mockRejectedValueOnce(new Error("auth failed"));

    await expect(
      resolveRequestForExecution(
        { method: "GET", path: "/ssot/data-spaces", target_org: "missing-org" },
        "/workspace",
      ),
    ).rejects.toThrow(/auth failed/);
  });

  it("detects application-level REST errors even when HTTP succeeds", () => {
    expect(responseLooksLikeError('{"content":[],"error":{"message":"Nope"},"size":0}')).toBe(true);
    expect(responseLooksLikeError('[{"errorCode":"NOT_FOUND","message":"Missing"}]')).toBe(true);
    expect(responseLooksLikeError('{"dataModelObject":[]}')).toBe(false);
    expect(responseLooksLikeError("not json")).toBe(false);
  });
});
