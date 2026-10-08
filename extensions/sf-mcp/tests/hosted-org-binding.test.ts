/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";

import { resolveHostedEndpointProof } from "../lib/hosted-org-binding.ts";

describe("hosted MCP org binding", () => {
  it("accepts an org-pinned endpoint only when OAuth discovery matches the target My Domain", async () => {
    const issuer = "https://example.develop.my.salesforce.com";
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const value = String(url);
      return new Response(
        JSON.stringify(
          value.includes("oauth-protected-resource")
            ? { authorization_servers: [issuer] }
            : {
                issuer,
                authorization_endpoint: `${issuer}/services/oauth2/authorize`,
                token_endpoint: `${issuer}/services/oauth2/token`,
              },
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const binding = await resolveHostedEndpointProof(
      {
        targetOrg: "ExampleDev",
        alias: "ExampleDev",
        orgId: "example-org-a",
        orgType: "developer",
        instanceUrl: issuer,
      },
      "platform/headless-360",
      undefined,
      fetchImpl,
    );

    expect(binding).toMatchObject({
      targetOrg: "ExampleDev",
      hostKey: "example.develop",
      serverUrl:
        "https://api.salesforce.com/platform/mcp/v1/d/example.develop/platform/headless-360",
      authorizationIssuer: issuer,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects protected-resource metadata that points at another Salesforce org", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            authorization_servers: ["https://other.develop.my.salesforce.com"],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    await expect(
      resolveHostedEndpointProof(
        {
          targetOrg: "ExampleDev",
          orgId: "example-org-a",
          orgType: "developer",
          instanceUrl: "https://example.develop.my.salesforce.com",
        },
        "platform/headless-360",
        undefined,
        fetchImpl,
      ),
    ).rejects.toThrow("explicit target org's My Domain");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
