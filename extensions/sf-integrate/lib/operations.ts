/* SPDX-License-Identifier: Apache-2.0 */
/** SF Integrate lifecycle operations for the Headless 360 MCP golden path. */

import type { SfPiResultCard } from "../../../lib/common/display/result-card.ts";
import { SF_MCP_HEADLESS_360_REQUIREMENT } from "../../../lib/common/sf-mcp-oauth-requirements.ts";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { integrationArtifactTimestamp, writeIntegrationArtifact } from "./artifacts.ts";
import {
  defaultIntegrationAdapter,
  isCompleteEca,
  missingRequiredMetadataTypes,
} from "./metadata.ts";
import { assertPlanMatches, buildIntegrationPlan } from "./plans.ts";
import type {
  EcaInspection,
  IntegrationAdapter,
  IntegrationDeploymentResult,
  IntegrationPlan,
  SfIntegrateParams,
  SfIntegrateSessionState,
  ToolResult,
} from "./types.ts";

const TOOL = { id: "sf-integrate", label: "SF Integrate", icon: "🔗" } as const;
const DEFAULT_APP_NAME = "SfPiHeadless360Mcp";
const DEFAULT_APP_LABEL = "SF Pi Headless 360 MCP";

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
        "Run org.preflight with an explicit non-production target_org, then choose direction=mcp or direction=outbound.",
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
      value: missing.length ? `missing ${missing.join(", ")}` : "3/3 required types available",
      tone: missing.length ? ("error" as const) : ("success" as const),
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
  if (existingTypes.length) {
    throw new Error(
      `External Client App ${appName} already has ${existingTypes.join(", ")}. Phase 1 is create-only; use setup.verify or choose another app_name.`,
    );
  }

  const plan = await buildIntegrationPlan({
    preset,
    appName,
    appLabel,
    contactEmail,
    session,
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
      summary: `Create one public External Client App named ${appName}.`,
      chips: [
        { label: "create-only", tone: "info" },
        { label: "3 components", tone: "muted" },
      ],
      scope: [
        ...orgScope(session),
        { label: "app", value: appName, tone: "info" },
        { label: "contact", value: maskEmail(contactEmail) },
      ],
      rails: [
        {
          label: "API",
          items: [
            { verb: "SOAP", target: "/metadata/deploy", detail: "checkOnly=true first" },
            { verb: "SOAP", target: "/metadata/deploy", detail: "exact 3-component create" },
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
  if (Object.values(before.components).some(Boolean)) {
    throw new Error(
      `External Client App ${plan.app_name} changed after planning. No deployment was attempted; run design.plan again.`,
    );
  }

  const check = await adapter.deploy({
    session,
    sources: plan.sources,
    checkOnly: true,
    signal,
  });
  if (!check.success) return deploymentFailure(plan, session, check, false);

  const deployed = await adapter.deploy({
    session,
    sources: plan.sources,
    checkOnly: false,
    signal,
  });
  if (!deployed.success) return deploymentFailure(plan, session, deployed, true, check);

  const verification = await adapter.inspectEca(session, plan.app_name);
  const findings = verificationFindings(verification);
  const artifact = await writeIntegrationArtifact(
    "runs",
    `${integrationArtifactTimestamp()}-${plan.app_name}-apply.json`,
    { plan, check: check.raw, deploy: deployed.raw, verification },
  );
  const verified = findings.length === 0;
  return result(
    "setup.apply",
    [
      `${verified ? "PASS" : "WARNING"}: External Client App ${plan.app_name} deployed.`,
      `Check-only: ${check.status ?? "Succeeded"}`,
      `Deployment: ${deployed.status ?? "Succeeded"}`,
      `Verification: ${verified ? "matched" : findings.join("; ")}`,
      `Artifact: ${artifact.path}`,
    ].join("\n"),
    {
      tool: TOOL,
      title: `Integration Setup · ${verified ? "verified" : "review"}`,
      status: verified ? "success" : "warning",
      summary: verified
        ? "The Headless 360 External Client App is deployed and matches the plan."
        : "Deployment succeeded, but resulting-state verification needs review.",
      chips: [
        { label: `check ${shortId(check.id)}`, tone: "success" },
        { label: `deploy ${shortId(deployed.id)}`, tone: verified ? "success" : "warning" },
      ],
      scope: [...orgScope(session), { label: "app", value: plan.app_name, tone: "info" }],
      rails: [
        {
          label: "API",
          items: [
            { verb: "POST", target: "/metadata/deploy", detail: "checkOnly=true" },
            { verb: "POST", target: "/metadata/deploy", detail: "checkOnly=false" },
            { verb: "READ", target: "External Client App metadata", detail: "resulting state" },
          ],
        },
      ],
      sections: [
        {
          icon: "🛡️",
          title: "Proof",
          rows: [
            { label: "Components", value: "3/3 present", tone: "success" },
            {
              label: "Consumer key",
              value: verification.consumer_key ? "available" : "pending propagation",
              tone: verification.consumer_key ? "success" : "warning",
            },
            {
              label: "Configuration",
              value: verified ? "callback, scopes, PKCE, and JWT match" : findings.join("; "),
              tone: verified ? "success" : "warning",
            },
          ],
        },
      ],
      artifacts: [{ label: "run", path: artifact.path, kind: "json" }],
      next: [
        verification.consumer_key
          ? "Run mcp.handoff to copy the client ID into SF MCP."
          : "Wait for app propagation, then run setup.verify or mcp.handoff again.",
      ],
    },
    {
      app_name: plan.app_name,
      verified,
      findings,
      consumer_key_available: Boolean(verification.consumer_key),
      check_job_id: check.id,
      deploy_job_id: deployed.id,
      artifact: artifact.path,
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
  const findings = verificationFindings(inspection);
  const artifact = await writeIntegrationArtifact(
    "verification",
    `${integrationArtifactTimestamp()}-${appName}-verify.json`,
    inspection,
  );
  const ready = findings.length === 0 && Boolean(inspection.consumer_key);
  return result(
    "setup.verify",
    `${ready ? "PASS" : "REVIEW"}: ${appName} verification${findings.length ? ` · ${findings.join("; ")}` : ""}.`,
    verificationCard(session, appName, inspection, findings, ready, artifact.path),
    {
      app_name: appName,
      ready,
      findings,
      consumer_key_available: Boolean(inspection.consumer_key),
      artifact: artifact.path,
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
  const handoff = {
    preset,
    server_name: SF_MCP_HEADLESS_360_REQUIREMENT.serverName,
    app_name: appName,
    consumer_key: inspection.consumer_key,
    callback_url: SF_MCP_HEADLESS_360_REQUIREMENT.callbackUrl,
    oauth_scopes: [...SF_MCP_HEADLESS_360_REQUIREMENT.oauthScopes],
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
      "Next: Open /sf-mcp → Headless 360 → Configure MCP, select the org environment, and paste the consumer key.",
      "Then run /mcp login salesforce-headless-360 after reload.",
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
      next: ["Open /sf-mcp and paste the consumer key into the Headless 360 setup."],
    },
    { handoff, artifact: artifact.path },
  );
}

function verificationCard(
  session: SalesforceSession,
  appName: string,
  inspection: EcaInspection,
  findings: string[],
  ready: boolean,
  artifactPath: string,
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
    next: [ready ? "Run mcp.handoff." : "Resolve the first finding and verify again."],
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

function shortId(value: string | undefined): string {
  if (!value) return "—";
  return value.length > 10 ? `${value.slice(0, 3)}…${value.slice(-4)}` : value;
}
