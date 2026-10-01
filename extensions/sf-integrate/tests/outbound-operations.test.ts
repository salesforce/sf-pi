/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { testOutboundConnection } from "../lib/outbound-operations.ts";

const session = {
  target: {
    targetOrg: "IntegrationDev",
    alias: "IntegrationDev",
    orgId: "example-org-id",
    instanceUrl: "https://example.develop.my.salesforce.com",
    orgType: "developer",
    apiVersion: "67.0",
    maxApiVersion: "67.0",
    versionSource: "org-latest",
  },
} as unknown as SalesforceSession;

describe("outbound connection test", () => {
  it("delegates a GET-only Named Credential probe to SF Apex", async () => {
    const execute = vi.fn(async (body: string) => {
      expect(body).toContain("request.setMethod('GET')");
      return {
        content: [{ type: "text", text: "Anonymous Apex succeeded." }],
        details: { ok: true },
      };
    });

    const result = await testOutboundConnection(
      {
        action: "connection.test",
        target_org: "IntegrationDev",
        direction: "outbound",
        named_credential_name: "ExampleNC",
        test_path: "/health?probe=1",
      },
      session,
      execute,
    );

    expect(result.details.ok).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    const body = String(execute.mock.calls[0]?.[0]);
    expect(body).toContain("callout:ExampleNC/health?probe=1");
    expect(body).toContain("request.setMethod('GET')");
    expect(body).not.toMatch(/setMethod\('(POST|PUT|PATCH|DELETE)'\)/u);
  });

  it("refuses absolute or protocol-relative test targets", async () => {
    const execute = vi.fn();
    await expect(
      testOutboundConnection(
        {
          action: "connection.test",
          target_org: "IntegrationDev",
          direction: "outbound",
          named_credential_name: "ExampleNC",
          test_path: "https://example.invalid/health",
        },
        session,
        execute,
      ),
    ).rejects.toThrow("relative URL path");
    await expect(
      testOutboundConnection(
        {
          action: "connection.test",
          target_org: "IntegrationDev",
          direction: "outbound",
          named_credential_name: "ExampleNC",
          test_path: "//example.invalid/health",
        },
        session,
        execute,
      ),
    ).rejects.toThrow("relative URL path");
    expect(execute).not.toHaveBeenCalled();
  });
});
