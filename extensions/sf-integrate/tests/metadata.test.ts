/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { SF_MCP_HEADLESS_360_REQUIREMENT } from "../../../lib/common/sf-mcp-oauth-requirements.ts";
import { buildHeadlessMcpSources } from "../lib/metadata.ts";

function source(type: string): string {
  const item = buildHeadlessMcpSources({
    appName: "SfPiHeadless360Mcp",
    appLabel: "SF Pi Headless 360 MCP",
    contactEmail: "admin@example.invalid",
  }).find((candidate) => candidate.type === type);
  if (!item) throw new Error(`Missing ${type}`);
  return item.source;
}

describe("Headless 360 External Client App metadata", () => {
  it("builds the exact three-component public PKCE stack", () => {
    const components = buildHeadlessMcpSources({
      appName: "SfPiHeadless360Mcp",
      appLabel: "SF Pi Headless 360 MCP",
      contactEmail: "admin@example.invalid",
    });

    expect(components.map((component) => component.type)).toEqual([
      "ExternalClientApplication",
      "ExtlClntAppGlobalOauthSettings",
      "ExtlClntAppOauthSettings",
    ]);
    expect(source("ExtlClntAppGlobalOauthSettings")).toContain(
      `<callbackUrl>${SF_MCP_HEADLESS_360_REQUIREMENT.callbackUrl}</callbackUrl>`,
    );
    expect(source("ExtlClntAppGlobalOauthSettings")).toContain(
      "<isNamedUserJwtEnabled>true</isNamedUserJwtEnabled>",
    );
    expect(source("ExtlClntAppGlobalOauthSettings")).toContain(
      "<isPkceRequired>true</isPkceRequired>",
    );
    expect(source("ExtlClntAppGlobalOauthSettings")).toContain(
      "<isConsumerSecretOptional>true</isConsumerSecretOptional>",
    );
    expect(source("ExtlClntAppGlobalOauthSettings")).toContain(
      "<isRefreshTokenRotationEnabled>true</isRefreshTokenRotationEnabled>",
    );
    expect(source("ExtlClntAppOauthSettings")).toContain(
      "<commaSeparatedOauthScopes>MCP, RefreshToken</commaSeparatedOauthScopes>",
    );
  });

  it("escapes human-provided XML values", () => {
    const components = buildHeadlessMcpSources({
      appName: "SafeName",
      appLabel: "A & B <MCP>",
      contactEmail: "admin+oauth@example.invalid",
    });

    expect(components[0]?.source).toContain("<label>A &amp; B &lt;MCP&gt;</label>");
    expect(components[0]?.source).not.toContain("<label>A & B <MCP></label>");
  });
});
