/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Regression coverage for Service Agent user provisioning hangs.
 *
 * The custom PermissionSet deploy path uses SDR directly. SDR's default
 * metadata poll timeout is 60 minutes, which can leave the Pi tool rendering
 * "lifecycle · running…" for far too long when a metadata deploy stalls.
 * These tests verify the helper uses bounded start/poll timeouts and passes
 * bounded polling options into SDR.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

let nextDeployNeverResolves = false;
let nextPollNeverResolves = false;
let lastPollArgs: unknown[] = [];
let lastDeployOptions: unknown;
let deployCallCount = 0;
let cancelCallCount = 0;

vi.mock("@salesforce/source-deploy-retrieve", () => ({
  ComponentSet: {
    fromSource: () => ({
      deploy: async (options: unknown) => {
        deployCallCount++;
        lastDeployOptions = options;
        if (nextDeployNeverResolves) return new Promise(() => {});
        return {
          pollStatus: async (...args: unknown[]) => {
            lastPollArgs = args;
            if (nextPollNeverResolves) return new Promise(() => {});
            return { response: { success: true, id: "0Af_DEPLOY" } };
          },
          cancel: async () => {
            cancelCallCount++;
          },
        };
      },
    }),
  },
}));

describe("deployPermissionSet", () => {
  beforeEach(() => {
    nextDeployNeverResolves = false;
    nextPollNeverResolves = false;
    lastPollArgs = [];
    lastDeployOptions = undefined;
    deployCallCount = 0;
    cancelCallCount = 0;
  });

  test("passes bounded poll options and reports success", async () => {
    const { deployPermissionSet } = await import("../lib/agent-user/deploy.ts");

    const result = await deployPermissionSet(
      {} as never,
      {
        developer_name: "Test_Agent_Access",
        xml: permissionSetXml("Test Agent Access"),
      },
      { deployStartTimeoutMs: 100, deployPollTimeoutMs: 2000 },
    );

    expect(result).toEqual({ ok: true, job_id: "0Af_DEPLOY" });
    expect(lastDeployOptions).toMatchObject({ usernameOrConnection: {} });
    expect(lastPollArgs).toEqual([1000, 2]);
  });

  test("times out a stuck deploy start instead of waiting for SDR defaults", async () => {
    const { deployPermissionSet } = await import("../lib/agent-user/deploy.ts");
    nextDeployNeverResolves = true;

    const result = await deployPermissionSet(
      {} as never,
      {
        developer_name: "Test_Agent_Access",
        xml: permissionSetXml("Test Agent Access"),
      },
      { deployStartTimeoutMs: 1, deployPollTimeoutMs: 100 },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/PermissionSet deploy start timed out after 1ms/);
    nextDeployNeverResolves = false;
  });

  test("times out a stuck deploy poll instead of waiting up to 60 minutes", async () => {
    const { deployPermissionSet } = await import("../lib/agent-user/deploy.ts");
    nextPollNeverResolves = true;

    const result = await deployPermissionSet(
      {} as never,
      {
        developer_name: "Test_Agent_Access",
        xml: permissionSetXml("Test Agent Access"),
      },
      { deployStartTimeoutMs: 100, deployPollTimeoutMs: 1 },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/PermissionSet deploy poll timed out after 1ms/);
    expect(cancelCallCount).toBe(1);
    nextPollNeverResolves = false;
  });

  test("pre-aborted signal does not start the deploy", async () => {
    const { deployPermissionSet } = await import("../lib/agent-user/deploy.ts");
    const controller = new AbortController();
    controller.abort();

    const result = await deployPermissionSet(
      {} as never,
      {
        developer_name: "Test_Agent_Access",
        xml: permissionSetXml("Test Agent Access"),
      },
      { signal: controller.signal },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/PermissionSet deploy start aborted before it started/);
    expect(deployCallCount).toBe(0);
  });
});

function permissionSetXml(label: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>${label}</label>
</PermissionSet>
`;
}
