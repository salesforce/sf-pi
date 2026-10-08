/* SPDX-License-Identifier: Apache-2.0 */
/** Plan-bound agent surface for Salesforce MCP native configuration. */
import { createHash } from "node:crypto";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  hostedConnectionName,
  resolveHostedOrgBinding,
  type HostedMcpOrgBinding,
  type HostedOrgBindingResolver,
} from "./hosted-org-binding.ts";
import { fingerprintConfig } from "./managed-state.ts";
import { canonicalMcpServerName, mcpConfigPath, type McpServerConfig } from "./mcp-config.ts";
import {
  installPreset,
  inspectPresetInstances,
  inspectPresetRuntime,
  setManagedPresetEnabled,
  summarizeConfigDiff,
  updateManagedPresetToolPolicy,
} from "./service.ts";
import { buildConflictAwareToolPolicy, inspectActiveToolConflicts } from "./tool-conflicts.ts";
import {
  applyToolExposurePolicy,
  buildToolExposurePolicy,
  customizeToolExposure,
  hasReviewedToolPolicy,
  type ToolExposureMode,
  type ToolPolicyProfile,
  type ToolExposurePolicy,
} from "./tool-policy.ts";
import {
  approvedToolsForResolution,
  buildServerConfig,
  getPreset,
  hostedServerPath,
  SALESFORCE_MCP_PRESETS,
  type McpPreset,
  type McpPresetId,
  type PresetSetup,
} from "./presets.ts";

const SF_MCP_ACTIONS = [
  "status",
  "conflicts",
  "connection.plan",
  "connection.apply",
  "tools.plan",
  "tools.apply",
  "configure.plan",
  "configure.apply",
  "disable.plan",
  "disable.apply",
  "login.handoff",
  "identity.verify",
] as const;
const SCOPES = ["global", "project"] as const;
const CONFIGURE_RESOLUTIONS = ["enable", "complement-native", "side-by-side"] as const;
const TOOL_PROFILES = ["recommended", "read-only", "all-approved", "quarantine"] as const;
const TOOL_EXPOSURES = ["hidden", "codemode", "deferred", "direct"] as const;
const ENVIRONMENTS = ["production", "sandbox"] as const;
const REGIONS = ["US", "EU", "PROD_US", "PROD_EU", "PROD_CA", "PROD_JP"] as const;

type SfMcpAction = (typeof SF_MCP_ACTIONS)[number];
type SfMcpScope = (typeof SCOPES)[number];
type ConfigureResolution = (typeof CONFIGURE_RESOLUTIONS)[number];

interface SfMcpParams {
  action: SfMcpAction;
  scope?: SfMcpScope;
  preset_id?: string;
  target_org?: string;
  connection_name?: string;
  resolution?: ConfigureResolution;
  environment?: PresetSetup["environment"];
  oauth_client_id?: string;
  region?: PresetSetup["region"];
  tenant_id?: string;
  marketing_client_id?: string;
  server_url?: string;
  custom_url?: string;
  tool_profile?: Exclude<ToolPolicyProfile, "custom">;
  tool_overrides?: Record<string, ToolExposureMode>;
  replace_existing?: boolean;
  plan_id?: string;
  plan_hash?: string;
  allow_mutation?: boolean;
}

interface PlanBase {
  kind: "configure" | "connection" | "tools" | "disable";
  planId: string;
  planHash: string;
  cwd: string;
  scope: SfMcpScope;
  presetId: McpPresetId;
  presetRevision: number;
  connectionName: string;
  orgBinding?: HostedMcpOrgBinding;
  sourceVersion: string;
  willChange: boolean;
}

interface ConfigurePlan extends PlanBase {
  kind: "configure";
  resolution: ConfigureResolution;
  setup: PresetSetup;
  toolPolicy?: ToolExposurePolicy;
  replaceExisting: boolean;
  proposedConfig: McpServerConfig;
  diff: string[];
}

interface ConnectionPlan extends PlanBase {
  kind: "connection";
  resolution: ConfigureResolution;
  setup: PresetSetup;
  toolPolicy?: ToolExposurePolicy;
  replaceExisting: boolean;
  proposedConfig: McpServerConfig;
  diff: string[];
}

interface ToolsPlan extends PlanBase {
  kind: "tools";
  policy: ToolExposurePolicy;
  proposedConfig: McpServerConfig;
  diff: string[];
}

interface DisablePlan extends PlanBase {
  kind: "disable";
}

type SfMcpPlan = ConfigurePlan | ConnectionPlan | ToolsPlan | DisablePlan;

const Params = Type.Object({
  action: StringEnum(SF_MCP_ACTIONS, { description: "SF MCP configuration lifecycle action." }),
  scope: Type.Optional(
    StringEnum(SCOPES, {
      description: "Native MCP configuration scope. Mutating actions require an explicit scope.",
    }),
  ),
  preset_id: Type.Optional(
    Type.String({ description: "Salesforce MCP preset id, for example headless-360." }),
  ),
  target_org: Type.Optional(
    Type.String({
      description:
        "Explicit Salesforce org alias or username used to create an org-pinned hosted MCP connection.",
    }),
  ),
  connection_name: Type.Optional(
    Type.String({
      description:
        "Exact Pi MCP server name. Automatically derived from the target org alias when omitted.",
    }),
  ),
  resolution: Type.Optional(
    StringEnum(CONFIGURE_RESOLUTIONS, {
      description: "Conflict resolution for configure.plan.",
    }),
  ),
  environment: Type.Optional(
    StringEnum(ENVIRONMENTS, {
      description: "Salesforce hosted endpoint family.",
    }),
  ),
  oauth_client_id: Type.Optional(
    Type.String({ description: "Public OAuth client identifier for the selected preset." }),
  ),
  region: Type.Optional(StringEnum(REGIONS, { description: "Preset-specific service region." })),
  tenant_id: Type.Optional(Type.String({ description: "Preset-specific tenant id." })),
  marketing_client_id: Type.Optional(
    Type.String({ description: "Marketing Cloud public client identifier." }),
  ),
  server_url: Type.Optional(Type.String({ description: "Preset-specific HTTPS MCP server URL." })),
  custom_url: Type.Optional(Type.String({ description: "HTTPS URL for the custom preset." })),
  tool_profile: Type.Optional(
    StringEnum(TOOL_PROFILES, {
      description: "Reviewed per-tool exposure profile. Defaults to recommended.",
    }),
  ),
  tool_overrides: Type.Optional(
    Type.Record(Type.String(), StringEnum(TOOL_EXPOSURES), {
      description: "Exact reviewed tool-name exposure overrides for tools.plan.",
    }),
  ),
  replace_existing: Type.Optional(
    Type.Boolean({
      description:
        "Include a reviewed replacement of a manual, modified, outdated, or project-override entry.",
    }),
  ),
  plan_id: Type.Optional(Type.String({ description: "Exact session-bound plan id." })),
  plan_hash: Type.Optional(Type.String({ description: "Exact source-bound plan hash." })),
  allow_mutation: Type.Optional(
    Type.Boolean({
      description:
        "Required for configure.apply and disable.apply. Guardrail approval remains separate.",
    }),
  ),
});

export interface SfMcpToolDependencies {
  resolveHostedOrgBinding: HostedOrgBindingResolver;
}

const DEFAULT_DEPENDENCIES: SfMcpToolDependencies = {
  resolveHostedOrgBinding,
};

export function registerSfMcpTool(
  pi: ExtensionAPI,
  overrides: Partial<SfMcpToolDependencies> = {},
): void {
  const plans = new Map<string, SfMcpPlan>();
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };

  pi.registerTool<typeof Params>({
    name: "sf_mcp",
    label: "SF MCP",
    description:
      "Inspect, plan, apply, disable, and hand off Salesforce MCP presets to Pi's native MCP runtime. Connection/authentication and tool access can be planned independently; durable configuration is source-bound, diff-reviewed, and Guardrail-mediated.",
    promptSnippet:
      "Configure reviewed Salesforce MCP connections and tool access in Pi without directly editing mcp.json.",
    promptGuidelines: [
      "Use status first. Prefer connection.plan/apply for URL and authentication, then tools.plan/apply for reviewed exposure; configure.plan/apply remains the combined compatibility path.",
      "Use sf_integrate for Salesforce-side External Client App setup. Pass the public consumer key as oauth_client_id and the same explicit target_org so SF MCP can prove an org-pinned endpoint.",
      "One hosted preset can have multiple org-bound connection instances. Pass connection_name when an action would otherwise be ambiguous.",
      "If org-pinned discovery reports no trusted My Domain or an issuer mismatch, use sf_browser_open_org with the my-domain Setup destination to inspect readiness; never rename an existing domain automatically.",
      "Mutating applies require an explicit global or trusted-project scope plus allow_mutation=true and remain SF Guardrail-mediated.",
      "Use the recommended tool profile unless the user explicitly requests another reviewed exposure profile.",
      "Use login.handoff after apply. OAuth login and browser consent remain human-controlled through Pi's native /mcp runtime.",
      "After login and recommended tool exposure, run identity.verify to compare the Headless 360 userinfo organization id with the planned org binding.",
    ],
    parameters: Params,
    async execute(_id, rawParams, signal, _onUpdate, ctx) {
      const params = rawParams as SfMcpParams;
      try {
        const scope = resolveScope(params);
        requireTrustedScope(scope, ctx.isProjectTrusted());
        switch (params.action) {
          case "status":
            return statusResult(ctx.cwd, scope, params.preset_id);
          case "conflicts":
            return conflictsResult(ctx.cwd, scope, params);
          case "connection.plan": {
            const plan = await createConnectionPlan(ctx.cwd, scope, params, dependencies, signal);
            plans.set(plan.planId, plan);
            return connectionPlanResult(
              plan,
              inspectPresetRuntime(ctx.cwd, scope, getPreset(plan.presetId)),
            );
          }
          case "connection.apply": {
            requireMutationIntent(params);
            const plan = requirePlan(plans, params, "connection", ctx.cwd, scope);
            return await applyConnectionPlan(plans, plan, dependencies, signal);
          }
          case "tools.plan": {
            const plan = createToolsPlan(ctx.cwd, scope, params);
            plans.set(plan.planId, plan);
            return toolsPlanResult(plan);
          }
          case "tools.apply": {
            requireMutationIntent(params);
            const plan = requirePlan(plans, params, "tools", ctx.cwd, scope);
            return applyToolsPlan(plans, plan);
          }
          case "configure.plan": {
            const plan = await createConfigurePlan(ctx.cwd, scope, params, dependencies, signal);
            plans.set(plan.planId, plan);
            return configurePlanResult(
              plan,
              inspectPresetRuntime(ctx.cwd, scope, getPreset(plan.presetId)),
            );
          }
          case "configure.apply": {
            requireMutationIntent(params);
            const plan = requirePlan(plans, params, "configure", ctx.cwd, scope);
            return await applyConfigurePlan(plans, plan, dependencies, signal);
          }
          case "disable.plan": {
            const plan = createDisablePlan(ctx.cwd, scope, params);
            plans.set(plan.planId, plan);
            return disablePlanResult(plan);
          }
          case "disable.apply": {
            requireMutationIntent(params);
            const plan = requirePlan(plans, params, "disable", ctx.cwd, scope);
            return applyDisablePlan(plans, plan);
          }
          case "login.handoff":
            return loginHandoffResult(ctx.cwd, scope, params);
          case "identity.verify":
            return await identityVerifyResult(ctx.cwd, scope, params, (name, args) =>
              ctx.executeTool(name, args, { signal }),
            );
          default:
            throw new Error(`Unsupported sf_mcp action: ${String(params.action)}`);
        }
      } catch (error) {
        return errorResult(params.action, error);
      }
    },
  });
}

function statusResult(cwd: string, scope: SfMcpScope, presetId?: string) {
  const presets = presetId ? [getPreset(presetId)] : SALESFORCE_MCP_PRESETS;
  const rows = presets.map((preset) => {
    const instances = inspectPresetInstances(cwd, scope, preset);
    const connections = instances
      .filter((state) => state.managed.status !== "missing")
      .map((state) => ({
        serverName: state.managed.configuredName ?? state.connectionName,
        status: state.managed.status,
        targetOrg: state.managed.record?.orgBinding?.targetOrg,
        orgType: state.managed.record?.orgBinding?.orgType,
        identityBound: Boolean(state.managed.record?.orgBinding?.orgId),
      }));
    const primary = connections[0] ?? {
      serverName: preset.serverName,
      status: "missing" as const,
      targetOrg: undefined,
      orgType: undefined,
      identityBound: false,
    };
    const state = instances[0] ?? inspectPresetRuntime(cwd, scope, preset);
    return {
      presetId: preset.id,
      label: preset.label,
      serverName: primary.serverName,
      status: primary.status,
      connections,
      conflictOwners: state.plan.conflicts.map((conflict) => conflict.nativeExtensionId),
      scopeConflict: state.scopeConflict?.kind,
    };
  });
  const body = [
    `Salesforce MCP presets — ${scope} scope`,
    `Native config: ${mcpConfigPath(cwd, scope)}`,
    ...rows.map(
      (row) =>
        `${row.presetId}: ${row.status}` +
        (row.connections.length > 1 ? ` · ${row.connections.length} connections` : "") +
        (row.conflictOwners.length ? ` · overlaps ${row.conflictOwners.join(", ")}` : "") +
        (row.scopeConflict ? ` · ${row.scopeConflict}` : ""),
    ),
  ].join("\n");
  return successResult(body, { ok: true, action: "status", scope, presets: rows });
}

function conflictsResult(cwd: string, scope: SfMcpScope, params: SfMcpParams) {
  const preset = requiredPreset(params);
  const state = inspectPresetRuntime(cwd, scope, preset);
  const conflicts = inspectActiveToolConflicts(preset, state.plan);
  const body = [
    `${preset.label} tool conflicts — ${scope} scope`,
    conflicts.length === 0
      ? "No exact reviewed tool conflicts are active."
      : `${conflicts.length} exact reviewed conflict${conflicts.length === 1 ? "" : "s"}:`,
    ...conflicts.map(
      (conflict) =>
        `- ${conflict.toolName}: ${conflict.owners.join(", ")} · recommended ${conflict.recommendedExposure}`,
    ),
    `Recommendation: ${state.plan.recommendation.summary}`,
  ].join("\n");
  return successResult(body, {
    ok: true,
    action: "conflicts",
    scope,
    presetId: preset.id,
    recommendation: state.plan.recommendation,
    conflicts,
  });
}

async function createConnectionPlan(
  cwd: string,
  scope: SfMcpScope,
  params: SfMcpParams,
  dependencies: SfMcpToolDependencies,
  signal?: AbortSignal,
): Promise<ConnectionPlan> {
  const preset = requiredPreset(params);
  const target = await resolveConnectionTarget(cwd, scope, params, preset, dependencies, signal);
  const state = inspectPresetRuntime(cwd, scope, preset, target.connectionName);
  assertPlannableState(
    state.managed.status,
    state.managed.message,
    params.replace_existing === true,
  );
  const resolution = params.resolution ?? connectionResolution(state);
  const setup = {
    ...presetSetup(params),
    ...(target.orgBinding ? { serverUrl: target.orgBinding.serverUrl } : {}),
  };
  const toolPolicy = hasReviewedToolPolicy(preset)
    ? state.managed.config
      ? buildToolExposurePolicy(preset, "custom", state.managed.config)
      : buildToolExposurePolicy(preset, "quarantine")
    : undefined;
  const proposedConfig = buildServerConfig(preset, resolution, setup, toolPolicy?.exposures);
  const diff = summarizeConfigDiff(state.managed.config ?? state.managed.override, proposedConfig);
  const sourceVersion = sourceVersionFor(cwd, scope, preset, target.connectionName);
  const replaceExisting = params.replace_existing === true;
  const willChange =
    state.managed.status !== "managed-enabled" ||
    !state.managed.config ||
    fingerprintConfig(state.managed.config) !== fingerprintConfig(proposedConfig);
  const identity = planIdentity({
    kind: "connection",
    cwd,
    scope,
    presetId: preset.id,
    presetRevision: preset.revision,
    connectionName: target.connectionName,
    orgBinding: target.orgBinding,
    resolution,
    setup,
    toolPolicy: toolPolicy?.exposures,
    replaceExisting,
    proposedConfig,
    sourceVersion,
  });
  return {
    kind: "connection",
    ...identity,
    cwd,
    scope,
    presetId: preset.id,
    presetRevision: preset.revision,
    connectionName: target.connectionName,
    ...(target.orgBinding ? { orgBinding: target.orgBinding } : {}),
    sourceVersion,
    willChange,
    resolution,
    setup,
    toolPolicy,
    replaceExisting,
    proposedConfig,
    diff,
  };
}

function connectionPlanResult(
  plan: ConnectionPlan,
  state: ReturnType<typeof inspectPresetRuntime>,
) {
  return configurationPlanResult("connection.plan", plan, state, [
    "Tool access: preserved when managed; otherwise all reviewed tools start Hidden.",
  ]);
}

async function applyConnectionPlan(
  plans: Map<string, SfMcpPlan>,
  plan: ConnectionPlan,
  dependencies: SfMcpToolDependencies,
  signal?: AbortSignal,
) {
  assertCurrentSource(plan);
  await assertCurrentOrgBinding(plan, dependencies, signal);
  if (!plan.willChange) {
    plans.delete(plan.planId);
    return successResult(
      `${getPreset(plan.presetId).label} connection already matches the reviewed plan.`,
      {
        ok: true,
        action: "connection.apply",
        scope: plan.scope,
        presetId: plan.presetId,
        connectionName: plan.connectionName,
        changed: false,
        verified: true,
        reloadRequired: false,
      },
    );
  }
  const result = installPreset({
    cwd: plan.cwd,
    scope: plan.scope,
    presetId: plan.presetId,
    resolution: plan.resolution,
    setup: plan.setup,
    replaceExisting: plan.replaceExisting,
    toolPolicy: plan.toolPolicy,
    connectionName: plan.connectionName,
    ...(plan.orgBinding ? { orgBinding: plan.orgBinding } : {}),
  });
  if (!result.ok) throw new Error(result.message);
  const verified = inspectPresetRuntime(
    plan.cwd,
    plan.scope,
    getPreset(plan.presetId),
    plan.connectionName,
  );
  if (
    verified.managed.status !== "managed-enabled" ||
    !verified.managed.config ||
    fingerprintConfig(verified.managed.config) !== fingerprintConfig(plan.proposedConfig) ||
    verified.managed.record?.orgBinding?.orgId !== plan.orgBinding?.orgId
  ) {
    throw new Error(
      `${getPreset(plan.presetId).label} connection was written but exact resulting-state verification failed.`,
    );
  }
  plans.delete(plan.planId);
  return successResult(`${result.message}\nVerification: matched.`, {
    ok: true,
    action: "connection.apply",
    scope: plan.scope,
    presetId: plan.presetId,
    connectionName: plan.connectionName,
    targetOrg: plan.orgBinding?.targetOrg,
    changed: result.changed,
    verified: true,
    reloadRequired: result.reloadRequired,
  });
}

function createToolsPlan(cwd: string, scope: SfMcpScope, params: SfMcpParams): ToolsPlan {
  const preset = requiredPreset(params);
  const connectionName = resolveExistingConnectionName(cwd, scope, preset, params.connection_name);
  const state = inspectPresetRuntime(cwd, scope, preset, connectionName);
  if (
    (state.managed.status !== "managed-enabled" && state.managed.status !== "managed-disabled") ||
    !state.managed.config
  ) {
    throw new Error(
      `${preset.label} connection must be an unchanged managed entry before planning tool access.`,
    );
  }
  let policy = reviewedToolPolicy(preset, state.plan, params.tool_profile ?? "recommended");
  if (!policy) {
    throw new Error(
      `${preset.label} has no reviewed exact tool contract; its tools remain Hidden.`,
    );
  }
  for (const [toolName, exposure] of Object.entries(params.tool_overrides ?? {})) {
    policy = customizeToolExposure(preset, policy, toolName, exposure);
  }
  const proposedConfig = applyToolExposurePolicy(
    preset,
    state.managed.config,
    policy,
    approvedToolsForResolution(preset, state.managed.record?.resolution ?? "enable"),
  );
  const diff = summarizeConfigDiff(state.managed.config, proposedConfig);
  const sourceVersion = sourceVersionFor(cwd, scope, preset, connectionName);
  const willChange = fingerprintConfig(state.managed.config) !== fingerprintConfig(proposedConfig);
  const identity = planIdentity({
    kind: "tools",
    cwd,
    scope,
    presetId: preset.id,
    presetRevision: preset.revision,
    connectionName,
    policy,
    proposedConfig,
    sourceVersion,
  });
  return {
    kind: "tools",
    ...identity,
    cwd,
    scope,
    presetId: preset.id,
    presetRevision: preset.revision,
    connectionName,
    ...(state.managed.record?.orgBinding ? { orgBinding: state.managed.record.orgBinding } : {}),
    sourceVersion,
    willChange,
    policy,
    proposedConfig,
    diff,
  };
}

function toolsPlanResult(plan: ToolsPlan) {
  return successResult(
    [
      `REVIEW: ${getPreset(plan.presetId).label} MCP tool-access plan.`,
      `Plan ID: ${plan.planId}`,
      `Plan hash: ${plan.planHash}`,
      `Scope: ${plan.scope}`,
      `Connection: ${plan.connectionName}`,
      `Profile: ${plan.policy.profile}`,
      `Change required: ${plan.willChange ? "yes" : "no"}`,
      "Changes:",
      ...(plan.diff.length ? plan.diff.map((line) => `- ${line}`) : ["- none"]),
    ].join("\n"),
    {
      ok: true,
      action: "tools.plan",
      scope: plan.scope,
      presetId: plan.presetId,
      connectionName: plan.connectionName,
      planId: plan.planId,
      planHash: plan.planHash,
      sourceVersion: plan.sourceVersion,
      willChange: plan.willChange,
      profile: plan.policy.profile,
      exposures: plan.policy.exposures,
      diff: plan.diff,
    },
  );
}

function applyToolsPlan(plans: Map<string, SfMcpPlan>, plan: ToolsPlan) {
  assertCurrentSource(plan);
  if (!plan.willChange) {
    plans.delete(plan.planId);
    return successResult(
      `${getPreset(plan.presetId).label} tool access already matches the reviewed plan.`,
      {
        ok: true,
        action: "tools.apply",
        scope: plan.scope,
        presetId: plan.presetId,
        connectionName: plan.connectionName,
        changed: false,
        verified: true,
        reloadRequired: false,
      },
    );
  }
  const result = updateManagedPresetToolPolicy({
    cwd: plan.cwd,
    scope: plan.scope,
    presetId: plan.presetId,
    policy: plan.policy,
    connectionName: plan.connectionName,
  });
  if (!result.ok) throw new Error(result.message);
  const verified = inspectPresetRuntime(
    plan.cwd,
    plan.scope,
    getPreset(plan.presetId),
    plan.connectionName,
  );
  if (
    !verified.managed.config ||
    fingerprintConfig(verified.managed.config) !== fingerprintConfig(plan.proposedConfig)
  ) {
    throw new Error(
      `${getPreset(plan.presetId).label} tool access was written but exact resulting-state verification failed.`,
    );
  }
  plans.delete(plan.planId);
  return successResult(`${result.message}\nVerification: matched.`, {
    ok: true,
    action: "tools.apply",
    scope: plan.scope,
    presetId: plan.presetId,
    connectionName: plan.connectionName,
    changed: result.changed,
    verified: true,
    reloadRequired: result.reloadRequired,
  });
}

async function createConfigurePlan(
  cwd: string,
  scope: SfMcpScope,
  params: SfMcpParams,
  dependencies: SfMcpToolDependencies,
  signal?: AbortSignal,
): Promise<ConfigurePlan> {
  const preset = requiredPreset(params);
  const resolution = requiredResolution(params);
  const target = await resolveConnectionTarget(cwd, scope, params, preset, dependencies, signal);
  const state = inspectPresetRuntime(cwd, scope, preset, target.connectionName);
  assertPlannableState(
    state.managed.status,
    state.managed.message,
    params.replace_existing === true,
  );
  const setup = {
    ...presetSetup(params),
    ...(target.orgBinding ? { serverUrl: target.orgBinding.serverUrl } : {}),
  };
  const toolPolicy = reviewedToolPolicy(preset, state.plan, params.tool_profile ?? "recommended");
  const proposedConfig = buildServerConfig(preset, resolution, setup, toolPolicy?.exposures);
  const diff = summarizeConfigDiff(state.managed.config ?? state.managed.override, proposedConfig);
  const sourceVersion = sourceVersionFor(cwd, scope, preset, target.connectionName);
  const replaceExisting = params.replace_existing === true;
  const willChange =
    state.managed.status !== "managed-enabled" ||
    !state.managed.config ||
    fingerprintConfig(state.managed.config) !== fingerprintConfig(proposedConfig);
  const identity = planIdentity({
    kind: "configure",
    cwd,
    scope,
    presetId: preset.id,
    presetRevision: preset.revision,
    connectionName: target.connectionName,
    orgBinding: target.orgBinding,
    resolution,
    setup,
    toolPolicy: toolPolicy?.exposures,
    replaceExisting,
    proposedConfig,
    sourceVersion,
  });
  return {
    kind: "configure",
    ...identity,
    cwd,
    scope,
    presetId: preset.id,
    presetRevision: preset.revision,
    connectionName: target.connectionName,
    ...(target.orgBinding ? { orgBinding: target.orgBinding } : {}),
    sourceVersion,
    willChange,
    resolution,
    setup,
    toolPolicy,
    replaceExisting,
    proposedConfig,
    diff,
  };
}

function configurePlanResult(plan: ConfigurePlan, state: ReturnType<typeof inspectPresetRuntime>) {
  return configurationPlanResult("configure.plan", plan, state);
}

function configurationPlanResult(
  action: "configure.plan" | "connection.plan",
  plan: ConfigurePlan | ConnectionPlan,
  state: ReturnType<typeof inspectPresetRuntime>,
  notes: string[] = [],
) {
  const lines = [
    `REVIEW: ${state.preset.label} MCP ${action === "connection.plan" ? "connection" : "configuration"} plan.`,
    `Plan ID: ${plan.planId}`,
    `Plan hash: ${plan.planHash}`,
    `Scope: ${plan.scope}`,
    `Connection: ${plan.connectionName}`,
    ...(plan.orgBinding ? [`Target org: ${plan.orgBinding.targetOrg}`] : []),
    `Resolution: ${plan.resolution}`,
    `Native config: ${mcpConfigPath(plan.cwd, plan.scope)}`,
    `Change required: ${plan.willChange ? "yes" : "no"}`,
    ...notes,
    ...(state.scopeConflict ? [`Warning: ${state.scopeConflict.message}`] : []),
    ...(state.managed.status === "project-override"
      ? [
          "Warning: This replaces the Pi-native project override with a complete project server entry.",
        ]
      : []),
    "Changes:",
    ...(plan.diff.length ? plan.diff.map((line) => `- ${line}`) : ["- none"]),
  ];
  return successResult(lines.join("\n"), {
    ok: true,
    action,
    scope: plan.scope,
    presetId: plan.presetId,
    connectionName: plan.connectionName,
    targetOrg: plan.orgBinding?.targetOrg,
    planId: plan.planId,
    planHash: plan.planHash,
    sourceVersion: plan.sourceVersion,
    willChange: plan.willChange,
    diff: plan.diff,
  });
}

async function applyConfigurePlan(
  plans: Map<string, SfMcpPlan>,
  plan: ConfigurePlan,
  dependencies: SfMcpToolDependencies,
  signal?: AbortSignal,
) {
  assertCurrentSource(plan);
  await assertCurrentOrgBinding(plan, dependencies, signal);
  if (!plan.willChange) {
    plans.delete(plan.planId);
    return successResult(`${getPreset(plan.presetId).label} already matches the reviewed plan.`, {
      ok: true,
      action: "configure.apply",
      scope: plan.scope,
      presetId: plan.presetId,
      connectionName: plan.connectionName,
      changed: false,
      verified: true,
      reloadRequired: false,
    });
  }
  const result = installPreset({
    cwd: plan.cwd,
    scope: plan.scope,
    presetId: plan.presetId,
    resolution: plan.resolution,
    setup: plan.setup,
    replaceExisting: plan.replaceExisting,
    toolPolicy: plan.toolPolicy,
    connectionName: plan.connectionName,
    ...(plan.orgBinding ? { orgBinding: plan.orgBinding } : {}),
  });
  if (!result.ok) throw new Error(result.message);
  const verified = inspectPresetRuntime(
    plan.cwd,
    plan.scope,
    getPreset(plan.presetId),
    plan.connectionName,
  );
  if (
    verified.managed.status !== "managed-enabled" ||
    !verified.managed.config ||
    fingerprintConfig(verified.managed.config) !== fingerprintConfig(plan.proposedConfig)
  ) {
    throw new Error(
      `${getPreset(plan.presetId).label} was written but exact resulting-state verification failed.`,
    );
  }
  plans.delete(plan.planId);
  return successResult(`${result.message}\nVerification: matched.`, {
    ok: true,
    action: "configure.apply",
    scope: plan.scope,
    presetId: plan.presetId,
    connectionName: plan.connectionName,
    targetOrg: plan.orgBinding?.targetOrg,
    changed: result.changed,
    verified: true,
    reloadRequired: result.reloadRequired,
  });
}

function createDisablePlan(cwd: string, scope: SfMcpScope, params: SfMcpParams): DisablePlan {
  const preset = requiredPreset(params);
  const connectionName = resolveExistingConnectionName(cwd, scope, preset, params.connection_name);
  const state = inspectPresetRuntime(cwd, scope, preset, connectionName);
  if (state.managed.status !== "managed-enabled" && state.managed.status !== "managed-disabled") {
    throw new Error(
      `${preset.label} connection must be an unchanged managed entry before it can be disabled.`,
    );
  }
  const sourceVersion = sourceVersionFor(cwd, scope, preset, connectionName);
  const identity = planIdentity({
    kind: "disable",
    cwd,
    scope,
    presetId: preset.id,
    presetRevision: preset.revision,
    connectionName,
    sourceVersion,
  });
  return {
    kind: "disable",
    ...identity,
    cwd,
    scope,
    presetId: preset.id,
    presetRevision: preset.revision,
    connectionName,
    ...(state.managed.record?.orgBinding ? { orgBinding: state.managed.record.orgBinding } : {}),
    sourceVersion,
    willChange: state.managed.status === "managed-enabled",
  };
}

function disablePlanResult(plan: DisablePlan) {
  return successResult(
    [
      `REVIEW: Disable ${getPreset(plan.presetId).label} in ${plan.scope} scope.`,
      `Plan ID: ${plan.planId}`,
      `Plan hash: ${plan.planHash}`,
      `Connection: ${plan.connectionName}`,
      `Change required: ${plan.willChange ? "yes" : "no"}`,
    ].join("\n"),
    {
      ok: true,
      action: "disable.plan",
      scope: plan.scope,
      presetId: plan.presetId,
      connectionName: plan.connectionName,
      planId: plan.planId,
      planHash: plan.planHash,
      sourceVersion: plan.sourceVersion,
      willChange: plan.willChange,
    },
  );
}

function applyDisablePlan(plans: Map<string, SfMcpPlan>, plan: DisablePlan) {
  assertCurrentSource(plan);
  if (!plan.willChange) {
    plans.delete(plan.planId);
    return successResult(`${getPreset(plan.presetId).label} is already disabled.`, {
      ok: true,
      action: "disable.apply",
      scope: plan.scope,
      presetId: plan.presetId,
      connectionName: plan.connectionName,
      changed: false,
      verified: true,
      reloadRequired: false,
    });
  }
  const result = setManagedPresetEnabled({
    cwd: plan.cwd,
    scope: plan.scope,
    presetId: plan.presetId,
    connectionName: plan.connectionName,
    enabled: false,
  });
  if (!result.ok) throw new Error(result.message);
  const verified = inspectPresetRuntime(
    plan.cwd,
    plan.scope,
    getPreset(plan.presetId),
    plan.connectionName,
  );
  if (verified.managed.status !== "managed-disabled") {
    throw new Error(
      `${getPreset(plan.presetId).label} disable completed but resulting-state verification failed.`,
    );
  }
  plans.delete(plan.planId);
  return successResult(`${result.message}\nVerification: disabled.`, {
    ok: true,
    action: "disable.apply",
    scope: plan.scope,
    presetId: plan.presetId,
    connectionName: plan.connectionName,
    changed: result.changed,
    verified: true,
    reloadRequired: result.reloadRequired,
  });
}

function loginHandoffResult(cwd: string, scope: SfMcpScope, params: SfMcpParams) {
  const preset = requiredPreset(params);
  const connectionName = resolveExistingConnectionName(cwd, scope, preset, params.connection_name);
  const state = inspectPresetRuntime(cwd, scope, preset, connectionName);
  if (state.managed.status !== "managed-enabled" || !state.managed.configuredName) {
    throw new Error(
      `${preset.label} is not an unchanged enabled SF MCP-managed entry. Configure or review it first.`,
    );
  }
  if (preset.transport !== "http") {
    throw new Error(`${preset.label} doesn't use OAuth login through Pi's native MCP runtime.`);
  }
  const command = `/mcp login ${state.managed.configuredName}`;
  return successResult(
    [
      `READY: ${preset.label} native MCP login handoff.`,
      `Reload Pi if configuration changed, then run: ${command}`,
      "Pi owns token storage and refresh. Browser approval remains human OAuth consent.",
    ].join("\n"),
    {
      ok: true,
      action: "login.handoff",
      scope,
      presetId: preset.id,
      serverName: state.managed.configuredName,
      command,
    },
  );
}

async function identityVerifyResult(
  cwd: string,
  scope: SfMcpScope,
  params: SfMcpParams,
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  const preset = requiredPreset(params);
  if (preset.id !== "headless-360") {
    throw new Error("identity.verify currently supports only preset_id=headless-360.");
  }
  const connectionName = resolveExistingConnectionName(cwd, scope, preset, params.connection_name);
  const state = inspectPresetRuntime(cwd, scope, preset, connectionName);
  const binding = state.managed.record?.orgBinding;
  if (state.managed.status !== "managed-enabled" || !binding) {
    throw new Error(
      `${connectionName} must be an enabled org-bound SF MCP connection before identity verification.`,
    );
  }
  if (state.managed.config?.toolExposure?.dispatch_readonly === "hidden") {
    throw new Error(
      "Apply the recommended or read-only tool profile before identity.verify so dispatch_readonly is callable.",
    );
  }
  const toolName = `mcp__${canonicalMcpServerName(connectionName)}__dispatch_readonly`;
  const result = await executeTool(toolName, {
    url: `${binding.authorizationIssuer}/services/oauth2/userinfo`,
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const evidence = JSON.stringify(result);
  if (!evidence.includes(binding.orgId)) {
    throw new Error(
      `${connectionName} responded, but its authenticated organization did not match the planned org binding.`,
    );
  }
  return successResult(
    [
      `PASS: ${preset.label} identity verified for ${connectionName}.`,
      `Target org: ${binding.alias ?? binding.targetOrg}`,
      "The authenticated organization id matched the source-bound connection instance.",
    ].join("\n"),
    {
      ok: true,
      action: "identity.verify",
      scope,
      presetId: preset.id,
      connectionName,
      targetOrg: binding.targetOrg,
      orgType: binding.orgType,
      verified: true,
    },
  );
}

function requirePlan<T extends SfMcpPlan["kind"]>(
  plans: Map<string, SfMcpPlan>,
  params: SfMcpParams,
  kind: T,
  cwd: string,
  scope: SfMcpScope,
): Extract<SfMcpPlan, { kind: T }> {
  const planId = requiredText(params.plan_id, "plan_id");
  const planHash = requiredText(params.plan_hash, "plan_hash");
  const preset = requiredPreset(params);
  const plan = plans.get(planId);
  if (!plan) throw new Error(`Unknown or expired SF MCP plan: ${planId}.`);
  if (plan.kind !== kind) throw new Error(`${planId} is not a ${kind} plan.`);
  if (plan.planHash !== planHash) throw new Error(`${planId} plan hash does not match.`);
  if (plan.cwd !== cwd || plan.scope !== scope || plan.presetId !== preset.id) {
    throw new Error(`${planId} does not match this workspace, scope, and preset.`);
  }
  if (plan.orgBinding && !params.connection_name) {
    throw new Error(`${planId} requires connection_name=${plan.connectionName}.`);
  }
  if (params.connection_name && params.connection_name !== plan.connectionName) {
    throw new Error(`${planId} does not match connection_name=${params.connection_name}.`);
  }
  return plan as Extract<SfMcpPlan, { kind: T }>;
}

async function assertCurrentOrgBinding(
  plan: SfMcpPlan,
  dependencies: SfMcpToolDependencies,
  signal?: AbortSignal,
): Promise<void> {
  if (!plan.orgBinding) return;
  const serverPath = hostedServerPath(plan.presetId);
  if (!serverPath)
    throw new Error(`${getPreset(plan.presetId).label} has no hosted endpoint path.`);
  const current = await dependencies.resolveHostedOrgBinding({
    cwd: plan.cwd,
    targetOrg: plan.orgBinding.targetOrg,
    serverPath,
    signal,
  });
  if (
    current.orgId !== plan.orgBinding.orgId ||
    current.serverUrl !== plan.orgBinding.serverUrl ||
    current.authorizationIssuer !== plan.orgBinding.authorizationIssuer
  ) {
    throw new Error(
      `${getPreset(plan.presetId).label} org identity or OAuth discovery changed after planning. Create a new plan.`,
    );
  }
}

function assertCurrentSource(plan: SfMcpPlan): void {
  const current = sourceVersionFor(
    plan.cwd,
    plan.scope,
    getPreset(plan.presetId),
    plan.connectionName,
  );
  if (current !== plan.sourceVersion) {
    throw new Error(
      `${getPreset(plan.presetId).label} configuration changed after planning. Create a new plan.`,
    );
  }
}

function sourceVersionFor(
  cwd: string,
  scope: SfMcpScope,
  preset: McpPreset,
  connectionName = preset.serverName,
): string {
  const state = inspectPresetRuntime(cwd, scope, preset, connectionName);
  return `sha256:${hash({
    status: state.managed.status,
    configuredName: state.managed.configuredName,
    config: state.managed.config,
    override: state.managed.override,
    record: state.managed.record,
    scopeConflict: state.scopeConflict,
  })}`;
}

function planIdentity(value: unknown): { planId: string; planHash: string } {
  const digest = hash(value);
  return { planId: `plan_${digest.slice(0, 16)}`, planHash: `sha256:${digest}` };
}

function reviewedToolPolicy(
  preset: McpPreset,
  conflictPlan: ReturnType<typeof inspectPresetRuntime>["plan"],
  profile: Exclude<ToolPolicyProfile, "custom">,
): ToolExposurePolicy | undefined {
  if (!hasReviewedToolPolicy(preset)) return undefined;
  return profile === "recommended"
    ? buildConflictAwareToolPolicy(preset, conflictPlan)
    : buildToolExposurePolicy(preset, profile);
}

async function resolveConnectionTarget(
  cwd: string,
  scope: SfMcpScope,
  params: SfMcpParams,
  preset: McpPreset,
  dependencies: SfMcpToolDependencies,
  signal?: AbortSignal,
): Promise<{ connectionName: string; orgBinding?: HostedMcpOrgBinding }> {
  const explicitName = trimmed(params.connection_name);
  if (!params.target_org?.trim()) {
    return { connectionName: validatedConnectionName(explicitName ?? preset.serverName) };
  }
  if (preset.id !== "headless-360") {
    throw new Error("Phase 1 org-pinned MCP connections support only preset_id=headless-360.");
  }
  const serverPath = hostedServerPath(preset.id);
  if (!serverPath) throw new Error(`${preset.label} has no hosted endpoint path.`);
  const orgBinding = await dependencies.resolveHostedOrgBinding({
    cwd,
    targetOrg: params.target_org.trim(),
    serverPath,
    signal,
  });
  const baseName = validatedConnectionName(
    explicitName ?? hostedConnectionName(preset.serverName, orgBinding),
  );
  const existing = inspectPresetRuntime(cwd, scope, preset, baseName);
  if (
    existing.managed.record?.orgBinding?.orgId &&
    existing.managed.record.orgBinding.orgId !== orgBinding.orgId
  ) {
    if (explicitName) {
      throw new Error(
        `${baseName} is already bound to another Salesforce org. Choose a different connection_name.`,
      );
    }
    const candidate = validatedConnectionName(`${baseName}-${hash(orgBinding.orgId).slice(0, 8)}`);
    const collision = inspectPresetRuntime(cwd, scope, preset, candidate);
    if (
      collision.managed.status !== "missing" &&
      collision.managed.record?.orgBinding?.orgId !== orgBinding.orgId
    ) {
      throw new Error(
        `Unable to derive a unique MCP connection name for ${orgBinding.targetOrg}. Pass connection_name explicitly.`,
      );
    }
    return { connectionName: candidate, orgBinding };
  }
  return { connectionName: baseName, orgBinding };
}

function resolveExistingConnectionName(
  cwd: string,
  scope: SfMcpScope,
  preset: McpPreset,
  requested: string | undefined,
): string {
  const explicit = trimmed(requested);
  if (explicit) return validatedConnectionName(explicit);
  const instances = inspectPresetInstances(cwd, scope, preset).filter(
    (state) => state.managed.status !== "missing",
  );
  if (instances.length === 0) return preset.serverName;
  if (instances.length === 1) {
    return (
      instances[0]?.managed.configuredName ?? instances[0]?.connectionName ?? preset.serverName
    );
  }
  throw new Error(
    `${preset.label} has multiple managed connections. Pass connection_name to select one.`,
  );
}

function validatedConnectionName(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value)) {
    throw new Error("connection_name may contain only letters, digits, hyphens, and underscores.");
  }
  return value;
}

function presetSetup(params: SfMcpParams): PresetSetup {
  return {
    environment: params.environment,
    oauthClientId: trimmed(params.oauth_client_id),
    region: params.region,
    tenantId: trimmed(params.tenant_id),
    marketingClientId: trimmed(params.marketing_client_id),
    serverUrl: trimmed(params.server_url),
    customUrl: trimmed(params.custom_url),
  };
}

function requiredPreset(params: SfMcpParams): McpPreset {
  return getPreset(requiredText(params.preset_id, "preset_id"));
}

function connectionResolution(state: ReturnType<typeof inspectPresetRuntime>): ConfigureResolution {
  const current = state.managed.record?.resolution;
  if (current && current !== "native-only") return current;
  if (state.plan.conflicts.length === 0) return "enable";
  return state.plan.recommendation.resolution === "complement-native"
    ? "complement-native"
    : "side-by-side";
}

function requiredResolution(params: SfMcpParams): ConfigureResolution {
  if (!params.resolution || !CONFIGURE_RESOLUTIONS.includes(params.resolution)) {
    throw new Error("configure.plan requires an explicit resolution.");
  }
  return params.resolution;
}

function resolveScope(params: SfMcpParams): SfMcpScope {
  if (params.action === "status" && !params.scope) return "global";
  if (!params.scope) throw new Error(`${params.action} requires an explicit scope.`);
  return params.scope;
}

function requireTrustedScope(scope: SfMcpScope, projectTrusted: boolean): void {
  if (scope === "project" && !projectTrusted) {
    throw new Error("Project MCP configuration is unavailable until Pi trusts this project.");
  }
}

function requireMutationIntent(params: SfMcpParams): void {
  if (params.allow_mutation !== true) {
    throw new Error(`${params.action} requires allow_mutation=true.`);
  }
}

function assertPlannableState(
  status: ReturnType<typeof inspectPresetRuntime>["managed"]["status"],
  message: string | undefined,
  replaceExisting: boolean,
): void {
  if (status === "invalid-config" || status === "name-conflict") {
    throw new Error(message ?? `SF MCP configuration is ${status}.`);
  }
  if (
    ["manual", "modified", "managed-outdated", "project-override"].includes(status) &&
    !replaceExisting
  ) {
    throw new Error(
      `${message ?? "Existing MCP configuration requires review."} Set replace_existing=true only after reviewing the status and plan diff.`,
    );
  }
}

function requiredText(value: string | undefined, field: string): string {
  const normalized = trimmed(value);
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function trimmed(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function successResult(text: string, details: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], details };
}

function errorResult(action: SfMcpAction, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `ERROR: ${message}` }],
    details: { ok: false, action, error: message },
    isError: true,
  };
}
