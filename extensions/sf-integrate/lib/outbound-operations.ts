/* SPDX-License-Identifier: Apache-2.0 */
/** Human-facing outbound credential lifecycle operations. */

import type { SfPiResultCard } from "../../../lib/common/display/result-card.ts";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { integrationArtifactTimestamp, writeIntegrationArtifact } from "./artifacts.ts";
import {
  applyOutboundPlan,
  getOutboundAuthorizationUrl,
  inspectOutbound,
  outboundVerificationFindings,
  populateOutboundSecret,
  signingCertificateExists,
} from "./outbound-api.ts";
import {
  assertOutboundPlanMatches,
  assertOutboundPlanTarget,
  buildOutboundPlan,
  requireApiName,
} from "./outbound-plans.ts";
import type {
  OutboundInspection,
  OutboundIntegrationPlan,
  SfIntegrateParams,
  SfIntegrateSessionState,
  ToolResult,
} from "./types.ts";

const TOOL = { id: "sf-integrate", label: "SF Integrate", icon: "🔗" } as const;

export async function designOutboundPlan(
  params: SfIntegrateParams,
  session: SalesforceSession,
  state: SfIntegrateSessionState,
): Promise<ToolResult> {
  const plan = await buildOutboundPlan(params, session);
  if (
    plan.auth_type === "oauth_jwt_bearer" &&
    params.signing_certificate &&
    !(await signingCertificateExists(session, params.signing_certificate))
  ) {
    throw new Error(
      `Signing certificate ${params.signing_certificate} was not found in the target org.`,
    );
  }
  const existing = await inspectOutbound(session, inspectionInput(plan));
  const existingNames = existingResourceNames(plan, existing);
  if (existingNames.length) {
    throw new Error(
      `Outbound setup is create-only; existing resources: ${existingNames.join(", ")}. Choose new names or verify the existing stack.`,
    );
  }
  state.outboundPlans.set(plan.plan_id, plan);
  const steps = [
    ...(plan.identity_provider_name ? ["identity provider"] : []),
    "external credential",
    "named credential",
    "permission set",
    "principal access",
    ...(plan.assign_to_current_user ? ["current-user assignment"] : []),
  ];
  return result(
    "design.plan",
    [
      `REVIEW: Outbound ${plan.auth_type} plan for ${plan.named_credential_name}.`,
      `Plan ID: ${plan.plan_id}`,
      `Plan hash: ${plan.plan_hash}`,
      `Steps: ${steps.join(", ")}`,
      `Artifact: ${plan.artifact_path}`,
    ].join("\n"),
    {
      tool: TOOL,
      title: "Outbound Integration Plan",
      status: "warning",
      summary: `Create a modern ${plan.auth_type} Named Credential stack for ${plan.endpoint_url}.`,
      chips: [
        { label: plan.auth_type, tone: "info" },
        { label: "create-only", tone: "warning" },
      ],
      scope: [
        ...orgScope(session),
        { label: "named cred", value: plan.named_credential_name, tone: "info" },
        { label: "external cred", value: plan.external_credential_name },
      ],
      rails: [
        {
          label: "API",
          items: [
            {
              verb: plan.external_credential_source ? "SOAP" : "POST",
              target: plan.external_credential_source
                ? "/metadata/deploy"
                : "/named-credentials/external-credentials",
              detail: plan.external_credential_source
                ? "check-only before Custom credential deploy"
                : "Connect REST create",
            },
            {
              verb: "POST",
              target: "/named-credentials/named-credential-setup",
              detail: "Connect REST create",
            },
            {
              verb: "POST",
              target: "PermissionSet + SetupEntityAccess",
              detail: "principal authorization",
            },
          ],
        },
      ],
      sections: [
        {
          icon: "🔐",
          title: "Authentication",
          rows: [
            { label: "Protocol", value: plan.auth_type },
            { label: "Principal", value: `${plan.principal_type} · ${plan.principal_name}` },
            {
              label: "Secret step",
              value: plan.credential_shape.length
                ? `${plan.credential_shape.join(" + ")} through secret.populate`
                : "none · signing certificate",
              tone: plan.credential_shape.length ? "warning" : "success",
            },
            { label: "Endpoint", value: plan.endpoint_url },
          ],
        },
        {
          icon: "🛡️",
          title: "Authorization",
          rows: [
            { label: "Permission set", value: plan.permission_set_name },
            {
              label: "Assignment",
              value: plan.assign_to_current_user ? "authenticated user" : "not assigned",
            },
            { label: "Update mode", value: "existing resources refused" },
          ],
        },
      ],
      artifacts: plan.artifact_path
        ? [{ label: "plan", path: plan.artifact_path, kind: "json" }]
        : undefined,
      next: [
        "Review the exact plan, then call setup.apply with the plan ID, hash, and named credential name.",
      ],
    },
    {
      direction: "outbound",
      plan_id: plan.plan_id,
      plan_hash: plan.plan_hash,
      named_credential_name: plan.named_credential_name,
      external_credential_name: plan.external_credential_name,
      artifact: plan.artifact_path,
    },
  );
}

export async function applyOutboundSetup(
  params: SfIntegrateParams,
  session: SalesforceSession,
  state: SfIntegrateSessionState,
  signal?: AbortSignal,
): Promise<ToolResult> {
  if (params.allow_mutation !== true) {
    throw new Error(
      "setup.apply requires allow_mutation=true; Guardrail approval remains separate.",
    );
  }
  assertNonProduction(session);
  const plan = currentPlan(params, session, state);
  const evidence = await applyOutboundPlan(session, plan, signal);
  const findings = outboundVerificationFindings(plan, evidence.verification);
  const artifact = await writeIntegrationArtifact(
    "runs",
    `${integrationArtifactTimestamp()}-${plan.named_credential_name}-outbound-apply.json`,
    { plan, evidence },
  );
  const readyForSecret = findings.length === 0;
  return result(
    "setup.apply",
    `${readyForSecret ? "PASS" : "REVIEW"}: Outbound stack ${plan.named_credential_name} created. Artifact: ${artifact.path}`,
    outboundCard(session, plan, evidence.verification, findings, {
      title: `Outbound Setup · ${readyForSecret ? "created" : "review"}`,
      summary: readyForSecret
        ? "The modern Named Credential stack and principal access are present."
        : "One or more created resources need resulting-state review.",
      status: readyForSecret ? "success" : "warning",
      artifactPath: artifact.path,
      next: nextAfterApply(plan),
    }),
    {
      direction: "outbound",
      named_credential_name: plan.named_credential_name,
      external_credential_name: plan.external_credential_name,
      ready_for_secret: readyForSecret,
      findings,
      artifact: artifact.path,
    },
    !readyForSecret,
  );
}

export async function populateOutboundSecretOperation(
  params: SfIntegrateParams,
  session: SalesforceSession,
  state: SfIntegrateSessionState,
  secret: string,
  signal?: AbortSignal,
): Promise<ToolResult> {
  if (params.allow_mutation !== true) {
    throw new Error(
      "secret.populate requires allow_mutation=true; Guardrail approval remains separate.",
    );
  }
  assertNonProduction(session);
  const plan = currentPlan(params, session, state);
  if (plan.credential_shape.length === 0) {
    throw new Error(`${plan.auth_type} has no secret.populate step.`);
  }
  const response = await populateOutboundSecret(session, plan, {
    clientId: params.client_id,
    secret,
    signal,
  });
  const verification = await inspectOutbound(session, inspectionInput(plan));
  const findings = outboundVerificationFindings(plan, verification, {
    requireConfigured: plan.auth_type !== "oauth_browser",
  });
  const artifact = await writeIntegrationArtifact(
    "runs",
    `${integrationArtifactTimestamp()}-${plan.named_credential_name}-secret-populate.json`,
    { response, verification },
  );
  const configured = findings.length === 0;
  return result(
    "secret.populate",
    `${configured ? "PASS" : "REVIEW"}: ${plan.external_credential_name} credential values submitted without persistence in SF Pi.`,
    outboundCard(session, plan, verification, findings, {
      title: `Credential Population · ${configured ? "configured" : "review"}`,
      summary: configured
        ? "Salesforce accepted the secret values and reports the planned credential state."
        : "Salesforce accepted the request, but credential verification needs review.",
      status: configured ? "success" : "warning",
      artifactPath: artifact.path,
      next:
        plan.auth_type === "oauth_browser"
          ? "Run oauth.authorize to complete browser consent."
          : "Run setup.verify, then connection.test with a safe GET path.",
    }),
    {
      direction: "outbound",
      configured,
      findings,
      secret_persisted_by_sf_pi: false,
      artifact: artifact.path,
    },
    !configured,
  );
}

export async function authorizeOutboundOAuth(
  params: SfIntegrateParams,
  session: SalesforceSession,
  state: SfIntegrateSessionState,
  signal?: AbortSignal,
): Promise<ToolResult> {
  if (params.allow_mutation !== true) {
    throw new Error(
      "oauth.authorize requires allow_mutation=true; Guardrail approval remains separate.",
    );
  }
  const plan = currentPlan(params, session, state);
  const authorizationUrl = await getOutboundAuthorizationUrl(session, plan, signal);
  return result(
    "oauth.authorize",
    [
      "ACTION REQUIRED: Open the OAuth authorization URL and complete consent.",
      authorizationUrl,
      "Then run setup.verify again.",
    ].join("\n"),
    {
      tool: TOOL,
      title: "OAuth Authorization · user action required",
      status: "warning",
      summary: "Salesforce generated the provider consent URL for the planned principal.",
      scope: [
        ...orgScope(session),
        { label: "external cred", value: plan.external_credential_name },
        { label: "principal", value: plan.principal_name },
      ],
      sections: [
        {
          icon: "🌐",
          title: "Consent",
          rows: [
            { label: "URL", value: authorizationUrl, tone: "info" },
            { label: "Tokens", value: "stored only by Salesforce", tone: "success" },
          ],
        },
      ],
      next: ["Complete consent in the browser, then run setup.verify."],
    },
    { direction: "outbound", authorization_url: authorizationUrl },
  );
}

export async function verifyOutboundSetup(
  params: SfIntegrateParams,
  session: SalesforceSession,
  state: SfIntegrateSessionState,
): Promise<ToolResult> {
  const plan = currentPlan(params, session, state);
  const inspection = await inspectOutbound(session, inspectionInput(plan));
  const findings = outboundVerificationFindings(plan, inspection, {
    requireConfigured: plan.credential_shape.length > 0,
  });
  const artifact = await writeIntegrationArtifact(
    "verification",
    `${integrationArtifactTimestamp()}-${plan.named_credential_name}-outbound-verify.json`,
    inspection,
  );
  const ready = findings.length === 0;
  return result(
    "setup.verify",
    `${ready ? "PASS" : "REVIEW"}: Outbound stack ${plan.named_credential_name}${findings.length ? ` · ${findings.join("; ")}` : ""}.`,
    outboundCard(session, plan, inspection, findings, {
      title: `Outbound Verification · ${ready ? "ready" : "review"}`,
      summary: ready
        ? "The credential stack, principal authorization, and credential state match the plan."
        : "The outbound stack is incomplete or not yet authenticated.",
      status: ready ? "success" : "warning",
      artifactPath: artifact.path,
      next: ready
        ? "Run connection.test with a bounded GET path."
        : "Resolve the first finding and verify again.",
    }),
    { direction: "outbound", ready, findings, artifact: artifact.path },
    !ready,
  );
}

export async function testOutboundConnection(
  params: SfIntegrateParams,
  session: SalesforceSession,
  executeApex: (body: string) => Promise<unknown>,
): Promise<ToolResult> {
  const namedCredentialName = requireApiName(params.named_credential_name, "named_credential_name");
  const testPath = requireTestPath(params.test_path ?? "/");
  const body = safeGetProbeBody(namedCredentialName, testPath);
  const nested = (await executeApex(body)) as {
    isError?: boolean;
    details?: { ok?: unknown };
    content?: Array<{ type?: string; text?: string }>;
  };
  const ok = nested?.isError !== true && nested?.details?.ok !== false;
  const nestedText = nested?.content?.find((item) => item.type === "text")?.text;
  if (!ok) {
    throw new Error(
      `The bounded GET callout failed${nestedText ? `: ${nestedText.slice(0, 500)}` : "."}`,
    );
  }
  return result(
    "connection.test",
    `PASS: GET callout through callout:${namedCredentialName}${testPath} completed without returning response data.`,
    {
      tool: TOOL,
      title: "Outbound Connection Test · passed",
      status: "success",
      summary: "A bounded GET callout completed through the Named Credential.",
      scope: [
        ...orgScope(session),
        { label: "named cred", value: namedCredentialName, tone: "info" },
        { label: "path", value: testPath },
      ],
      rails: [
        {
          label: "API",
          items: [
            {
              verb: "GET",
              target: `callout:${namedCredentialName}${testPath}`,
              detail: "sf_apex anonymous bounded probe",
            },
          ],
        },
      ],
      sections: [
        {
          icon: "🛡️",
          title: "Boundaries",
          rows: [
            { label: "Method", value: "GET only", tone: "success" },
            { label: "Response", value: "status checked · body not returned" },
          ],
        },
      ],
      next: ["Use the Named Credential from maintainable Apex, Flow, or External Services."],
    },
    { direction: "outbound", named_credential_name: namedCredentialName, test_path: testPath },
  );
}

function currentPlan(
  params: SfIntegrateParams,
  session: SalesforceSession,
  state: SfIntegrateSessionState,
): OutboundIntegrationPlan {
  const plan = assertOutboundPlanMatches(state.outboundPlans.get(params.plan_id ?? ""), {
    planId: params.plan_id,
    planHash: params.plan_hash,
    namedCredentialName: params.named_credential_name,
  });
  assertOutboundPlanTarget(plan, session);
  return plan;
}

function outboundCard(
  session: SalesforceSession,
  plan: OutboundIntegrationPlan,
  inspection: OutboundInspection,
  findings: string[],
  input: {
    title: string;
    summary: string;
    status: "success" | "warning";
    artifactPath: string;
    next: string;
  },
): SfPiResultCard {
  return {
    tool: TOOL,
    title: input.title,
    status: input.status,
    summary: input.summary,
    chips: [{ label: plan.auth_type, tone: "info" }],
    scope: [
      ...orgScope(session),
      { label: "named cred", value: plan.named_credential_name, tone: "info" },
      { label: "external cred", value: plan.external_credential_name },
    ],
    rails: [
      {
        label: "API",
        items: [
          {
            verb: "GET",
            target: "/named-credentials/external-credentials/{name}",
            detail: "resulting state",
          },
          {
            verb: "GET",
            target: "/named-credentials/named-credential-setup/{name}",
            detail: "resulting state",
          },
        ],
      },
    ],
    sections: [
      {
        icon: findings.length ? "⚠️" : "✅",
        title: "Credential Stack",
        rows: [
          {
            label: "External",
            value: inspection.external_credential ? "present" : "missing",
          },
          {
            label: "Named",
            value: inspection.named_credential ? "present" : "missing",
          },
          {
            label: "Principal",
            value: inspection.principal_id ? "present" : "missing",
          },
          {
            label: "Access",
            value: inspection.principal_access_id ? "granted" : "missing",
          },
          {
            label: "Assignment",
            value: plan.assign_to_current_user
              ? inspection.permission_assignment_id
                ? "current user assigned"
                : "missing"
              : "not requested",
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
    artifacts: [{ label: "evidence", path: input.artifactPath, kind: "json" }],
    next: [input.next],
  };
}

function inspectionInput(plan: OutboundIntegrationPlan) {
  return {
    externalCredentialName: plan.external_credential_name,
    namedCredentialName: plan.named_credential_name,
    permissionSetName: plan.permission_set_name,
    identityProviderName: plan.identity_provider_name,
    principalName: plan.principal_name,
    principalType: plan.principal_type,
  };
}

function existingResourceNames(
  plan: OutboundIntegrationPlan,
  inspection: OutboundInspection,
): string[] {
  return [
    inspection.identity_provider ? plan.identity_provider_name : undefined,
    inspection.external_credential ? plan.external_credential_name : undefined,
    inspection.named_credential ? plan.named_credential_name : undefined,
    inspection.permission_set_id ? plan.permission_set_name : undefined,
  ].filter((value): value is string => Boolean(value));
}

function nextAfterApply(plan: OutboundIntegrationPlan): string {
  if (plan.auth_type === "oauth_jwt_bearer") {
    return "Run setup.verify; the signing certificate should configure the principal without a secret.";
  }
  return "Run secret.populate with a masked prompt or environment-variable reference.";
}

function safeGetProbeBody(namedCredentialName: string, testPath: string): string {
  const endpoint = apexString(`callout:${namedCredentialName}${testPath}`);
  return [
    "HttpRequest request = new HttpRequest();",
    `request.setEndpoint('${endpoint}');`,
    "request.setMethod('GET');",
    "HttpResponse response = new Http().send(request);",
    "if (response.getStatusCode() < 200 || response.getStatusCode() >= 400) {",
    "  throw new CalloutException('Outbound GET returned HTTP ' + response.getStatusCode());",
    "}",
    "System.debug('SF_PI_OUTBOUND_PROBE=PASS');",
  ].join("\n");
}

function requireTestPath(value: string): string {
  const normalized = value.trim();
  if (
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    normalized.length > 1_000 ||
    containsUnsafePathCharacter(normalized) ||
    /\b(?:https?|callout):/iu.test(normalized)
  ) {
    throw new Error("test_path must be a relative URL path beginning with one slash.");
  }
  return normalized;
}

function containsUnsafePathCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (character === "\\" || codePoint === undefined || codePoint <= 0x20 || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

function apexString(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'");
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

function orgScope(session: SalesforceSession): NonNullable<SfPiResultCard["scope"]> {
  return [
    { label: "org", value: session.target.alias ?? session.target.targetOrg, tone: "info" },
    { label: "type", value: session.target.orgType },
    { label: "api", value: session.target.apiVersion },
  ];
}

function assertNonProduction(session: SalesforceSession): void {
  if (!["sandbox", "scratch", "developer", "trial"].includes(session.target.orgType)) {
    throw new Error(
      "SF Integrate outbound mutation refuses production or unknown orgs in Phase 2.",
    );
  }
}
