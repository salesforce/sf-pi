/* SPDX-License-Identifier: Apache-2.0 */
/** Salesforce-published MCP presets and their deliberately small capability claims. */
import type { McpServerConfig } from "./mcp-config.ts";

export type McpPresetId =
  | "salesforce-dx"
  | "data360"
  | "backup-recover"
  | "content-readonly"
  | "content-write"
  | "headless-360"
  | "tableau-next"
  | "crm-analytics"
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
  revision: number;
  serverName: string;
  label: string;
  icon: string;
  description: string;
  transport: "stdio" | "http";
  setup: "ready" | "hosted-oauth" | "marketing-cloud" | "mulesoft-env" | "custom-url";
  risk: "read" | "write" | "delete" | "mixed";
  support: "ga" | "beta" | "alpha";
  supportNote?: string;
  docsUrl: string;
  approvedTools?: readonly string[];
  overlaps: McpPresetOverlap[];
}

export type McpResolution = "enable" | "complement-native" | "side-by-side" | "native-only";

export interface PresetSetup {
  environment?: "production" | "sandbox";
  oauthClientId?: string;
  region?: "US" | "EU" | "PROD_US" | "PROD_EU" | "PROD_CA" | "PROD_JP";
  tenantId?: string;
  marketingClientId?: string;
  customUrl?: string;
}

const BACKUP_RECOVER_TOOLS = [
  "get_backups",
  "get_backup_by_id",
  "get_backup_objects",
  "get_latest_policy",
  "get_retention_rules",
  "get_audit_events",
  "enqueue_backup",
  "get_activities",
  "get_restore_with_hierarchy",
  "get_compare_activity",
  "get_compare_activity_summaries",
  "get_restore_activity_record_selection_metadata",
  "get_selection_counts_by_type",
  "get_restore_result_counts",
  "get_restore_activity",
  "get_activity",
  "get_hierarchy_summary",
  "get_restore_activity_summary",
  "get_restore_activity_object_results",
  "get_restore_with_hierarchy_results",
  "create_compare_activity",
  "update_selection_records",
] as const;
const CONTENT_READ_TOOLS = [
  "get_cms_workspace",
  "get_cms_workspaces",
  "get_cms_channels_for_workspace",
  "search_content_cms_workspaces",
  "get_cms_content_item",
  "get_cms_content_variant",
  "get_cms_folder",
  "get_cms_folder_sharing_details",
  "get_cms_channels",
  "get_cms_channel",
  "get_cms_channel_delivery_detail",
  "search_content_cms_channels",
  "search_media_cms_channels",
  "get_published_cms_content_from_channel",
  "get_published_cms_content_from_site",
  "get_published_cms_content_item_from_site",
  "get_published_cms_collection_from_site",
  "get_published_cms_content_item_from_channel",
  "get_published_cms_collection_from_channel",
  "search_electronic_media",
  "get_brand_instructions",
  "get_content_types_for_workspace",
] as const;
const CONTENT_WRITE_TOOLS = [
  "update_cms_workspace_channels",
  "create_cms_workspace",
  "update_cms_workspace",
  "create_cms_content",
  "create_cms_content_variant",
  "clone_cms_content",
  "update_cms_content_variant",
  "publish_cms_content",
  "unpublish_cms_content",
  "create_cms_folder",
  "update_cms_folder",
  "update_cms_folder_sharing_settings",
  "create_cms_channel",
  "update_cms_channel",
  "get_or_create_cms_workspace_and_web_app_channel",
] as const;
const TABLEAU_NEXT_TOOLS = [
  "analyze_data",
  "list_dashboards",
  "get_dashboard",
  "list_visualizations",
  "get_visualization",
  "list_semantic_models",
  "get_semantic_model",
  "list_semantic_model_data_objects",
  "list_semantic_model_relationships",
  "get_semantic_model_logical_view",
  "list_semantic_model_measures",
  "list_semantic_model_dimensions",
  "list_semantic_model_metrics",
  "get_semantic_model_metric",
  "list_semantic_model_calculated_dimensions",
  "list_semantic_model_calculated_measures",
  "list_workspaces",
  "list_workspace_assets",
  "search_assets",
] as const;
const CRM_ANALYTICS_TOOLS = [
  "list_folders",
  "get_folder",
  "list_datasets",
  "get_dataset",
  "get_xmd",
  "execute_query",
  "list_dashboards",
  "get_dashboard",
  "list_lenses",
  "get_lens",
] as const;

const PRESETS: readonly McpPreset[] = [
  {
    id: "salesforce-dx",
    revision: 2,
    serverName: "salesforce-dx",
    label: "Salesforce DX",
    icon: "⚡",
    description: "Org, metadata, user, data, and testing tools using existing Salesforce CLI auth.",
    transport: "stdio",
    setup: "ready",
    risk: "mixed",
    support: "ga",
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
    ],
  },
  {
    id: "data360",
    revision: 2,
    serverName: "salesforce-data360",
    label: "Data 360",
    icon: "◉",
    description: "Data 360 Connect API discovery, payload examples, and execution meta-tools.",
    transport: "http",
    setup: "hosted-oauth",
    risk: "mixed",
    support: "ga",
    docsUrl:
      "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/data360-mcp.html",
    approvedTools: ["search", "payload_examples", "execute"],
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
    id: "backup-recover",
    revision: 1,
    serverName: "salesforce-backup-recover",
    label: "Backup and Recover",
    icon: "↻",
    description: "Inspect backups and guide bounded backup and restore-selection workflows.",
    transport: "http",
    setup: "hosted-oauth",
    risk: "mixed",
    support: "alpha",
    supportNote:
      "Alpha in SF Pi: the current Salesforce reference leaves the server's GA or Beta release status unresolved.",
    docsUrl:
      "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/backup-and-recover.html",
    approvedTools: BACKUP_RECOVER_TOOLS,
    overlaps: [],
  },
  {
    id: "content-readonly",
    revision: 1,
    serverName: "salesforce-content-readonly",
    label: "Content Read-Only",
    icon: "▤",
    description: "Read Salesforce CMS workspaces, channels, folders, content, and media.",
    transport: "http",
    setup: "hosted-oauth",
    risk: "read",
    support: "alpha",
    supportNote:
      "Alpha in SF Pi: Salesforce currently documents Agentforce Vibes as the only supported client.",
    docsUrl:
      "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/content-readonly.html",
    approvedTools: CONTENT_READ_TOOLS,
    overlaps: [],
  },
  {
    id: "content-write",
    revision: 1,
    serverName: "salesforce-content-write",
    label: "Content Write",
    icon: "✐",
    description: "Create, update, publish, and organize Salesforce CMS content and channels.",
    transport: "http",
    setup: "hosted-oauth",
    risk: "write",
    support: "alpha",
    supportNote:
      "Alpha in SF Pi: Salesforce currently documents Agentforce Vibes as the only supported client.",
    docsUrl:
      "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/content-write.html",
    approvedTools: CONTENT_WRITE_TOOLS,
    overlaps: [],
  },
  {
    id: "headless-360",
    revision: 1,
    serverName: "salesforce-headless-360",
    label: "Headless 360",
    icon: "◎",
    description: "Discover, describe, and dispatch broad Salesforce platform operations.",
    transport: "http",
    setup: "hosted-oauth",
    risk: "mixed",
    support: "beta",
    supportNote: "Salesforce documents Headless 360 as a Beta service.",
    docsUrl:
      "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/headless-360-mcp.html",
    approvedTools: ["discover", "describe", "dispatch", "dispatch_readonly"],
    overlaps: [
      {
        nativeExtensionId: "sf-soql",
        relationship: "partial",
        capabilities: ["platform.records.query", "platform.records.mutate"],
        reason:
          "Headless dispatch can query and mutate records already governed by SF Pi families.",
      },
      {
        nativeExtensionId: "sf-apex",
        relationship: "partial",
        capabilities: ["platform.apex.author", "platform.apex.test"],
        reason: "Headless dispatch can manage Apex surfaces already governed by SF Apex.",
      },
      {
        nativeExtensionId: "sf-flow",
        relationship: "partial",
        capabilities: ["platform.flow.lifecycle"],
        reason: "Headless dispatch can reach setup automation already governed by SF Flow.",
      },
    ],
  },
  {
    id: "tableau-next",
    revision: 1,
    serverName: "salesforce-tableau-next",
    label: "Tableau Next",
    icon: "▥",
    description: "Read governed Tableau Next semantic models, metrics, dashboards, and analytics.",
    transport: "http",
    setup: "hosted-oauth",
    risk: "read",
    support: "ga",
    docsUrl:
      "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/tableau-next.html",
    approvedTools: TABLEAU_NEXT_TOOLS,
    overlaps: [],
  },
  {
    id: "crm-analytics",
    revision: 1,
    serverName: "salesforce-crm-analytics",
    label: "CRM Analytics",
    icon: "▦",
    description: "Read CRM Analytics apps, datasets, SAQL results, dashboards, and lenses.",
    transport: "http",
    setup: "hosted-oauth",
    risk: "read",
    support: "beta",
    supportNote: "Salesforce documents CRM Analytics MCP as a pilot or Beta service.",
    docsUrl:
      "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/crm-analytics-mcp.html",
    approvedTools: CRM_ANALYTICS_TOOLS,
    overlaps: [],
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
    support: "ga",
    revision: 1,
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
    support: "ga",
    revision: 1,
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
    support: "alpha",
    revision: 1,
    supportNote: "Custom servers remain quarantined until their tools are reviewed in /mcp.",
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
  if (resolution === "native-only") {
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
    data360: "data360",
    "backup-recover": "platform/backup-and-recover",
    "content-readonly": "platform/content-readonly",
    "content-write": "platform/content-write",
    "headless-360": "platform/headless-360",
    "tableau-next": "analytics/tableau-next",
    "crm-analytics": "analytics/crma-beta",
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

  const approved = approvedToolsForResolution(preset);
  if (!approved) return { ...base, exposure: "codemode" };
  return {
    ...base,
    exposure: "hidden",
    toolExposure: Object.fromEntries(approved.map((tool) => [tool, "codemode"] as const)),
  };
}

export function approvedToolsForResolution(preset: McpPreset): string[] | undefined {
  return preset.approvedTools ? [...preset.approvedTools] : undefined;
}

function hostedEndpointPrefix(id: McpPresetId, environment: "production" | "sandbox"): string {
  if (id === "data360") return environment === "sandbox" ? "data/sandbox/" : "data/";
  return environment === "sandbox" ? "sandbox/" : "";
}

export function isPresetConfigCompatible(
  preset: McpPreset,
  config: McpServerConfig,
): { compatible: boolean; reason?: string } {
  if (preset.id === "salesforce-dx") {
    const args = "args" in config ? (config.args ?? []) : [];
    return "command" in config &&
      config.command === "npx" &&
      args.some((arg) => arg.startsWith("@salesforce/mcp@"))
      ? { compatible: true }
      : { compatible: false, reason: "The command is not the Salesforce DX MCP package." };
  }
  if (preset.id === "mulesoft-dx") {
    return "command" in config &&
      config.command === "npx" &&
      (config.args ?? []).includes("mulesoft-mcp-server")
      ? { compatible: true }
      : { compatible: false, reason: "The command is not the MuleSoft DX MCP server." };
  }
  if (preset.id === "custom-salesforce") {
    try {
      if (!("url" in config) || !config.url) throw new Error("missing URL");
      validatedCustomUrl(config.url);
      return { compatible: true };
    } catch {
      return { compatible: false, reason: "The entry is not a supported secure remote MCP URL." };
    }
  }
  if (preset.id === "marketing-cloud") {
    try {
      const url = new URL("url" in config ? config.url : "");
      const knownHost = [
        "mai-mce-mcp-cdp1.sfdc-yzvdd4.svc.sfdcfc.net",
        "mai-mce-mcp-cdp1.sfdc-yfeipo.svc.sfdcfc.net",
      ].includes(url.hostname);
      return url.protocol === "https:" &&
        knownHost &&
        /^\/t\/[^/]+\/c\/[^/]+\/api\/mcp$/.test(url.pathname)
        ? { compatible: true }
        : { compatible: false, reason: "The URL is not a Marketing Cloud MCP endpoint." };
    } catch {
      return { compatible: false, reason: "The URL is invalid." };
    }
  }
  if (!("url" in config) || !config.url) {
    return { compatible: false, reason: "The entry is not a hosted MCP URL." };
  }
  if (!config.oauth?.clientId) {
    return {
      compatible: false,
      reason: "The hosted entry is missing its External Client App consumer key.",
    };
  }
  try {
    const url = new URL(config.url);
    const expected = buildServerConfig(preset, "enable", {
      environment: url.pathname.includes("/sandbox/") ? "sandbox" : "production",
      oauthClientId: config.oauth?.clientId ?? "compatibility-check",
    });
    if (!("url" in expected) || expected.url !== config.url) {
      return { compatible: false, reason: "The endpoint does not match this preset." };
    }
    if (preset.approvedTools && !hasApprovedToolExposure(preset, config)) {
      return {
        compatible: false,
        reason:
          "The entry does not use this preset's hidden-by-default approved tool contract; reset it before SF MCP takes ownership.",
      };
    }
    return { compatible: true };
  } catch {
    return { compatible: false, reason: "The hosted MCP URL is invalid." };
  }
}

function hasApprovedToolExposure(preset: McpPreset, config: McpServerConfig): boolean {
  if (config.exposure !== "hidden" || !config.toolExposure) return false;
  const configured = Object.entries(config.toolExposure)
    .filter(([, exposure]) => exposure !== "hidden")
    .map(([name]) => name)
    .sort();
  const approved = approvedToolsForResolution(preset)?.sort() ?? [];
  return (
    approved.length > 0 &&
    approved.length === configured.length &&
    approved.every((name, index) => name === configured[index])
  );
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
