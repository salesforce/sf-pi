/* SPDX-License-Identifier: Apache-2.0 */
/** Generic External Client App OAuth flow lifecycle operations. */

import type { SfPiResultCard } from "../../../lib/common/display/result-card.ts";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { integrationArtifactTimestamp, writeIntegrationArtifact } from "./artifacts.ts";
import {
  assertInboundPlanMatches,
  assertInboundPlanTarget,
  buildInboundPlan,
} from "./inbound-plans.ts";
import {
  defaultIntegrationAdapter,
  inspectTokenExchangeHandler,
  isCompleteEca,
  missingRequiredMetadataTypes,
} from "./metadata.ts";
import type {
  DeployableMetadataSource,
  EcaInspection,
  InboundIntegrationPlan,
  IntegrationAdapter,
  IntegrationDeploymentResult,
  SfIntegrateParams,
  SfIntegrateSessionState,
  ToolResult,
} from "./types.ts";

const TOOL = { id: "sf-integrate", label: "SF Integrate", icon: "🔗" } as const;

export async function designInboundPlan(
  params: SfIntegrateParams,
  session: SalesforceSession,
  state: SfIntegrateSessionState,
  cwd: string,
  adapter: IntegrationAdapter = defaultIntegrationAdapter,
): Promise<ToolResult> {
  const available = await adapter.describeMetadataTypes(session);
  const missing = missingRequiredMetadataTypes(available);
  if (missing.length) {
    throw new Error(`The target org is missing required metadata types: ${missing.join(", ")}.`);
  }
  if (params.eca_flow === "token_exchange" && !available.has("OauthTokenExchangeHandler")) {
    throw new Error("The target org doesn't support OauthTokenExchangeHandler metadata.");
  }
  const contactEmail = await resolveEmail(params.contact_email, session, adapter);
  const plan = await buildInboundPlan(params, session, cwd, contactEmail);
  await validateFlowPrerequisites(plan, session);
  const existing = await adapter.inspectEca(session, plan.app_name);
  const existingTypes = Object.entries(existing.components)
    .filter(([, present]) => present)
    .map(([type]) => type);
  if (existingTypes.length) {
    throw new Error(
      `External Client App ${plan.app_name} already has ${existingTypes.join(", ")}. Inbound hardening is create-only.`,
    );
  }
  if (
    plan.expected.token_exchange_handler &&
    (await inspectTokenExchangeHandler(session, plan.expected.token_exchange_handler))
  ) {
    throw new Error(
      `OauthTokenExchangeHandler ${plan.expected.token_exchange_handler} already exists.`,
    );
  }
  state.inboundPlans.set(plan.plan_id, plan);
  return result(
    "design.plan",
    [
      `REVIEW: ${plan.eca_flow} External Client App plan for ${plan.app_name}.`,
      `Plan ID: ${plan.plan_id}`,
      `Plan hash: ${plan.plan_hash}`,
      `Components: ${plan.sources.map((source) => source.type).join(", ")}`,
      `Artifact: ${plan.artifact_path}`,
    ].join("\n"),
    {
      tool: TOOL,
      title: `ECA Plan · ${flowLabel(plan.eca_flow)}`,
      status: "warning",
      summary: `Create and verify one ${plan.eca_flow} External Client App profile.`,
      chips: [
        { label: plan.eca_flow, tone: "info" },
        { label: `${plan.sources.length} components`, tone: "muted" },
      ],
      scope: [...orgScope(session), { label: "app", value: plan.app_name, tone: "info" }],
      rails: [
        {
          label: "API",
          items: [
            { verb: "POST", target: "/metadata/deploy", detail: "checkOnly=true" },
            { verb: "POST", target: "/metadata/deploy", detail: "exact profile deploy" },
            { verb: "READ", target: "4 ECA metadata components", detail: "resulting state" },
          ],
        },
      ],
      sections: [
        {
          icon: "🔐",
          title: "Flow Profile",
          rows: profileRows(plan),
        },
        {
          icon: "🛡️",
          title: "Policy",
          rows: [
            { label: "Permitted users", value: plan.expected.permitted_users_policy },
            {
              label: "Client user",
              value: plan.expected.client_credentials_user ?? "not applicable",
            },
            { label: "Existing app", value: "updates refused" },
          ],
        },
      ],
      artifacts: plan.artifact_path
        ? [{ label: "plan", path: plan.artifact_path, kind: "json" }]
        : undefined,
      next: ["Review the plan, then call setup.apply with the exact plan ID, hash, and app name."],
    },
    {
      direction: "inbound",
      plan_id: plan.plan_id,
      plan_hash: plan.plan_hash,
      app_name: plan.app_name,
      eca_flow: plan.eca_flow,
      artifact: plan.artifact_path,
    },
  );
}

export async function applyInboundSetup(
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
  const plan = currentPlan(params, session, state);
  const before = await adapter.inspectEca(session, plan.app_name);
  if (Object.values(before.components).some(Boolean)) {
    throw new Error(
      `External Client App ${plan.app_name} changed after planning. No deployment was attempted.`,
    );
  }
  const handlerSources = plan.sources.filter(
    (source) => source.type === "OauthTokenExchangeHandler",
  );
  const coreSources = plan.sources.filter((source) => source.type !== "OauthTokenExchangeHandler");
  const core = await deployCheckedSources(adapter, session, coreSources, signal, "ECA");
  const handler = handlerSources.length
    ? await deployCheckedSources(adapter, session, handlerSources, signal, "Token Exchange handler")
    : undefined;
  const inspection = await inspectInboundState(session, plan, adapter);
  const findings = inboundVerificationFindings(plan, inspection);
  const artifact = await writeIntegrationArtifact(
    "runs",
    `${integrationArtifactTimestamp()}-${plan.app_name}-${plan.eca_flow}-apply.json`,
    {
      plan,
      check: core.check.raw,
      deploy: core.deployed.raw,
      handler_check: handler?.check.raw,
      handler_deploy: handler?.deployed.raw,
      inspection,
    },
  );
  const verified = findings.length === 0;
  return result(
    "setup.apply",
    `${verified ? "PASS" : "REVIEW"}: ${plan.eca_flow} ECA ${plan.app_name} deployed. Artifact: ${artifact.path}`,
    inboundCard(session, plan, inspection, findings, artifact.path, verified),
    {
      direction: "inbound",
      app_name: plan.app_name,
      eca_flow: plan.eca_flow,
      verified,
      findings,
      consumer_key_available: Boolean(inspection.consumer_key),
      artifact: artifact.path,
    },
    !verified,
  );
}

async function deployCheckedSources(
  adapter: IntegrationAdapter,
  session: SalesforceSession,
  sources: DeployableMetadataSource[],
  signal: AbortSignal | undefined,
  label: string,
): Promise<{
  check: IntegrationDeploymentResult;
  deployed: IntegrationDeploymentResult;
}> {
  const check = await adapter.deploy({ session, sources, checkOnly: true, signal });
  if (!check.success) {
    throw new Error(
      `${label} check-only failed: ${check.component_failures.map((failure) => failure.problem).join("; ")}`,
    );
  }
  const deployed = await adapter.deploy({ session, sources, checkOnly: false, signal });
  if (!deployed.success) {
    throw new Error(
      `${label} deployment failed: ${deployed.component_failures.map((failure) => failure.problem).join("; ")}`,
    );
  }
  return { check, deployed };
}

export async function verifyInboundSetup(
  params: SfIntegrateParams,
  session: SalesforceSession,
  state: SfIntegrateSessionState,
  adapter: IntegrationAdapter = defaultIntegrationAdapter,
): Promise<ToolResult> {
  const plan = currentPlan(params, session, state);
  const inspection = await inspectInboundState(session, plan, adapter);
  const findings = inboundVerificationFindings(plan, inspection);
  const artifact = await writeIntegrationArtifact(
    "verification",
    `${integrationArtifactTimestamp()}-${plan.app_name}-${plan.eca_flow}-verify.json`,
    inspection,
  );
  const verified = findings.length === 0;
  return result(
    "setup.verify",
    `${verified ? "PASS" : "REVIEW"}: ${plan.eca_flow} ECA ${plan.app_name}${findings.length ? ` · ${findings.join("; ")}` : ""}.`,
    inboundCard(session, plan, inspection, findings, artifact.path, verified),
    {
      direction: "inbound",
      app_name: plan.app_name,
      eca_flow: plan.eca_flow,
      verified,
      findings,
      artifact: artifact.path,
    },
    !verified,
  );
}

export function inboundVerificationFindings(
  plan: InboundIntegrationPlan,
  inspection: EcaInspection,
): string[] {
  const findings: string[] = [];
  if (!isCompleteEca(inspection)) findings.push("one or more ECA components are missing");
  if (inspection.callback_url !== plan.callback_url) findings.push("callback URL mismatch");
  const scopes = new Set(inspection.metadata_scopes);
  const missingScopes = plan.metadata_scopes.filter((scope) => !scopes.has(scope));
  if (missingScopes.length) findings.push(`missing scopes ${missingScopes.join(", ")}`);
  compareBoolean(
    findings,
    "consumer secret optional",
    inspection.consumer_secret_optional,
    plan.expected.consumer_secret_optional,
  );
  compareBoolean(findings, "PKCE required", inspection.pkce_required, plan.expected.pkce_required);
  compareBoolean(
    findings,
    "refresh-token secret requirement",
    inspection.secret_required_for_refresh_token,
    plan.expected.secret_required_for_refresh_token,
  );
  compareBoolean(
    findings,
    "client credentials flow",
    inspection.client_credentials_enabled,
    plan.expected.client_credentials_enabled,
  );
  compareBoolean(
    findings,
    "device flow",
    inspection.device_flow_enabled,
    plan.expected.device_flow_enabled,
  );
  compareBoolean(
    findings,
    "token exchange flow",
    inspection.token_exchange_enabled,
    plan.expected.token_exchange_enabled,
  );
  compareBoolean(
    findings,
    "token exchange secret requirement",
    inspection.token_exchange_secret_required,
    plan.expected.token_exchange_secret_required,
  );
  compareBoolean(
    findings,
    "JWT certificate",
    inspection.certificate_present,
    plan.expected.certificate_present,
  );
  if (
    plan.expected.client_credentials_user &&
    inspection.client_credentials_user !== plan.expected.client_credentials_user
  ) {
    findings.push("client credentials execution user mismatch");
  }
  if (inspection.permitted_users_policy !== plan.expected.permitted_users_policy) {
    findings.push("permitted-users policy mismatch");
  }
  if (plan.expected.token_exchange_handler) {
    const handler = inspection.token_exchange_handler;
    if (!handler) {
      findings.push("token exchange handler metadata missing");
    } else {
      if (stringValue(handler.tokenHandlerApex) !== plan.expected.token_exchange_apex) {
        findings.push("token exchange Apex class mismatch");
      }
      if (!booleanValue(handler.isEnabled)) findings.push("token exchange handler disabled");
      if (!booleanValue(handler.isJwtSupported)) {
        findings.push("token exchange handler doesn't support JWT subject tokens");
      }
      const enablement = firstRecord(handler.enablements);
      if (stringValue(enablement?.externalClientApp) !== plan.app_name) {
        findings.push("token exchange handler app enablement mismatch");
      }
      if (stringValue(enablement?.apexExecutionUser) !== plan.expected.token_exchange_user) {
        findings.push("token exchange handler execution user mismatch");
      }
    }
  }
  return findings;
}

function currentPlan(
  params: SfIntegrateParams,
  session: SalesforceSession,
  state: SfIntegrateSessionState,
): InboundIntegrationPlan {
  const plan = assertInboundPlanMatches(state.inboundPlans.get(params.plan_id ?? ""), {
    planId: params.plan_id,
    planHash: params.plan_hash,
    appName: params.app_name,
  });
  assertInboundPlanTarget(plan, session);
  return plan;
}

async function validateFlowPrerequisites(
  plan: InboundIntegrationPlan,
  session: SalesforceSession,
): Promise<void> {
  if (plan.eca_flow === "jwt_bearer" || plan.eca_flow === "token_exchange") {
    const permissionSet =
      plan.expected.permitted_users_policy === "AdminApprovedPreAuthorized"
        ? plan.sources.find((source) => source.type === "ExtlClntAppOauthConfigurablePolicies")
        : undefined;
    if (!permissionSet) {
      throw new Error(`${flowLabel(plan.eca_flow)} requires an admin-approved policy.`);
    }
    const requestedName = extractPolicyPermissionSet(permissionSet.source);
    const result = await session.query<Record<string, unknown>>({
      soql: `SELECT Id FROM PermissionSet WHERE Name = '${escapeSoqlLiteral(requestedName)}' LIMIT 1`,
      api: "rest",
      maxRows: 1,
    });
    if (!result.records.length) {
      throw new Error(
        `Permission Set ${requestedName} was not found for ${flowLabel(plan.eca_flow)} pre-authorization.`,
      );
    }
  }
  if (plan.eca_flow === "token_exchange") {
    const handlerName = plan.expected.token_exchange_handler;
    const apexName = plan.expected.token_exchange_apex;
    const executionUser = plan.expected.token_exchange_user;
    if (!handlerName || !apexName || !executionUser) {
      throw new Error("Token Exchange requires handler, Apex class, and execution user inputs.");
    }
    const [apex, user] = await Promise.all([
      session.query<Record<string, unknown>>({
        soql: `SELECT Id FROM ApexClass WHERE Name = '${escapeSoqlLiteral(apexName)}' LIMIT 1`,
        api: "tooling",
        maxRows: 1,
      }),
      session.query<Record<string, unknown>>({
        soql: `SELECT Id FROM User WHERE Username = '${escapeSoqlLiteral(executionUser)}' AND IsActive = true LIMIT 1`,
        api: "rest",
        maxRows: 1,
      }),
    ]);
    if (!apex.records.length) {
      throw new Error(`Token Exchange Apex class ${apexName} was not found.`);
    }
    if (!user.records.length) {
      throw new Error(`Token Exchange execution user ${executionUser} was not found or inactive.`);
    }
  }
  if (plan.eca_flow === "client_credentials") {
    const username = plan.expected.client_credentials_user;
    if (!username) throw new Error("client_credentials_user is required.");
    const result = await session.query<{
      Id: string;
      Profile?: { PermissionsApiUserOnly?: boolean };
    }>({
      soql: `SELECT Id, Profile.PermissionsApiUserOnly FROM User WHERE Username = '${escapeSoqlLiteral(username)}' LIMIT 1`,
      api: "rest",
      maxRows: 1,
    });
    if (!result.records.length) {
      throw new Error(`Client Credentials execution user ${username} was not found.`);
    }
    if (result.records[0]?.Profile?.PermissionsApiUserOnly !== true) {
      throw new Error(
        `Client Credentials execution user ${username} must use an API Only profile.`,
      );
    }
  }
}

async function inspectInboundState(
  session: SalesforceSession,
  plan: InboundIntegrationPlan,
  adapter: IntegrationAdapter,
): Promise<EcaInspection> {
  const inspection = await adapter.inspectEca(session, plan.app_name);
  if (plan.expected.token_exchange_handler) {
    inspection.token_exchange_handler = await inspectTokenExchangeHandler(
      session,
      plan.expected.token_exchange_handler,
    );
  }
  return inspection;
}

function extractPolicyPermissionSet(source: string): string {
  const match = source.match(
    /<commaSeparatedPermissionSet>([^<]+)<\/commaSeparatedPermissionSet>/u,
  );
  if (!match?.[1]) throw new Error("JWT Bearer policy has no Permission Set.");
  return decodeXml(match[1]);
}

function inboundCard(
  session: SalesforceSession,
  plan: InboundIntegrationPlan,
  inspection: EcaInspection,
  findings: string[],
  artifactPath: string,
  verified: boolean,
): SfPiResultCard {
  return {
    tool: TOOL,
    title: `ECA ${flowLabel(plan.eca_flow)} · ${verified ? "verified" : "review"}`,
    status: verified ? "success" : "warning",
    summary: verified
      ? "All planned ECA profile components match the selected OAuth flow."
      : "The ECA deployed, but one or more flow settings need review.",
    scope: [...orgScope(session), { label: "app", value: plan.app_name, tone: "info" }],
    sections: [
      {
        icon: verified ? "✅" : "⚠️",
        title: "Flow State",
        rows: [
          { label: "Flow", value: plan.eca_flow },
          {
            label: "Components",
            value: `${presentCount(inspection)}/4 ECA${plan.expected.token_exchange_handler ? " + handler" : ""}`,
          },
          { label: "Callback", value: inspection.callback_url ?? "missing" },
          { label: "Scopes", value: inspection.metadata_scopes.join(" · ") || "missing" },
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
    artifacts: [{ label: "evidence", path: artifactPath, kind: "json" }],
    next: [
      verified
        ? "Run the flow-specific handshake proof or retain the app for client configuration."
        : "Resolve the first finding and verify again.",
    ],
  };
}

function profileRows(plan: InboundIntegrationPlan) {
  return [
    { label: "Flow", value: plan.eca_flow },
    { label: "Callback", value: plan.callback_url },
    { label: "Scopes", value: plan.metadata_scopes.join(" · ") },
    { label: "PKCE", value: String(plan.expected.pkce_required) },
    {
      label: "Client secret",
      value: plan.expected.consumer_secret_optional ? "optional" : "required",
    },
    {
      label: "Certificate",
      value: plan.expected.certificate_present ? "embedded public PEM" : "not used",
    },
    ...(plan.expected.token_exchange_handler
      ? [
          {
            label: "Token handler",
            value: `${plan.expected.token_exchange_handler} · ${plan.expected.token_exchange_apex}`,
          },
        ]
      : []),
  ];
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  const item = Array.isArray(value) ? value[0] : value;
  return item && typeof item === "object" && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true";
}

function compareBoolean(
  findings: string[],
  label: string,
  actual: boolean | undefined,
  expected: boolean,
): void {
  if (actual !== expected)
    findings.push(`${label} expected ${expected}, observed ${String(actual)}`);
}

async function resolveEmail(
  explicit: string | undefined,
  session: SalesforceSession,
  adapter: IntegrationAdapter,
): Promise<string> {
  const value = explicit?.trim() || (await adapter.resolveContactEmail(session));
  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
    throw new Error("contact_email is required because no valid target-user email was resolved.");
  }
  return value;
}

function presentCount(inspection: EcaInspection): number {
  return Object.values(inspection.components).filter(Boolean).length;
}

function flowLabel(flow: InboundIntegrationPlan["eca_flow"]): string {
  return flow
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function orgScope(session: SalesforceSession): NonNullable<SfPiResultCard["scope"]> {
  return [
    { label: "org", value: session.target.alias ?? session.target.targetOrg, tone: "info" },
    { label: "type", value: session.target.orgType },
    { label: "api", value: session.target.apiVersion },
  ];
}

function escapeSoqlLiteral(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'");
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

function assertNonProduction(session: SalesforceSession): void {
  if (!["sandbox", "scratch", "developer", "trial"].includes(session.target.orgType)) {
    throw new Error("SF Integrate inbound mutation refuses production or unknown orgs.");
  }
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
