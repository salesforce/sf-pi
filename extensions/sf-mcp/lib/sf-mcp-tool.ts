/* SPDX-License-Identifier: Apache-2.0 */
/** Plan-bound agent surface for Salesforce MCP native configuration. */
import { createHash } from "node:crypto";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fingerprintConfig } from "./managed-state.ts";
import { mcpConfigPath, type McpServerConfig } from "./mcp-config.ts";
import {
  installPreset,
  inspectPresetRuntime,
  setManagedPresetEnabled,
  summarizeConfigDiff,
} from "./service.ts";
import { buildConflictAwareToolPolicy } from "./tool-conflicts.ts";
import {
  buildToolExposurePolicy,
  hasReviewedToolPolicy,
  type ToolPolicyProfile,
  type ToolExposurePolicy,
} from "./tool-policy.ts";
import {
  buildServerConfig,
  getPreset,
  SALESFORCE_MCP_PRESETS,
  type McpPreset,
  type McpPresetId,
  type PresetSetup,
} from "./presets.ts";

const SF_MCP_ACTIONS = [
  "status",
  "configure.plan",
  "configure.apply",
  "disable.plan",
  "disable.apply",
  "login.handoff",
] as const;
const SCOPES = ["global", "project"] as const;
const CONFIGURE_RESOLUTIONS = ["enable", "complement-native", "side-by-side"] as const;
const TOOL_PROFILES = ["recommended", "read-only", "all-approved", "quarantine"] as const;
const ENVIRONMENTS = ["production", "sandbox"] as const;
const REGIONS = ["US", "EU", "PROD_US", "PROD_EU", "PROD_CA", "PROD_JP"] as const;

type SfMcpAction = (typeof SF_MCP_ACTIONS)[number];
type SfMcpScope = (typeof SCOPES)[number];
type ConfigureResolution = (typeof CONFIGURE_RESOLUTIONS)[number];

interface SfMcpParams {
  action: SfMcpAction;
  scope?: SfMcpScope;
  preset_id?: string;
  resolution?: ConfigureResolution;
  environment?: PresetSetup["environment"];
  oauth_client_id?: string;
  region?: PresetSetup["region"];
  tenant_id?: string;
  marketing_client_id?: string;
  custom_url?: string;
  tool_profile?: Exclude<ToolPolicyProfile, "custom">;
  replace_existing?: boolean;
  plan_id?: string;
  plan_hash?: string;
  allow_mutation?: boolean;
}

interface PlanBase {
  kind: "configure" | "disable";
  planId: string;
  planHash: string;
  cwd: string;
  scope: SfMcpScope;
  presetId: McpPresetId;
  presetRevision: number;
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

interface DisablePlan extends PlanBase {
  kind: "disable";
}

type SfMcpPlan = ConfigurePlan | DisablePlan;

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
    Type.String({ description: "Public External Client App consumer key." }),
  ),
  region: Type.Optional(StringEnum(REGIONS, { description: "Preset-specific service region." })),
  tenant_id: Type.Optional(Type.String({ description: "Preset-specific tenant id." })),
  marketing_client_id: Type.Optional(
    Type.String({ description: "Marketing Cloud public client identifier." }),
  ),
  custom_url: Type.Optional(Type.String({ description: "HTTPS URL for the custom preset." })),
  tool_profile: Type.Optional(
    StringEnum(TOOL_PROFILES, {
      description: "Reviewed per-tool exposure profile. Defaults to recommended.",
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

export function registerSfMcpTool(pi: ExtensionAPI): void {
  const plans = new Map<string, SfMcpPlan>();

  pi.registerTool<typeof Params>({
    name: "sf_mcp",
    label: "SF MCP",
    description:
      "Inspect, plan, apply, disable, and hand off Salesforce MCP presets to Pi's native MCP runtime. Durable configuration is source-bound, diff-reviewed, and Guardrail-mediated; OAuth consent remains human-controlled.",
    promptSnippet:
      "Configure reviewed Salesforce MCP presets in Pi after Salesforce-side OAuth setup, without directly editing mcp.json.",
    promptGuidelines: [
      "Use status before configuring a preset, then configure.plan followed by configure.apply with the exact plan_id and plan_hash.",
      "Use sf_integrate for Salesforce-side External Client App setup. Pass only the public consumer key to sf_mcp as oauth_client_id.",
      "Mutating applies require an explicit global or trusted-project scope plus allow_mutation=true and remain SF Guardrail-mediated.",
      "Use the recommended tool profile unless the user explicitly requests another reviewed exposure profile.",
      "Use login.handoff after apply. OAuth login and browser consent remain human-controlled through Pi's native /mcp runtime.",
    ],
    parameters: Params,
    async execute(_id, rawParams, _signal, _onUpdate, ctx) {
      const params = rawParams as SfMcpParams;
      try {
        const scope = resolveScope(params);
        requireTrustedScope(scope, ctx.isProjectTrusted());
        switch (params.action) {
          case "status":
            return statusResult(ctx.cwd, scope, params.preset_id);
          case "configure.plan": {
            const plan = createConfigurePlan(ctx.cwd, scope, params);
            plans.set(plan.planId, plan);
            return configurePlanResult(
              plan,
              inspectPresetRuntime(ctx.cwd, scope, getPreset(plan.presetId)),
            );
          }
          case "configure.apply": {
            requireMutationIntent(params);
            const plan = requirePlan(plans, params, "configure", ctx.cwd, scope);
            return applyConfigurePlan(plans, plan);
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
    const state = inspectPresetRuntime(cwd, scope, preset);
    return {
      presetId: preset.id,
      label: preset.label,
      serverName: preset.serverName,
      status: state.managed.status,
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
        (row.conflictOwners.length ? ` · overlaps ${row.conflictOwners.join(", ")}` : "") +
        (row.scopeConflict ? ` · ${row.scopeConflict}` : ""),
    ),
  ].join("\n");
  return successResult(body, { ok: true, action: "status", scope, presets: rows });
}

function createConfigurePlan(cwd: string, scope: SfMcpScope, params: SfMcpParams): ConfigurePlan {
  const preset = requiredPreset(params);
  const resolution = requiredResolution(params);
  const state = inspectPresetRuntime(cwd, scope, preset);
  assertPlannableState(
    state.managed.status,
    state.managed.message,
    params.replace_existing === true,
  );
  const setup = presetSetup(params);
  const toolPolicy = reviewedToolPolicy(preset, state.plan, params.tool_profile ?? "recommended");
  const proposedConfig = buildServerConfig(preset, resolution, setup, toolPolicy?.exposures);
  const diff = summarizeConfigDiff(state.managed.config ?? state.managed.override, proposedConfig);
  const sourceVersion = sourceVersionFor(cwd, scope, preset);
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
  const lines = [
    `REVIEW: ${state.preset.label} MCP configuration plan.`,
    `Plan ID: ${plan.planId}`,
    `Plan hash: ${plan.planHash}`,
    `Scope: ${plan.scope}`,
    `Resolution: ${plan.resolution}`,
    `Native config: ${mcpConfigPath(plan.cwd, plan.scope)}`,
    `Change required: ${plan.willChange ? "yes" : "no"}`,
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
    action: "configure.plan",
    scope: plan.scope,
    presetId: plan.presetId,
    planId: plan.planId,
    planHash: plan.planHash,
    sourceVersion: plan.sourceVersion,
    willChange: plan.willChange,
    diff: plan.diff,
  });
}

function applyConfigurePlan(plans: Map<string, SfMcpPlan>, plan: ConfigurePlan) {
  assertCurrentSource(plan);
  if (!plan.willChange) {
    plans.delete(plan.planId);
    return successResult(`${getPreset(plan.presetId).label} already matches the reviewed plan.`, {
      ok: true,
      action: "configure.apply",
      scope: plan.scope,
      presetId: plan.presetId,
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
  });
  if (!result.ok) throw new Error(result.message);
  const verified = inspectPresetRuntime(plan.cwd, plan.scope, getPreset(plan.presetId));
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
    changed: result.changed,
    verified: true,
    reloadRequired: result.reloadRequired,
  });
}

function createDisablePlan(cwd: string, scope: SfMcpScope, params: SfMcpParams): DisablePlan {
  const preset = requiredPreset(params);
  const state = inspectPresetRuntime(cwd, scope, preset);
  if (state.managed.status !== "managed-enabled" && state.managed.status !== "managed-disabled") {
    throw new Error(
      `${preset.label} is not an unchanged SF MCP-managed entry and cannot be disabled by the agent tool.`,
    );
  }
  const sourceVersion = sourceVersionFor(cwd, scope, preset);
  const identity = planIdentity({
    kind: "disable",
    cwd,
    scope,
    presetId: preset.id,
    presetRevision: preset.revision,
    sourceVersion,
  });
  return {
    kind: "disable",
    ...identity,
    cwd,
    scope,
    presetId: preset.id,
    presetRevision: preset.revision,
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
      `Change required: ${plan.willChange ? "yes" : "no"}`,
    ].join("\n"),
    {
      ok: true,
      action: "disable.plan",
      scope: plan.scope,
      presetId: plan.presetId,
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
      changed: false,
      verified: true,
      reloadRequired: false,
    });
  }
  const result = setManagedPresetEnabled({
    cwd: plan.cwd,
    scope: plan.scope,
    presetId: plan.presetId,
    enabled: false,
  });
  if (!result.ok) throw new Error(result.message);
  const verified = inspectPresetRuntime(plan.cwd, plan.scope, getPreset(plan.presetId));
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
    changed: result.changed,
    verified: true,
    reloadRequired: result.reloadRequired,
  });
}

function loginHandoffResult(cwd: string, scope: SfMcpScope, params: SfMcpParams) {
  const preset = requiredPreset(params);
  const state = inspectPresetRuntime(cwd, scope, preset);
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
  return plan as Extract<SfMcpPlan, { kind: T }>;
}

function assertCurrentSource(plan: SfMcpPlan): void {
  const current = sourceVersionFor(plan.cwd, plan.scope, getPreset(plan.presetId));
  if (current !== plan.sourceVersion) {
    throw new Error(
      `${getPreset(plan.presetId).label} configuration changed after planning. Create a new plan.`,
    );
  }
}

function sourceVersionFor(cwd: string, scope: SfMcpScope, preset: McpPreset): string {
  const state = inspectPresetRuntime(cwd, scope, preset);
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

function presetSetup(params: SfMcpParams): PresetSetup {
  return {
    environment: params.environment,
    oauthClientId: trimmed(params.oauth_client_id),
    region: params.region,
    tenantId: trimmed(params.tenant_id),
    marketingClientId: trimmed(params.marketing_client_id),
    customUrl: trimmed(params.custom_url),
  };
}

function requiredPreset(params: SfMcpParams): McpPreset {
  return getPreset(requiredText(params.preset_id, "preset_id"));
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
