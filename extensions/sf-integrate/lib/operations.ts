/* SPDX-License-Identifier: Apache-2.0 */
/** SF Integrate lifecycle operations for the Headless 360 MCP golden path. */

import type { SfPiResultCard } from "../../../lib/common/display/result-card.ts";
import {
  SF_MCP_HEADLESS_360_REQUIREMENT,
  sfMcpHeadlessConnectionName,
} from "../../../lib/common/sf-mcp-oauth-requirements.ts";
import { salesforceOrgHostKey } from "../../../lib/common/sf-environment/org-type.ts";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { integrationArtifactTimestamp, writeIntegrationArtifact } from "./artifacts.ts";
import {
  defaultIntegrationAdapter,
  isCompleteEca,
  missingRequiredMetadataTypes,
} from "./metadata.ts";
import { buildEcaSetupNavigation, type EcaSetupNavigation } from "./navigation.ts";
import { assertPlanMatches, buildIntegrationPlan } from "./plans.ts";
import type {
  EcaInspection,
  IntegrationAdapter,
  IntegrationDeploymentResult,
  IntegrationPlan,
  McpServerActivationInspection,
  SfIntegrateParams,
  SfIntegrateSessionState,
  ToolResult,
} from "./types.ts";

const TOOL = { id: "sf-integrate", label: "SF Integrate", icon: "🔗" } as const;
const DEFAULT_APP_NAME = "SfPiHeadless360Mcp";
const DEFAULT_APP_LABEL = "SF Pi Headless 360 MCP";
const HEADLESS_SERVER_DEVELOPER_NAME = "platform_headless_360";
const HEADLESS_SERVER_LABEL = "headless-360";

export function status(): ToolResult {
  return result(
    "status",
    "SF Integrate is ready for hosted MCP OAuth and modern outbound credential lifecycles.",
    {
      tool: TOOL,
      title: "SF Integrate · ready",
      status: "success",
      summary:
        "Plan-bound Headless 360 OAuth plus modern External Credential and Named Credential setup.",
      sections: [
        {
          icon: "🧭",
          title: "Available Loop",
          rows: [
            { label: "Preflight", value: "org.preflight" },
            { label: "Plan", value: "design.plan" },
            { label: "Apply", value: "setup.apply", tone: "warning" },
            { label: "Populate", value: "secret.populate", tone: "warning" },
            { label: "Authorize", value: "oauth.authorize", tone: "warning" },
            { label: "Verify", value: "setup.verify" },
            { label: "Test", value: "connection.test" },
            { label: "Handoff", value: "mcp.handoff" },
          ],
        },
      ],
      next: [
        "Run org.preflight with an explicit non-production target_org, then choose direction=mcp, direction=inbound, or direction=outbound.",
      ],
    },
    { supported_presets: [SF_MCP_HEADLESS_360_REQUIREMENT.presetId] },
  );
}

export async function orgPreflight(
  params: SfIntegrateParams,
  session: SalesforceSession,
  adapter: IntegrationAdapter = defaultIntegrationAdapter,
): Promise<ToolResult> {
  const available = await adapter.describeMetadataTypes(session);
  const missing = missingRequiredMetadataTypes(available);
  const activation = await adapter.inspectMcpServerActivation(
    session,
    HEADLESS_SERVER_DEVELOPER_NAME,
  );
  const nonProduction = isNonProduction(session);
  const apiReady = Number.parseFloat(session.target.apiVersion) >= 61;
  const ready = missing.length === 0 && apiReady && nonProduction;
  const findings = [
    {
      label: "Org type",
      value: session.target.orgType,
      tone: nonProduction ? ("success" as const) : ("error" as const),
    },
    {
      label: "API version",
      value: session.target.apiVersion,
      tone: apiReady ? ("success" as const) : ("error" as const),
    },
    {
      label: "ECA metadata",
      value: missing.length ? `missing ${missing.join(", ")}` : "4/4 required types available",
      tone: missing.length ? ("error" as const) : ("success" as const),
    },
    {
      label: "MCP activation",
      value: activation.supported ? "Tooling API available" : "SF Browser fallback",
      tone: activation.supported ? ("success" as const) : ("warning" as const),
    },
  ];
  return result(
    "org.preflight",
    `${ready ? "PASS" : "BLOCKED"}: SF Integrate preflight for ${orgLabel(session)}.`,
    {
      tool: TOOL,
      title: `Integration Preflight · ${ready ? "ready" : "blocked"}`,
      status: ready ? "success" : "error",
      summary: ready
        ? "The explicit target supports the Headless 360 External Client App stack."
        : "The target is not eligible for this mutation slice.",
      chips: [{ label: `API ${session.target.apiVersion}`, tone: apiReady ? "success" : "error" }],
      scope: orgScope(session),
      rails: [
        {
          label: "API",
          items: [
            {
              verb: "SOAP",
              target: "Metadata describe",
              detail: "External Client App capability probe",
            },
          ],
        },
      ],
      sections: [{ icon: "🛡️", title: "Readiness", rows: findings }],
      next: [
        ready
          ? "Run design.plan for headless-360."
          : "Choose an explicit sandbox, scratch, developer, or trial org with the required metadata types.",
      ],
    },
    {
      ready,
      missing_metadata_types: missing,
      mutation_allowed: nonProduction,
      activation_api_available: activation.supported,
      activation_fallback: activation.supported ? undefined : "sf-browser",
      api_version: session.target.apiVersion,
    },
    !ready,
  );
}

export async function designPlan(
  params: SfIntegrateParams,
  session: SalesforceSession,
  state: SfIntegrateSessionState,
  adapter: IntegrationAdapter = defaultIntegrationAdapter,
): Promise<ToolResult> {
  const preset = params.mcp_preset ?? SF_MCP_HEADLESS_360_REQUIREMENT.presetId;
  if (preset !== SF_MCP_HEADLESS_360_REQUIREMENT.presetId) {
    throw new Error(
      `Phase 1 supports only mcp_preset=${SF_MCP_HEADLESS_360_REQUIREMENT.presetId}.`,
    );
  }
  const appName = requireAppName(params.app_name ?? DEFAULT_APP_NAME);
  const appLabel = requireLabel(params.app_label ?? DEFAULT_APP_LABEL);
  const contactEmail = await resolveEmail(params.contact_email, session, adapter);
  const available = await adapter.describeMetadataTypes(session);
  const missing = missingRequiredMetadataTypes(available);
  if (missing.length) {
    throw new Error(`The target org is missing required metadata types: ${missing.join(", ")}.`);
  }
  const existing = await adapter.inspectEca(session, appName);
  const existingTypes = Object.entries(existing.components)
    .filter(([, present]) => present)
    .map(([type]) => type);
  const existingFindings = existingTypes.length ? verificationFindings(existing) : [];
  if (existingTypes.length && existingFindings.length) {
    throw new Error(
      `External Client App ${appName} exists but does not match the Headless 360 contract: ${existingFindings.join("; ")}.`,
    );
  }
  const ecaOperation = existingTypes.length ? "adopt" : "create";
  const activationInspection = await adapter.inspectMcpServerActivation(
    session,
    HEADLESS_SERVER_DEVELOPER_NAME,
  );
  const activation = activationPlan(activationInspection);

  const plan = await buildIntegrationPlan({
    preset,
    appName,
    appLabel,
    contactEmail,
    session,
    ecaOperation,
    activation,
  });
  state.plans.set(plan.plan_id, plan);
  return result(
    "design.plan",
    [
      `REVIEW: Headless 360 MCP integration plan for ${appName}.`,
      `Plan ID: ${plan.plan_id}`,
      `Plan hash: ${plan.plan_hash}`,
      `Components: ${plan.sources.map((source) => source.type).join(", ")}`,
      `Artifact: ${plan.artifact_path}`,
    ].join("\n"),
    {
      tool: TOOL,
      title: "Integration Plan · Headless 360 MCP",
      status: "warning",
      summary:
        ecaOperation === "create"
          ? `Create one public External Client App named ${appName}.`
          : `Adopt the existing exact External Client App named ${appName}.`,
      chips: [
        { label: ecaOperation === "create" ? "ECA create" : "ECA exact-adopt", tone: "info" },
        { label: "4 components", tone: "muted" },
      ],
      scope: [
        ...orgScope(session),
        { label: "app", value: appName, tone: "info" },
        { label: "contact", value: maskEmail(contactEmail) },
      ],
      rails: [
        {
          label: "API",
          items:
            ecaOperation === "create"
              ? [
                  { verb: "SOAP", target: "/metadata/deploy", detail: "checkOnly=true first" },
                  { verb: "SOAP", target: "/metadata/deploy", detail: "exact 4-component create" },
                ]
              : [
                  {
                    verb: "READ",
                    target: "External Client App metadata",
                    detail: "exact-adopt proof",
                  },
                ],
        },
      ],
      sections: [
        {
          icon: "🔐",
          title: "OAuth",
          rows: [
            { label: "Callback", value: plan.callback_url },
            { label: "Scopes", value: plan.oauth_scopes.join(" · ") },
            { label: "PKCE", value: "required", tone: "success" },
            { label: "Client secret", value: "optional · not captured", tone: "success" },
            { label: "JWT tokens", value: "named users enabled", tone: "success" },
          ],
        },
        {
          icon: "⚠️",
          title: "Phase 1 Boundary",
          rows: [
            { label: "Existing app", value: "updates refused" },
            { label: "User allowlist", value: "production hardening follow-up", tone: "warning" },
            { label: "Token TTL", value: "platform policy remains unchanged", tone: "warning" },
          ],
        },
      ],
      artifacts: plan.artifact_path
        ? [{ label: "plan", path: plan.artifact_path, kind: "json" }]
        : undefined,
      next: ["Review the plan, then call setup.apply with this plan ID, hash, and app name."],
    },
    {
      plan_id: plan.plan_id,
      plan_hash: plan.plan_hash,
      app_name: plan.app_name,
      eca_operation: plan.eca_operation,
      activation: plan.activation,
      artifact: plan.artifact_path,
      source_components: plan.sources.map((source) => source.type),
    },
  );
}

export async function applySetup(
  params: SfIntegrateParams,
  session: SalesforceSession,
  state: SfIntegrateSessionState,
  adapter: IntegrationAdapter = defaultIntegrationAdapter,
  signal?: AbortSignal,
): Promise<ToolResult> {
  if (params.allow_mutation !== true) {
    throw new Error(
      "setup.apply requires allow_mutation=true; Guardrail approval remains separate.",
    );
  }
  assertNonProduction(session);
  const plan = assertPlanMatches(state.plans.get(params.plan_id ?? ""), {
    planId: params.plan_id,
    planHash: params.plan_hash,
    appName: params.app_name,
  });
  assertPlanTarget(plan, session);

  const before = await adapter.inspectEca(session, plan.app_name);
  let check: IntegrationDeploymentResult | undefined;
  let deployed: IntegrationDeploymentResult | undefined;
  if (plan.eca_operation === "create") {
    if (Object.values(before.components).some(Boolean)) {
      throw new Error(
        `External Client App ${plan.app_name} changed after planning. No deployment was attempted; run design.plan again.`,
      );
    }
    check = await adapter.deploy({ session, sources: plan.sources, checkOnly: true, signal });
    if (!check.success) return deploymentFailure(plan, session, check, false);
    deployed = await adapter.deploy({
      session,
      sources: plan.sources,
      checkOnly: false,
      signal,
    });
    if (!deployed.success) return deploymentFailure(plan, session, deployed, true, check);
  } else {
    const drift = verificationFindings(before);
    if (drift.length) {
      throw new Error(
        `External Client App ${plan.app_name} changed after planning: ${drift.join("; ")}.`,
      );
    }
  }

  const currentActivation = activationPlan(
    await adapter.inspectMcpServerActivation(session, plan.activation.developer_name),
  );
  if (!sameActivationPlan(currentActivation, plan.activation)) {
    throw new Error(
      `Hosted MCP activation changed after planning (${plan.activation.operation} → ${currentActivation.operation}). Run design.plan again.`,
    );
  }
  const activation =
    plan.activation.operation === "browser"
      ? {
          developer_name: plan.activation.developer_name,
          master_label: plan.activation.master_label,
          active: false,
          operation: "browser" as const,
        }
      : await adapter.applyMcpServerActivation({ session, plan: plan.activation });

  const verification = await adapter.inspectEca(session, plan.app_name);
  const findings = verificationFindings(verification);
  if (!activation.active) findings.push("Headless 360 requires SF Browser activation");
  const artifact = await writeIntegrationArtifact(
    "runs",
    `${integrationArtifactTimestamp()}-${plan.app_name}-apply.json`,
    {
      plan,
      ...(check ? { check: check.raw } : {}),
      ...(deployed ? { deploy: deployed.raw } : {}),
      activation,
      verification,
    },
  );
  const verified = findings.length === 0;
  const navigation = buildEcaSetupNavigation(session, verification);
  const activationNavigation = {
    route: { type: "setup" as const, destination: "mcp-servers" },
  };
  return result(
    "setup.apply",
    [
      `${verified ? "PASS" : "WARNING"}: Headless 360 integration setup for ${plan.app_name}.`,
      `External Client App: ${plan.eca_operation === "create" ? "created" : "adopted"}`,
      `MCP server activation: ${activation.active ? `active (${activation.operation})` : "browser fallback required"}`,
      `Verification: ${verified ? "matched" : findings.join("; ")}`,
      `Open in Salesforce: ${navigation.url}`,
      `Artifact: ${artifact.path}`,
    ].join("\n"),
    {
      tool: TOOL,
      title: `Integration Setup · ${verified ? "verified" : "browser fallback"}`,
      status: verified ? "success" : "warning",
      summary: verified
        ? "The External Client App and Headless 360 activation match the plan."
        : "The External Client App is ready; complete hosted MCP activation through SF Browser.",
      chips: [
        { label: plan.eca_operation === "create" ? "ECA created" : "ECA adopted", tone: "success" },
        {
          label: activation.active ? "server active" : "activation fallback",
          tone: activation.active ? "success" : "warning",
        },
      ],
      scope: [...orgScope(session), { label: "app", value: plan.app_name, tone: "info" }],
      rails: [
        {
          label: "API",
          items: [
            ...(check
              ? [{ verb: "POST", target: "/metadata/deploy", detail: "checkOnly=true" }]
              : []),
            ...(deployed
              ? [{ verb: "POST", target: "/metadata/deploy", detail: "checkOnly=false" }]
              : []),
            {
              verb: activation.active ? "WRITE" : "OPEN",
              target: "McpServerAccess",
              detail: activation.active
                ? `operation=${activation.operation}`
                : "SF Browser fallback",
            },
            { verb: "READ", target: "External Client App metadata", detail: "resulting state" },
          ],
        },
      ],
      sections: [
        {
          icon: "🛡️",
          title: "Proof",
          rows: [
            { label: "Components", value: "4/4 present", tone: "success" },
            {
              label: "Hosted server",
              value: activation.active ? "Headless 360 active" : "activation pending",
              tone: activation.active ? "success" : "warning",
            },
            {
              label: "Consumer key",
              value: verification.consumer_key ? "available" : "pending propagation",
              tone: verification.consumer_key ? "success" : "warning",
            },
          ],
        },
      ],
      artifacts: [{ label: "run", path: artifact.path, kind: "json" }],
      next: activation.active
        ? ["Run mcp.handoff, then configure the org-pinned connection with SF MCP."]
        : [
            "Use sf_browser_open_org with activation_navigation.route, activate Headless 360, and verify before mcp.handoff.",
          ],
    },
    {
      app_name: plan.app_name,
      eca_operation: plan.eca_operation,
      verified,
      findings,
      activation,
      activation_navigation: activationNavigation,
      consumer_key_available: Boolean(verification.consumer_key),
      check_job_id: check?.id,
      deploy_job_id: deployed?.id,
      artifact: artifact.path,
      navigation,
    },
    !verified,
  );
}

export async function verifySetup(
  params: SfIntegrateParams,
  session: SalesforceSession,
  adapter: IntegrationAdapter = defaultIntegrationAdapter,
): Promise<ToolResult> {
  const appName = requireAppName(params.app_name ?? DEFAULT_APP_NAME);
  const inspection = await adapter.inspectEca(session, appName);
  const activation = await adapter.inspectMcpServerActivation(
    session,
    HEADLESS_SERVER_DEVELOPER_NAME,
  );
  const findings = verificationFindings(inspection);
  if (!activation.record?.active) findings.push("Headless 360 hosted server is not active");
  const artifact = await writeIntegrationArtifact(
    "verification",
    `${integrationArtifactTimestamp()}-${appName}-verify.json`,
    { inspection, activation },
  );
  const ready = findings.length === 0 && Boolean(inspection.consumer_key);
  const navigation = buildEcaSetupNavigation(session, inspection);
  return result(
    "setup.verify",
    [
      `${ready ? "PASS" : "REVIEW"}: ${appName} verification${findings.length ? ` · ${findings.join("; ")}` : ""}.`,
      `Open in Salesforce: ${navigation.url}`,
    ].join("\n"),
    verificationCard(session, appName, inspection, findings, ready, artifact.path, navigation),
    {
      app_name: appName,
      ready,
      findings,
      consumer_key_available: Boolean(inspection.consumer_key),
      activation,
      activation_navigation: activation.record?.active
        ? undefined
        : { route: { type: "setup", destination: "mcp-servers" } },
      artifact: artifact.path,
      navigation,
    },
    !ready,
  );
}

export async function mcpHandoff(
  params: SfIntegrateParams,
  session: SalesforceSession,
  adapter: IntegrationAdapter = defaultIntegrationAdapter,
): Promise<ToolResult> {
  const preset = params.mcp_preset ?? SF_MCP_HEADLESS_360_REQUIREMENT.presetId;
  if (preset !== SF_MCP_HEADLESS_360_REQUIREMENT.presetId) {
    throw new Error(
      `Phase 1 supports only mcp_preset=${SF_MCP_HEADLESS_360_REQUIREMENT.presetId}.`,
    );
  }
  const appName = requireAppName(params.app_name ?? DEFAULT_APP_NAME);
  const inspection = await adapter.inspectEca(session, appName);
  const findings = verificationFindings(inspection);
  if (findings.length) {
    throw new Error(`${appName} is not ready for MCP handoff: ${findings.join("; ")}.`);
  }
  if (!inspection.consumer_key) {
    throw new Error(
      `${appName} has no readable consumer key yet. External Client Apps can take time to propagate; run mcp.handoff again later.`,
    );
  }
  const activation = await adapter.inspectMcpServerActivation(
    session,
    HEADLESS_SERVER_DEVELOPER_NAME,
  );
  if (!activation.record?.active) {
    throw new Error(
      "Headless 360 is not active in the target org. Use the mcp-servers SF Browser destination, then run mcp.handoff again.",
    );
  }
  const orgId = session.target.orgId;
  const hostKey = salesforceOrgHostKey(session.target.instanceUrl);
  if (!orgId || !hostKey) {
    throw new Error(
      "The target org does not provide the identity and My Domain needed for MCP handoff.",
    );
  }
  const serverName = sfMcpHeadlessConnectionName({
    targetOrg: session.target.targetOrg,
    alias: session.target.alias,
    orgId,
  });
  const navigation = buildEcaSetupNavigation(session, inspection);
  const handoff = {
    preset,
    server_name: serverName,
    app_name: appName,
    consumer_key: inspection.consumer_key,
    callback_url: SF_MCP_HEADLESS_360_REQUIREMENT.callbackUrl,
    oauth_scopes: [...SF_MCP_HEADLESS_360_REQUIREMENT.oauthScopes],
    target: {
      target_org: session.target.targetOrg,
      alias: session.target.alias,
      org_id: orgId,
      org_type: session.target.orgType,
      host_key: hostKey,
    },
    activation: activation.record,
    salesforce_setup: navigation,
  };
  const artifact = await writeIntegrationArtifact(
    "handoffs",
    `${integrationArtifactTimestamp()}-${appName}-headless-360.json`,
    handoff,
  );
  return result(
    "mcp.handoff",
    [
      "READY: Headless 360 MCP OAuth handoff.",
      `Consumer key: ${inspection.consumer_key}`,
      `Callback URL: ${handoff.callback_url}`,
      `Scopes: ${handoff.oauth_scopes.join(" ")}`,
      `Open in Salesforce: ${navigation.url}`,
      `Target org: ${session.target.alias ?? session.target.targetOrg}`,
      `Connection name: ${serverName}`,
      "Next: run sf_mcp connection.plan with this target org and consumer key.",
      `Then run /mcp login ${serverName} after reload.`,
      `Artifact: ${artifact.path}`,
    ].join("\n"),
    {
      tool: TOOL,
      title: "MCP Handoff · ready",
      status: "success",
      summary: "The org-side OAuth app is ready for SF MCP configuration.",
      chips: [{ label: "client ID ready", tone: "success" }],
      scope: [
        ...orgScope(session),
        { label: "preset", value: "Headless 360", tone: "info" },
        { label: "app", value: appName },
      ],
      sections: [
        {
          icon: "🔑",
          title: "Handoff",
          rows: [
            { label: "Client ID", value: inspection.consumer_key, tone: "info" },
            { label: "Callback", value: handoff.callback_url },
            { label: "Scopes", value: handoff.oauth_scopes.join(" · ") },
            { label: "Secret", value: "not required for this public client", tone: "success" },
          ],
        },
      ],
      artifacts: [{ label: "handoff", path: artifact.path, kind: "json" }],
      next: [
        `Open the External Client App in Salesforce: ${navigation.url}`,
        `Configure ${serverName} with sf_mcp using target_org=${session.target.alias ?? session.target.targetOrg}.`,
      ],
    },
    { handoff, artifact: artifact.path, navigation },
  );
}

function verificationCard(
  session: SalesforceSession,
  appName: string,
  inspection: EcaInspection,
  findings: string[],
  ready: boolean,
  artifactPath: string,
  navigation: EcaSetupNavigation,
): SfPiResultCard {
  return {
    tool: TOOL,
    title: `Integration Verification · ${ready ? "ready" : "review"}`,
    status: ready ? "success" : "warning",
    summary: ready
      ? "The External Client App matches the Headless 360 MCP requirement."
      : "The External Client App is incomplete, mismatched, or still propagating.",
    scope: [...orgScope(session), { label: "app", value: appName, tone: "info" }],
    rails: [
      {
        label: "API",
        items: [
          {
            verb: "READ",
            target: "External Client App metadata",
            detail: "3 exact component reads",
          },
        ],
      },
    ],
    sections: [
      {
        icon: ready ? "✅" : "⚠️",
        title: "Resulting State",
        rows: [
          { label: "Components", value: `${presentCount(inspection)}/3 present` },
          { label: "Callback", value: inspection.callback_url ?? "missing" },
          { label: "Scopes", value: inspection.metadata_scopes.join(" · ") || "missing" },
          {
            label: "Consumer key",
            value: inspection.consumer_key ? "available" : "pending or missing",
          },
          ...(findings.length
            ? findings.map((finding) => ({
                label: "Finding",
                value: finding,
                tone: "warning" as const,
              }))
            : [{ label: "Drift", value: "none observed", tone: "success" as const }]),
        ],
      },
    ],
    artifacts: [{ label: "verification", path: artifactPath, kind: "json" }],
    next: [
      `Open the External Client App in Salesforce: ${navigation.url}`,
      ready ? "Run mcp.handoff." : "Resolve the first finding and verify again.",
    ],
  };
}

function deploymentFailure(
  plan: IntegrationPlan,
  session: SalesforceSession,
  failed: IntegrationDeploymentResult,
  deploymentAttempted: boolean,
  check?: IntegrationDeploymentResult,
): ToolResult {
  const failures = failed.component_failures.map((failure) => failure.problem).slice(0, 8);
  return result(
    "setup.apply",
    `${deploymentAttempted ? "FAILED" : "BLOCKED"}: ${deploymentAttempted ? "deployment" : "check-only"} for ${plan.app_name}. ${failures.join("; ")}`,
    {
      tool: TOOL,
      title: `Integration ${deploymentAttempted ? "Deployment" : "Check-Only"} · failed`,
      status: "error",
      summary: deploymentAttempted
        ? "Deployment was attempted; resulting state is not proven."
        : "Check-only validation failed; no metadata was saved.",
      scope: [...orgScope(session), { label: "app", value: plan.app_name }],
      rails: [
        {
          label: "API",
          items: [
            ...(check
              ? [{ verb: "POST", target: "/metadata/deploy", detail: "checkOnly=true · passed" }]
              : []),
            {
              verb: "POST",
              target: "/metadata/deploy",
              detail: `checkOnly=${deploymentAttempted ? "false" : "true"}`,
              tone: "error",
            },
          ],
        },
      ],
      sections: [
        {
          icon: "🧯",
          title: "Failures",
          rows: failures.length
            ? failures.map((failure) => ({ label: "Metadata", value: failure, tone: "error" }))
            : [{ label: "Outcome", value: failed.status ?? "Failed", tone: "error" }],
        },
      ],
      next: [
        deploymentAttempted
          ? "Run setup.verify before attempting any repair or rollback."
          : "Correct the plan inputs, then run design.plan again.",
      ],
    },
    {
      app_name: plan.app_name,
      deployment_performed: deploymentAttempted,
      job_id: failed.id,
      component_failures: failed.component_failures,
    },
    true,
  );
}

function activationPlan(inspection: McpServerActivationInspection): IntegrationPlan["activation"] {
  const base = {
    developer_name: HEADLESS_SERVER_DEVELOPER_NAME,
    master_label: HEADLESS_SERVER_LABEL,
  };
  if (!inspection.supported) {
    return {
      ...base,
      operation: "browser",
      fallback_reason: inspection.fallback_reason ?? "Tooling activation is unavailable.",
    };
  }
  if (inspection.record?.active) {
    return { ...base, operation: "none", before: inspection.record };
  }
  if (inspection.record) {
    return inspection.updateable && inspection.record.id
      ? { ...base, operation: "update", before: inspection.record }
      : {
          ...base,
          operation: "browser",
          before: inspection.record,
          fallback_reason: "McpServerAccess is not updateable.",
        };
  }
  return inspection.createable
    ? { ...base, operation: "create" }
    : {
        ...base,
        operation: "browser",
        fallback_reason: "McpServerAccess is not createable.",
      };
}

function sameActivationPlan(
  current: IntegrationPlan["activation"],
  planned: IntegrationPlan["activation"],
): boolean {
  return (
    current.operation === planned.operation &&
    current.developer_name === planned.developer_name &&
    current.master_label === planned.master_label &&
    current.before?.id === planned.before?.id &&
    current.before?.active === planned.before?.active
  );
}

function verificationFindings(inspection: EcaInspection): string[] {
  const findings: string[] = [];
  if (!isCompleteEca(inspection)) {
    const missing = Object.entries(inspection.components)
      .filter(([, present]) => !present)
      .map(([type]) => type);
    findings.push(`missing ${missing.join(", ")}`);
  }
  if (inspection.callback_url !== SF_MCP_HEADLESS_360_REQUIREMENT.callbackUrl) {
    findings.push("callback URL mismatch");
  }
  const scopes = new Set(inspection.metadata_scopes);
  const missingScopes = SF_MCP_HEADLESS_360_REQUIREMENT.metadataScopes.filter(
    (scope) => !scopes.has(scope),
  );
  if (missingScopes.length) findings.push(`missing scopes ${missingScopes.join(", ")}`);
  if (inspection.pkce_required !== true) findings.push("PKCE is not required");
  if (inspection.consumer_secret_optional !== true) findings.push("consumer secret is required");
  if (inspection.named_user_jwt !== true)
    findings.push("named-user JWT access tokens are disabled");
  if (inspection.refresh_token_rotation !== true)
    findings.push("refresh-token rotation is disabled");
  return findings;
}

function result(
  action: ToolResult["details"]["action"],
  text: string,
  card: SfPiResultCard,
  details: Record<string, unknown> = {},
  isError = false,
): ToolResult {
  return {
    content: [{ type: "text", text }],
    details: { ok: !isError, action, card, ...details },
    ...(isError ? { isError: true } : {}),
  };
}

async function resolveEmail(
  explicit: string | undefined,
  session: SalesforceSession,
  adapter: IntegrationAdapter,
): Promise<string> {
  if (explicit !== undefined) return requireEmail(explicit);
  const resolved = await adapter.resolveContactEmail(session);
  if (!resolved) {
    throw new Error(
      "contact_email is required because the target user email couldn't be resolved.",
    );
  }
  return requireEmail(resolved);
}

function requireEmail(value: string): string {
  const normalized = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    throw new Error("contact_email must be a valid email address.");
  }
  return normalized;
}

function requireAppName(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(normalized)) {
    throw new Error(
      "app_name must start with a letter and contain at most 80 letters, numbers, or underscores.",
    );
  }
  return normalized;
}

function requireLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80 || /[\r\n]/u.test(normalized)) {
    throw new Error("app_label must contain 1 to 80 characters on one line.");
  }
  return normalized;
}

function assertPlanTarget(plan: IntegrationPlan, session: SalesforceSession): void {
  if (!session.target.orgId || plan.target.org_id !== session.target.orgId) {
    throw new Error("The integration plan belongs to a different org. Run design.plan again.");
  }
  if (plan.target.api_version !== session.target.apiVersion) {
    throw new Error("The target org API version changed after planning. Run design.plan again.");
  }
}

function assertNonProduction(session: SalesforceSession): void {
  if (!isNonProduction(session)) {
    throw new Error("SF Integrate setup.apply refuses production or unknown orgs in Phase 1.");
  }
}

function isNonProduction(session: SalesforceSession): boolean {
  return ["sandbox", "scratch", "developer", "trial"].includes(session.target.orgType);
}

function orgLabel(session: SalesforceSession): string {
  return session.target.alias ?? session.target.targetOrg;
}

function orgScope(session: SalesforceSession): SfPiResultCard["scope"] {
  return [
    { label: "org", value: orgLabel(session), tone: "info" },
    { label: "type", value: session.target.orgType },
    { label: "api", value: session.target.apiVersion },
  ];
}

function presentCount(inspection: EcaInspection): number {
  return Object.values(inspection.components).filter(Boolean).length;
}

function maskEmail(value: string): string {
  const [local, domain] = value.split("@", 2);
  if (!local || !domain) return "configured";
  return `${local.slice(0, 1)}***@${domain}`;
}
