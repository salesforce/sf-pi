/* SPDX-License-Identifier: Apache-2.0 */
/** Reviewed tool summaries merged with bounded session-local MCP observations. */
import { getObservedMcpTools, type ObservedMcpTool } from "./observed-tools.ts";
import type { McpPreset, McpPresetId } from "./presets.ts";
import { defineTools, type DocumentedMcpTool, type McpToolRisk } from "./tool-contract-types.ts";
import { B2C_COMMERCE_TOOLS } from "./tool-contracts-b2c.ts";
import { SALESFORCE_DX_TOOLS } from "./tool-contracts-dx.ts";
import { MARKETING_CLOUD_TOOLS } from "./tool-contracts-mce.ts";
import { MULESOFT_DX_TOOLS } from "./tool-contracts-mulesoft.ts";
import { TABLEAU_MCP_TOOLS } from "./tool-contracts-tableau.ts";

export type { DocumentedMcpTool, McpToolRisk } from "./tool-contract-types.ts";

interface PresetToolCatalog {
  capabilities: readonly string[];
  tools: readonly DocumentedMcpTool[];
  note?: string;
}

export interface McpToolDetail extends DocumentedMcpTool {
  documented: boolean;
  observed: boolean;
  descriptionSource: "documented" | "observed";
  exposure?: string;
  parameters?: unknown;
  annotations?: ObservedMcpTool["annotations"];
}

const DATA_360_TOOLS = defineTools([
  [
    "search",
    "Find Data 360 Connect API tool families that match a natural-language intent.",
    "API discovery",
    "read",
  ],
  [
    "payload_examples",
    "Return the input schema, example payload, and description for a named Data 360 tool.",
    "Payload inspection",
    "read",
  ],
  [
    "execute",
    "Dispatch a named Data 360 Connect API tool with a JSON payload.",
    "Connect API execution",
    "mixed",
  ],
]);

const BACKUP_RECOVER_TOOLS = defineTools([
  [
    "get_backups",
    "List backups for the org with pagination and sorting.",
    "Backup inspection",
    "read",
  ],
  [
    "get_backup_by_id",
    "Get the state, counts, and object detail for one backup.",
    "Backup inspection",
    "read",
  ],
  [
    "get_backup_objects",
    "Get the per-object breakdown for one backup.",
    "Backup inspection",
    "read",
  ],
  ["get_latest_policy", "Read the current backup ingestion policy.", "Backup policy", "read"],
  ["get_retention_rules", "Read the current backup retention rules.", "Backup policy", "read"],
  ["get_audit_events", "List Backup and Recover audit events.", "Backup audit", "read"],
  [
    "enqueue_backup",
    "Start an asynchronous on-demand backup using the configured policy.",
    "Backup execution",
    "write",
  ],
  [
    "get_activities",
    "List recent compare, restore, and download activities.",
    "Recovery activity",
    "read",
  ],
  [
    "get_restore_with_hierarchy",
    "Get the state of one restore-with-hierarchy activity.",
    "Restore inspection",
    "read",
  ],
  [
    "get_compare_activity",
    "Get the state and scope of one compare activity.",
    "Compare inspection",
    "read",
  ],
  [
    "get_compare_activity_summaries",
    "Get per-object change counts for a compare activity.",
    "Compare inspection",
    "read",
  ],
  [
    "get_restore_activity_record_selection_metadata",
    "Get record-selection metadata and preview for a restore activity.",
    "Restore selection",
    "read",
  ],
  [
    "get_selection_counts_by_type",
    "Get selected-for-restore counts for one object.",
    "Restore selection",
    "read",
  ],
  [
    "get_restore_result_counts",
    "Get insert and update result counts for one restored object.",
    "Restore results",
    "read",
  ],
  [
    "get_restore_activity",
    "Get a flat restore rollup and per-object breakdown.",
    "Restore inspection",
    "read",
  ],
  [
    "get_activity",
    "Look up an activity when its activity type is unknown.",
    "Recovery activity",
    "read",
  ],
  [
    "get_hierarchy_summary",
    "Get hierarchy change counts and restore status by node path.",
    "Restore inspection",
    "read",
  ],
  [
    "get_restore_activity_summary",
    "Get the per-object restore result summary.",
    "Restore results",
    "read",
  ],
  [
    "get_restore_activity_object_results",
    "Get per-record restore results for one object.",
    "Restore results",
    "read",
  ],
  [
    "get_restore_with_hierarchy_results",
    "Get per-record results for one hierarchy node path.",
    "Restore results",
    "read",
  ],
  [
    "create_compare_activity",
    "Create an asynchronous comparison between two backups.",
    "Compare execution",
    "write",
  ],
  [
    "update_selection_records",
    "Update the preview selection of records intended for restore.",
    "Restore selection",
    "write",
  ],
]);

const CONTENT_READ_TOOLS = defineTools([
  [
    "get_cms_workspace",
    "Get details for one Salesforce CMS workspace.",
    "Workspace discovery",
    "read",
  ],
  [
    "get_cms_workspaces",
    "List Salesforce CMS workspaces available to the current user.",
    "Workspace discovery",
    "read",
  ],
  [
    "get_cms_channels_for_workspace",
    "List channels associated with one CMS workspace.",
    "Channel discovery",
    "read",
  ],
  [
    "search_content_cms_workspaces",
    "Search CMS workspace and folder content by keyword.",
    "Content search",
    "read",
  ],
  [
    "get_cms_content_item",
    "Get one CMS content item and its translated variants.",
    "Content inspection",
    "read",
  ],
  ["get_cms_content_variant", "Get one CMS content variant.", "Content inspection", "read"],
  ["get_cms_folder", "Get details for one CMS workspace folder.", "Folder inspection", "read"],
  [
    "get_cms_folder_sharing_details",
    "Get sharing and permission settings for a CMS folder.",
    "Folder inspection",
    "read",
  ],
  [
    "get_cms_channels",
    "List CMS channels available to the current user.",
    "Channel discovery",
    "read",
  ],
  ["get_cms_channel", "Get details for one CMS channel.", "Channel inspection", "read"],
  [
    "get_cms_channel_delivery_detail",
    "Get the runtime delivery details for one CMS channel.",
    "Channel inspection",
    "read",
  ],
  [
    "search_content_cms_channels",
    "Search published non-media CMS channel content.",
    "Content search",
    "read",
  ],
  [
    "search_media_cms_channels",
    "Search published media assets in CMS channels.",
    "Media search",
    "read",
  ],
  [
    "get_published_cms_content_from_channel",
    "List content published to one CMS channel.",
    "Published content",
    "read",
  ],
  [
    "get_published_cms_content_from_site",
    "List CMS content published to one Experience Cloud site.",
    "Published content",
    "read",
  ],
  [
    "get_published_cms_content_item_from_site",
    "Get one published CMS item from an Experience Cloud site.",
    "Published content",
    "read",
  ],
  [
    "get_published_cms_collection_from_site",
    "Get one published CMS collection from an Experience Cloud site.",
    "Published content",
    "read",
  ],
  [
    "get_published_cms_content_item_from_channel",
    "Get one published CMS item from a channel.",
    "Published content",
    "read",
  ],
  [
    "get_published_cms_collection_from_channel",
    "Get one published CMS collection from a channel.",
    "Published content",
    "read",
  ],
  [
    "search_electronic_media",
    "Search media across Salesforce CMS and connected content systems.",
    "Media search",
    "read",
  ],
  [
    "get_brand_instructions",
    "Get instructions for extracting and applying a CMS brand.",
    "Brand guidance",
    "read",
  ],
  [
    "get_content_types_for_workspace",
    "List content types supported by one CMS workspace.",
    "Workspace discovery",
    "read",
  ],
]);

const CONTENT_WRITE_TOOLS = defineTools([
  [
    "update_cms_workspace_channels",
    "Update channel assignments for a CMS workspace.",
    "Workspace administration",
    "write",
  ],
  [
    "create_cms_workspace",
    "Create a Salesforce CMS workspace.",
    "Workspace administration",
    "write",
  ],
  [
    "update_cms_workspace",
    "Update the properties of a CMS workspace.",
    "Workspace administration",
    "write",
  ],
  [
    "create_cms_content",
    "Create a CMS content item in a workspace or folder.",
    "Content authoring",
    "write",
  ],
  [
    "create_cms_content_variant",
    "Create a variant for an existing CMS content item.",
    "Content authoring",
    "write",
  ],
  [
    "clone_cms_content",
    "Clone a CMS content item within its workspace.",
    "Content authoring",
    "write",
  ],
  [
    "update_cms_content_variant",
    "Update the body of an existing CMS content variant.",
    "Content authoring",
    "write",
  ],
  [
    "publish_cms_content",
    "Publish CMS content to one or more channels.",
    "Content publishing",
    "write",
  ],
  [
    "unpublish_cms_content",
    "Remove CMS content from one or more channels.",
    "Content publishing",
    "write",
  ],
  ["create_cms_folder", "Create a folder in a CMS workspace.", "Folder administration", "write"],
  ["update_cms_folder", "Update the name of a CMS folder.", "Folder administration", "write"],
  [
    "update_cms_folder_sharing_settings",
    "Update sharing settings for a CMS folder.",
    "Folder administration",
    "write",
  ],
  ["create_cms_channel", "Create a CMS delivery channel.", "Channel administration", "write"],
  [
    "update_cms_channel",
    "Update the properties of a CMS channel.",
    "Channel administration",
    "write",
  ],
  [
    "get_or_create_cms_workspace_and_web_app_channel",
    "Get or create a CMS workspace and Web Apps channel for a UI Bundle.",
    "Workspace administration",
    "write",
  ],
]);

const HEADLESS_360_TOOLS = defineTools([
  [
    "discover",
    "Find Salesforce operations by natural-language intent.",
    "Operation discovery",
    "read",
  ],
  [
    "describe",
    "Get the technical contract and ordered steps for one operation.",
    "Contract inspection",
    "read",
  ],
  [
    "dispatch",
    "Invoke a selected Salesforce operation through its HTTP contract.",
    "Mixed operation execution",
    "mixed",
  ],
  [
    "dispatch_readonly",
    "Invoke a selected Salesforce operation using read-only GET access.",
    "Read-only execution",
    "read",
  ],
]);

const TABLEAU_NEXT_TOOLS = defineTools([
  [
    "analyze_data",
    "Ask a natural-language analytical question against a semantic model.",
    "Data analysis",
    "read",
  ],
  [
    "list_dashboards",
    "List Tableau Next dashboards available to the current user.",
    "Dashboard discovery",
    "read",
  ],
  ["get_dashboard", "Get details for one Tableau Next dashboard.", "Dashboard inspection", "read"],
  ["list_visualizations", "List Tableau Next visualizations.", "Visualization discovery", "read"],
  [
    "get_visualization",
    "Get details for one Tableau Next visualization.",
    "Visualization inspection",
    "read",
  ],
  [
    "list_semantic_models",
    "List semantic models available to the current user.",
    "Semantic model discovery",
    "read",
  ],
  [
    "get_semantic_model",
    "Get the complete profile of one semantic model.",
    "Semantic model inspection",
    "read",
  ],
  [
    "list_semantic_model_data_objects",
    "List data objects in one semantic model.",
    "Semantic model structure",
    "read",
  ],
  [
    "list_semantic_model_relationships",
    "List relationships in one semantic model.",
    "Semantic model structure",
    "read",
  ],
  [
    "get_semantic_model_logical_view",
    "Get the structure of one semantic-model logical view.",
    "Semantic model structure",
    "read",
  ],
  [
    "list_semantic_model_measures",
    "List measures for a semantic-model data object.",
    "Business definitions",
    "read",
  ],
  [
    "list_semantic_model_dimensions",
    "List dimensions for a semantic-model data object.",
    "Business definitions",
    "read",
  ],
  [
    "list_semantic_model_metrics",
    "List metrics and KPIs in a semantic model.",
    "Business definitions",
    "read",
  ],
  [
    "get_semantic_model_metric",
    "Get the complete definition of one metric or KPI.",
    "Business definitions",
    "read",
  ],
  [
    "list_semantic_model_calculated_dimensions",
    "List calculated dimensions in a semantic model.",
    "Business definitions",
    "read",
  ],
  [
    "list_semantic_model_calculated_measures",
    "List calculated measures in a semantic model.",
    "Business definitions",
    "read",
  ],
  [
    "list_workspaces",
    "List Tableau Next workspaces available to the current user.",
    "Workspace discovery",
    "read",
  ],
  [
    "list_workspace_assets",
    "List assets contained in one Tableau Next workspace.",
    "Asset discovery",
    "read",
  ],
  [
    "search_assets",
    "Search dashboards, visualizations, and semantic models.",
    "Asset discovery",
    "read",
  ],
]);

const CRM_ANALYTICS_TOOLS = defineTools([
  [
    "list_folders",
    "List CRM Analytics apps available to the current user.",
    "App discovery",
    "read",
  ],
  ["get_folder", "Get metadata for one CRM Analytics app.", "App inspection", "read"],
  [
    "list_datasets",
    "List CRM Analytics datasets in an app or across the org.",
    "Dataset discovery",
    "read",
  ],
  ["get_dataset", "Get field and version metadata for one dataset.", "Dataset inspection", "read"],
  ["get_xmd", "Get extended metadata for one dataset version.", "Schema inspection", "read"],
  ["execute_query", "Execute a SAQL query and return structured results.", "Data analysis", "read"],
  ["list_dashboards", "List CRM Analytics dashboards.", "Dashboard discovery", "read"],
  [
    "get_dashboard",
    "Get metadata, widgets, steps, and filters for one dashboard.",
    "Dashboard inspection",
    "read",
  ],
  [
    "list_lenses",
    "List saved CRM Analytics explorations available to the user.",
    "Lens discovery",
    "read",
  ],
  [
    "get_lens",
    "Get the query definition and dataset reference for one lens.",
    "Lens inspection",
    "read",
  ],
]);

const TRAILHEAD_TOOLS = defineTools([
  [
    "content_search",
    "Search public Trailhead learning content by topic, role, and skill level.",
    "Learning content discovery",
    "read",
  ],
  [
    "fetch_content",
    "Retrieve complete public Trailhead badge or trail content as Markdown.",
    "Learning content retrieval",
    "read",
  ],
]);

const EMPTY_TOOLS: readonly DocumentedMcpTool[] = [];

const CATALOGS: Record<McpPresetId, PresetToolCatalog> = {
  "salesforce-dx": {
    capabilities: [
      "Salesforce org lifecycle",
      "Metadata deployment and retrieval",
      "Record queries",
      "User access management",
      "Apex and Agentforce testing",
    ],
    tools: SALESFORCE_DX_TOOLS,
    note: "This reviewed contract covers the GA tools in the configured core, orgs, metadata, data, users, and testing toolsets. Non-GA tools require a separate server flag and remain unavailable.",
  },
  data360: {
    capabilities: ["Connect API discovery", "Payload and schema inspection", "Data 360 execution"],
    tools: DATA_360_TOOLS,
  },
  "backup-recover": {
    capabilities: [
      "Backup inspection and policy",
      "On-demand backup",
      "Compare and restore selection",
      "Restore results",
    ],
    tools: BACKUP_RECOVER_TOOLS,
  },
  "content-readonly": {
    capabilities: [
      "Workspace and folder discovery",
      "Published content",
      "Channel and media search",
      "Brand guidance",
    ],
    tools: CONTENT_READ_TOOLS,
  },
  "content-write": {
    capabilities: [
      "Workspace administration",
      "Content authoring",
      "Publishing",
      "Channel and folder administration",
    ],
    tools: CONTENT_WRITE_TOOLS,
  },
  "headless-360": {
    capabilities: [
      "Operation discovery",
      "Contract inspection",
      "Read-only dispatch",
      "Mixed operation dispatch",
    ],
    tools: HEADLESS_360_TOOLS,
    note: "Dispatch is a meta-tool. Pi can expose or hide dispatch, but it cannot select individual operations behind it.",
  },
  tableau: {
    capabilities: [
      "Content and project discovery",
      "Governed data analysis",
      "Pulse insights",
      "Prep flow operations",
      "Site administration",
    ],
    tools: TABLEAU_MCP_TOOLS,
    note: "This is Tableau's standalone hosted stack. It is separate from the Salesforce-hosted Tableau Next semantic-layer server.",
  },
  "tableau-next": {
    capabilities: [
      "Natural-language analysis",
      "Dashboards and visualizations",
      "Semantic models and metrics",
      "Asset discovery",
    ],
    tools: TABLEAU_NEXT_TOOLS,
  },
  "crm-analytics": {
    capabilities: ["Apps and datasets", "Dataset schema", "SAQL analysis", "Dashboards and lenses"],
    tools: CRM_ANALYTICS_TOOLS,
  },
  "marketing-cloud": {
    capabilities: [
      "Automations and campaigns",
      "Contacts, content, and data extensions",
      "Email, SMS, and push",
      "Journeys and tracking",
    ],
    tools: MARKETING_CLOUD_TOOLS,
    note: "Availability is permission-scoped by the installed Marketing Cloud package. The connected server can advertise a subset of this reviewed contract.",
  },
  "mulesoft-dx": {
    capabilities: [
      "API design",
      "Exchange assets",
      "Deployment and policies",
      "Anypoint Platform operations",
    ],
    tools: MULESOFT_DX_TOOLS,
    note: "Some documented tools require Anypoint Code Builder or Connector Builder and become unavailable when the connected server does not advertise them.",
  },
  "agentforce-sales": {
    capabilities: [
      "Prioritize sales leads and opportunities",
      "Read live Salesforce sales context",
      "Delegate prospect engagement",
      "Update sales records",
      "Generate and save account plans",
    ],
    tools: EMPTY_TOOLS,
    note: "Salesforce documents this Beta server for the Agentforce Sales ChatGPT app but does not publish an exact tool reference. Tools appear after connection and remain outside the reviewed per-tool policy until Salesforce publishes their contract.",
  },
  slack: {
    capabilities: [
      "Workspace search",
      "Messages and channels",
      "Files and canvases",
      "Users, reactions, and lists",
    ],
    tools: EMPTY_TOOLS,
    note: "Slack publishes its capability surface but not a stable exact tool-name contract. The connection starts Hidden; observed tools remain quarantined pending a reviewed contract.",
  },
  "informatica-catalog": {
    capabilities: [
      "Governed catalog discovery",
      "Metadata and lineage",
      "Classifications and business context",
    ],
    tools: EMPTY_TOOLS,
    note: "The pod-specific OAuth connection is documented, but the exact tool-name contract is not. Observed tools remain quarantined pending review.",
  },
  "informatica-data-exploration": {
    capabilities: [
      "Governed dataset exploration",
      "Attribute telemetry",
      "CLAIRE-assisted data analysis",
    ],
    tools: EMPTY_TOOLS,
    note: "The pod-specific OAuth connection is documented, but the exact tool-name contract is not. Observed tools remain quarantined pending review.",
  },
  "b2c-commerce": {
    capabilities: [
      "B2C Commerce documentation and skills",
      "Cartridge and Managed Runtime deployment",
      "Diagnostics and script debugging",
      "SCAPI, WebDAV, and Commerce analytics",
    ],
    tools: B2C_COMMERCE_TOOLS,
    note: "This reviewed contract follows the GA @salesforce/b2c-dx-mcp package. Tool availability still depends on local project configuration and B2C Commerce credentials.",
  },
  "custom-salesforce": {
    capabilities: ["Runtime-declared custom capabilities"],
    tools: EMPTY_TOOLS,
    note: "Custom server tools remain quarantined and appear here only after the server has been configured and observed.",
  },
  trailhead: {
    capabilities: [
      "Public Trailhead content search",
      "Role and skill-level filtering",
      "Badge and trail retrieval",
    ],
    tools: TRAILHEAD_TOOLS,
    note: "Trailhead MCP is read-only, requires no authentication, and doesn't access learner progress or private account data.",
  },
};

export function getPresetToolCatalog(preset: McpPreset): PresetToolCatalog {
  return CATALOGS[preset.id];
}

export function inspectPresetTools(preset: McpPreset): McpToolDetail[] {
  const catalog = getPresetToolCatalog(preset);
  const documented = new Map(catalog.tools.map((tool) => [tool.name, tool]));
  const observed = new Map(getObservedMcpTools(preset).map((tool) => [tool.name, tool]));
  const documentedNames = [...documented.keys()];
  const observedOnlyNames = [...observed.keys()]
    .filter((name) => !documented.has(name))
    .sort((left, right) => left.localeCompare(right));
  return [...documentedNames, ...observedOnlyNames].map((name) =>
    mergeTool(name, documented.get(name), observed.get(name)),
  );
}

function mergeTool(
  name: string,
  documented: DocumentedMcpTool | undefined,
  observed: ObservedMcpTool | undefined,
): McpToolDetail {
  const descriptionSource = observed?.description ? "observed" : "documented";
  return {
    name,
    description:
      observed?.description ??
      documented?.description ??
      "The connected MCP server supplied no description for this tool.",
    capability: documented?.capability ?? "Runtime-declared capability",
    risk: documented?.risk ?? riskFromAnnotations(observed?.annotations),
    documented: documented !== undefined,
    observed: observed !== undefined,
    descriptionSource,
    ...(observed?.exposure ? { exposure: observed.exposure } : {}),
    ...(observed?.parameters ? { parameters: observed.parameters } : {}),
    ...(observed?.annotations ? { annotations: observed.annotations } : {}),
  };
}

function riskFromAnnotations(annotations: ObservedMcpTool["annotations"]): McpToolRisk {
  if (annotations?.readOnlyHint === true) return "read";
  if (annotations?.destructiveHint === true) return "destructive";
  if (annotations?.readOnlyHint === false && annotations.destructiveHint === false) return "write";
  return "unknown";
}
