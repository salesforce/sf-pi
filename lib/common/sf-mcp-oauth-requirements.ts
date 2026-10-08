/* SPDX-License-Identifier: Apache-2.0 */
/** Shared OAuth setup requirements for Salesforce-hosted MCP clients. */

import { createHash } from "node:crypto";

export const SF_MCP_HEADLESS_360_REQUIREMENT = Object.freeze({
  presetId: "headless-360" as const,
  serverName: "salesforce-headless-360",
  callbackUrl: "http://localhost:8765/callback",
  metadataScopes: ["MCP", "RefreshToken"] as const,
  oauthScopes: ["mcp_api", "refresh_token"] as const,
  publicClient: true,
  namedUserJwt: true,
});

export type SfIntegrateMcpPresetId = typeof SF_MCP_HEADLESS_360_REQUIREMENT.presetId;

export function sfMcpHeadlessConnectionName(input: {
  alias?: string;
  targetOrg: string;
  orgId: string;
}): string {
  const source = input.alias ?? input.targetOrg;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/[-_]{2,}/gu, "-")
    .replace(/^[-_]+|[-_]+$/gu, "");
  if (slug) return `${SF_MCP_HEADLESS_360_REQUIREMENT.serverName}-${slug}`;
  const digest = createHash("sha256").update(input.orgId).digest("hex").slice(0, 8);
  return `${SF_MCP_HEADLESS_360_REQUIREMENT.serverName}-${digest}`;
}
