/* SPDX-License-Identifier: Apache-2.0 */
/** Shared OAuth setup requirements for Salesforce-hosted MCP clients. */

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
