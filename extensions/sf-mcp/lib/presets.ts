/* SPDX-License-Identifier: Apache-2.0 */
/** Salesforce-published MCP presets and their deliberately small capability claims. */
import type { McpServerConfig } from "./mcp-config.ts";

export type McpPresetId =
  | "salesforce-dx"
  | "sobject-reads"
  | "sobject-mutations"
  | "sobject-deletes"
  | "sobject-all"
  | "data360"
  | "marketing-cloud"
  | "mulesoft-dx"
  | "custom-salesforce";

export type ConflictRelationship = "direct" | "partial";

export interface McpPresetOverlap {
  nativeExtensionId: string;
  relationship: ConflictRelationship;
  capabilities: string[];
  reason: string;
}

export interface McpPreset {
  id: McpPresetId;
  serverName: string;
  label: string;
  icon: string;
  description: string;
  transport: "stdio" | "http";
  setup: "ready" | "hosted-oauth" | "marketing-cloud" | "mulesoft-env" | "custom-url";
  risk: "read" | "write" | "delete" | "mixed";
  docsUrl: string;
  overlaps: McpPresetOverlap[];
}

export type McpResolution =
  "enable" | "complement-native" | "side-by-side" | "native-only" | "use-sobject-mutations";

export interface PresetSetup {
  environment?: "production" | "sandbox";
  oauthClientId?: string;
  region?: "US" | "EU" | "PROD_US" | "PROD_EU" | "PROD_CA" | "PROD_JP";
  tenantId?: string;
  marketingClientId?: string;
  customUrl?: string;
}

const SOQL_OVERLAP: McpPresetOverlap = {
  nativeExtensionId: "sf-soql",
  relationship: "direct",
  capabilities: ["platform.records.schema", "platform.records.query", "platform.records.search"],
  reason:
    "SF SOQL already owns schema-aware query and search with validation, bounds, plans, and artifacts.",
};

const PRESETS: readonly McpPreset[] = [
  {
    id: "salesforce-dx",
    serverName: "salesforce-dx",
    label: "Salesforce DX",
    icon: "⚡",
    description: "Org, metadata, user, data, and testing tools using existing Salesforce CLI auth.",
    transport: "stdio",
    setup: "ready",
    risk: "mixed",
    docsUrl:
      "https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-mcp-server.html",
    overlaps: [
      {
        nativeExtensionId: "sf-soql",
        relationship: "partial",
        capabilities: ["platform.records.query"],
        reason: "The DX data toolset overlaps with SF SOQL's bounded query lifecycle.",
      },
      {
        nativeExtensionId: "sf-apex",
        relationship: "partial",
        capabilities: ["platform.apex.test"],
        reason: "The DX testing toolset overlaps with SF Apex targeted tests.",
      },
      {
        nativeExtensionId: "sf-code-analyzer",
        relationship: "direct",
        capabilities: ["platform.code.scan"],
        reason: "The DX code-analysis toolset overlaps with SF Code Analyzer.",
      },
      {
        nativeExtensionId: "sf-lwc",
        relationship: "partial",
        capabilities: ["platform.lwc.inspect"],
        reason: "DX LWC expert tools overlap with SF LWC local lifecycle workflows.",
      },
    ],
  },
  {
    id: "sobject-reads",
    serverName: "salesforce-sobject-reads",
    label: "SObject Reads",
    icon: "🔎",
    description:
      "Read-only Salesforce schema, query, search, recent-record, and relationship tools.",
    transport: "http",
    setup: "hosted-oauth",
    risk: "read",
    docsUrl:
      "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/sobject-reads.html",
    overlaps: [SOQL_OVERLAP],
  },
  {
    id: "sobject-mutations",
    serverName: "salesforce-sobject-mutations",
    label: "SObject Mutations",
    icon: "✎",
    description: "Create and update records without exposing delete operations.",
    transport: "http",
    setup: "hosted-oauth",
    risk: "write",
    docsUrl:
      "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/sobject-mutations.html",
    overlaps: [SOQL_OVERLAP],
  },
  {
    id: "sobject-deletes",
    serverName: "salesforce-sobject-deletes",
    label: "SObject Deletes",
    icon: "⌫",
    description: "Delete-focused record tools with schema, query, and search helpers.",
    transport: "http",
    setup: "hosted-oauth",
    risk: "delete",
    docsUrl:
      "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/sobject-deletes.html",
    overlaps: [SOQL_OVERLAP],
  },
  {
    id: "sobject-all",
    serverName: "salesforce-sobject-all",
    label: "SObject All",
    icon: "◆",
    description: "Full create, read, update, delete, query, search, and relationship access.",
    transport: "http",
    setup: "hosted-oauth",
    risk: "mixed",
    docsUrl:
      "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/sobject-all.html",
    overlaps: [SOQL_OVERLAP],
  },
  {
    id: "data360",
    serverName: "salesforce-data360",
    label: "Data 360",
    icon: "◉",
    description: "Data 360 Connect API discovery, payload examples, and execution meta-tools.",
    transport: "http",
    setup: "hosted-oauth",
    risk: "mixed",
    docsUrl:
      "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/data360-mcp.html",
    overlaps: [
      {
        nativeExtensionId: "sf-data360",
        relationship: "direct",
        capabilities: ["data360.query", "data360.configuration", "data360.activation"],
        reason:
          "SF Data 360 already owns typed discovery, dry-run planning, execution, orchestration, and artifacts.",
      },
    ],
  },
  {
    id: "marketing-cloud",
    serverName: "salesforce-marketing-cloud",
    label: "Marketing Cloud",
    icon: "☁",
    description: "Marketing Cloud Engagement campaign, content, customer-data, and transfer tools.",
    transport: "http",
    setup: "marketing-cloud",
    risk: "mixed",
    docsUrl: "https://developer.salesforce.com/docs/marketing/mce-mcp/guide/mce-mcp-setup.html",
    overlaps: [],
  },
  {
    id: "mulesoft-dx",
    serverName: "mulesoft-dx",
    label: "MuleSoft DX",
    icon: "M",
    description: "API design, Exchange, deployment, policy, and Anypoint Platform tools.",
    transport: "stdio",
    setup: "mulesoft-env",
    risk: "mixed",
    docsUrl: "https://docs.mulesoft.com/mulesoft-mcp-server/getting-started",
    overlaps: [],
  },
  {
    id: "custom-salesforce",
    serverName: "salesforce-custom",
    label: "Custom Salesforce MCP",
    icon: "+",
    description: "Connect an org-curated streamable HTTP server in quarantine mode.",
    transport: "http",
    setup: "custom-url",
    risk: "mixed",
    docsUrl:
      "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/custom-servers.html",
    overlaps: [],
  },
] as const;

export const SALESFORCE_MCP_PRESETS: readonly McpPreset[] = PRESETS;

export function getPreset(id: McpPresetId | string): McpPreset {
  const preset = PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`Unknown Salesforce MCP preset: ${id}`);
  return preset;
}

export function buildServerConfig(
  preset: McpPreset,
  resolution: McpResolution,
  setup: PresetSetup = {},
): McpServerConfig {
  if (resolution === "native-only" || resolution === "use-sobject-mutations") {
    throw new Error(`${resolution} does not install ${preset.id}.`);
  }

  if (preset.id === "salesforce-dx") {
    const toolsets =
      resolution === "complement-native"
        ? "orgs,metadata,users"
        : "orgs,metadata,data,users,testing";
    return {
      command: "npx",
      args: [
        "-y",
        "@salesforce/mcp@latest",
        "--orgs",
        "DEFAULT_TARGET_ORG",
        "--toolsets",
        toolsets,
      ],
      description: preset.description,
      exposure: "codemode",
      timeout: 120,
    };
  }

  if (preset.id === "mulesoft-dx") {
    return {
      command: "npx",
      args: ["-y", "mulesoft-mcp-server", "start"],
      env: {
        ANYPOINT_CLIENT_ID: "${ANYPOINT_CLIENT_ID}",
        ANYPOINT_CLIENT_SECRET: "${ANYPOINT_CLIENT_SECRET}",
        ANYPOINT_REGION: setup.region ?? "PROD_US",
      },
      description: preset.description,
      exposure: "codemode",
      timeout: 120,
    };
  }

  if (preset.id === "marketing-cloud") {
    const tenantId = required(setup.tenantId, "Marketing Cloud tenant ID");
    const clientId = required(setup.marketingClientId, "Marketing Cloud client ID");
    const host =
      setup.region === "EU"
        ? "mai-mce-mcp-cdp1.sfdc-yzvdd4.svc.sfdcfc.net"
        : "mai-mce-mcp-cdp1.sfdc-yfeipo.svc.sfdcfc.net";
    return {
      url: `https://${host}/t/${encodeURIComponent(tenantId)}/c/${encodeURIComponent(clientId)}/api/mcp`,
      description: preset.description,
      exposure: "codemode",
      timeout: 120,
    };
  }

  if (preset.id === "custom-salesforce") {
    return {
      url: validatedCustomUrl(required(setup.customUrl, "Custom MCP URL")),
      description: preset.description,
      exposure: "hidden",
      timeout: 120,
    };
  }

  const environment = setup.environment ?? "sandbox";
  const clientId = required(setup.oauthClientId, "External Client App consumer key");
  const pathByPreset: Partial<Record<McpPresetId, string>> = {
    "sobject-reads": "platform/sobject-reads",
    "sobject-mutations": "platform/sobject-mutations",
    "sobject-deletes": "platform/sobject-deletes",
    "sobject-all": "platform/sobject-all",
    data360: "data360",
  };
  const serverPath = pathByPreset[preset.id];
  if (!serverPath) throw new Error(`No hosted endpoint is defined for ${preset.id}.`);
  const prefix = hostedEndpointPrefix(preset.id, environment);
  const url = `https://api.salesforce.com/platform/mcp/v1/${prefix}${serverPath}`;

  const base: McpServerConfig = {
    url,
    oauth: { clientId, callbackPort: 8765 },
    description: preset.description,
    timeout: 120,
  };

  if (resolution !== "complement-native") {
    return { ...base, exposure: "codemode" };
  }

  const complementary = complementaryTools(preset.id);
  return {
    ...base,
    exposure: "hidden",
    toolExposure: Object.fromEntries(complementary.map((tool) => [tool, "codemode"] as const)),
  };
}

function complementaryTools(id: McpPresetId): string[] {
  switch (id) {
    case "sobject-reads":
      return ["getUserInfo", "listRecentSobjectRecords", "getRelatedRecords"];
    case "sobject-mutations":
      return ["createSobjectRecord", "updateSobjectRecord", "updateRelatedRecord"];
    case "sobject-deletes":
      return ["deleteSobjectRecord", "deleteRelatedRecord"];
    case "sobject-all":
      return [
        "getUserInfo",
        "listRecentSobjectRecords",
        "getRelatedRecords",
        "createSobjectRecord",
        "updateSobjectRecord",
        "updateRelatedRecord",
        "deleteSobjectRecord",
        "deleteRelatedRecord",
      ];
    default:
      return [];
  }
}

function hostedEndpointPrefix(id: McpPresetId, environment: "production" | "sandbox"): string {
  if (id === "data360") return environment === "sandbox" ? "data/sandbox/" : "data/";
  return environment === "sandbox" ? "sandbox/" : "";
}

function validatedCustomUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Custom MCP URL must be a valid URL.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("Custom remote MCP URLs must use HTTPS.");
  }
  return url.toString();
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}
