/* SPDX-License-Identifier: Apache-2.0 */
/** Proof that ApexGuru uses the shared Salesforce Connection Module. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";

const connectSalesforceMock = vi.fn();
vi.mock("../../../lib/common/sf-conn/index.ts", () => ({
  connectSalesforce: (options: unknown) => connectSalesforceMock(options),
}));

import { runApexGuru, validateApexGuru } from "../lib/apexguru.ts";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeSession(
  request = vi.fn(async (input: { path: string }) => ({
    status: 200,
    body: { status: "success", message: "ready" },
    path: `/services/data/v67.0${input.path}`,
    target: undefined,
    warnings: [],
  })),
): SalesforceSession {
  const target = Object.freeze({
    targetOrg: "ExampleOrg",
    instanceUrl: "https://example.sandbox.my.salesforce.com",
    orgType: "sandbox" as const,
    apiVersion: "67.0",
    maxApiVersion: "67.0",
    versionSource: "org-latest" as const,
  });
  return {
    target,
    connection: {} as SalesforceSession["connection"],
    identity: vi.fn(async () => ({
      org_id: "00D000000000001AAA",
      instance_url: target.instanceUrl,
      user_id: "005000000000001AAA",
    })),
    path: vi.fn(),
    request: request as SalesforceSession["request"],
    continueRequest: vi.fn() as SalesforceSession["continueRequest"],
    query: vi.fn() as SalesforceSession["query"],
  };
}

describe("ApexGuru shared connection", () => {
  it("validates access through a versionless shared request", async () => {
    const session = fakeSession();
    connectSalesforceMock.mockResolvedValue(session);

    const result = await validateApexGuru("ExampleOrg", "/workspace");

    expect(connectSalesforceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/workspace",
        targetOrg: "ExampleOrg",
        timeoutMs: expect.any(Number),
      }),
    );
    expect(session.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/apexguru/validate",
        timeoutMs: expect.any(Number),
      }),
    );
    expect(result).toMatchObject({
      access: "enabled",
      orgId: "00D000000000001AAA",
      userId: "005000000000001AAA",
      apiVersion: "67.0",
    });
  });

  it("submits and polls ApexGuru through versionless shared requests under one deadline", async () => {
    const report = Buffer.from("[]", "utf8").toString("base64");
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { status: "new", requestId: "req-1" },
        path: "/services/data/v67.0/apexguru/request",
        warnings: [],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: { status: "success", report },
        path: "/services/data/v67.0/apexguru/request/req-1",
        warnings: [],
      });
    const session = fakeSession(request);
    connectSalesforceMock.mockReset();
    connectSalesforceMock.mockResolvedValue(session);
    const dir = mkdtempSync(path.join(tmpdir(), "apexguru-shared-"));
    tempDirs.push(dir);
    const file = path.join(dir, "Demo.cls");
    writeFileSync(file, "public class Demo {}", "utf8");

    const result = await runApexGuru({ file, cwd: dir, target_org: "ExampleOrg", timeout_ms: 500 });

    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ method: "POST", path: "/apexguru/request" }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ method: "GET", path: "/apexguru/request/req-1" }),
    );
    expect(request.mock.calls.every(([call]) => call.timeoutMs > 0 && call.timeoutMs <= 500)).toBe(
      true,
    );
    expect(result).toMatchObject({ ok: true, source: "apexguru", exitCode: 0 });
  });

  it("fails before connection work when the shared deadline is already exhausted", async () => {
    connectSalesforceMock.mockReset();
    const dir = mkdtempSync(path.join(tmpdir(), "apexguru-deadline-"));
    tempDirs.push(dir);
    const file = path.join(dir, "Demo.cls");
    writeFileSync(file, "public class Demo {}", "utf8");

    await expect(
      runApexGuru({
        file,
        cwd: dir,
        target_org: "ExampleOrg",
        timeout_ms: 100,
        deadline_ms: Date.now() - 1,
      }),
    ).rejects.toThrow(/timed out/i);
    expect(connectSalesforceMock).not.toHaveBeenCalled();
  });
});
