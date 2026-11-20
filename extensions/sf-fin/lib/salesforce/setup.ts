/* SPDX-License-Identifier: Apache-2.0 */
/**
 * `sf_fin action='salesforce'`: the deterministic Fin for Salesforce setup.
 *
 *   readiness            read-only, both halves of the checklist
 *   package_install      plan by default; execute installs one exact 04t
 *   audit_fields_enable  plan by default; execute deploys SecuritySettings with
 *                        only enableAuditFieldsInactiveOwner=true
 *   digital_experiences_enable
 *                        plan by default; execute deploys CommunitiesSettings
 *                        with only enableNetworksEnabled=true (one-way), so
 *                        FeedItem.Visibility exists for Fin
 *   permissions_apply    plan by default; execute deploys the access
 *                        permission set, creates or updates the dedicated Fin
 *                        user, and assigns both permission sets to the Fin
 *                        user and to the integration user
 *   connect              plan by default; execute runs Fin's Connect flow in
 *                        the shared browser (Allow as the CLI user, pick the
 *                        Fin user) and verifies Fin's OAuth token in the org
 *
 * Execution intent is `allow_mutation=true`; SF Guardrail owns approval
 * before this runs. Every execute path re-reads org state afterwards and
 * reports the verified result, never the requested one.
 */
import {
  defaultFinUsername,
  evaluateSalesforceReadiness,
  FIN_ACCESS_PERMISSION_SET,
  FIN_AUDIT_SETTING,
  FIN_DIGITAL_EXPERIENCES_SETTING,
  FIN_ENHANCED_EMAIL_SETTING,
  FIN_FEED_VISIBILITY_FIELD,
  FIN_PACKAGE_NAMESPACE,
  FIN_PACKAGE_PERMISSION_SET,
  FIN_USER_PROFILE,
  isValidUsername,
  parsePackageVersionId,
  renderAccessPermissionSet,
  type ReadinessCheck,
  type ReadinessReport,
  type SalesforceFacts,
} from "./contract.ts";
import type { FinSalesforceOrg } from "./org.ts";
import type { ConnectResult, FinEnvironmentCard } from "./connect.ts";

export type SalesforceOperation =
  | "readiness"
  | "package_install"
  | "audit_fields_enable"
  | "digital_experiences_enable"
  | "enhanced_email_enable"
  | "permissions_apply"
  | "connect"
  | "observe";

/** Runs Fin's Connect runbook; supplied by the service (browser + sign-in). */
export type FinConnectRunner = (input: {
  card: FinEnvironmentCard;
  orgHost: string;
  integrationUsername: string;
  finUserName: string;
}) => Promise<ConnectResult>;

export interface SalesforceSetupRequest {
  operation: SalesforceOperation;
  targetOrg: string;
  /** 04t id or Fin's install link. */
  packageVersion?: string;
  username?: string;
  email?: string;
  /** connect: which Fin environment card to use (default from org type). */
  environment?: FinEnvironmentCard;
  execute?: boolean;
  signal?: AbortSignal;
  /** connect: the browser runbook. */
  connect?: FinConnectRunner;
}

export interface SalesforceSetupResult {
  ok: boolean;
  text: string;
  details: Record<string, unknown>;
}

const ICON: Record<ReadinessCheck["state"], string> = {
  ok: "✅",
  missing: "⏳",
  warn: "⚠️",
  blocked: "❌",
};

const PRODUCTION_LIKE = new Set(["production", "unknown"]);

export async function runSalesforceSetup(
  org: FinSalesforceOrg,
  request: SalesforceSetupRequest,
): Promise<SalesforceSetupResult> {
  const rawVersion = request.packageVersion?.trim();
  const versionId = parsePackageVersionId(rawVersion);
  if (rawVersion && !versionId) {
    return fail(
      "package_version must be a 04t package version id or a Salesforce install link (…installPackage.apexp?p0=04t…).",
      "input",
    );
  }
  if (request.username !== undefined && !isValidUsername(request.username)) {
    return fail("username must look like an email address (max 80 characters).", "input");
  }

  const username = request.username ?? defaultFinUsername(await org.orgId());
  const described = versionId ? await org.describePackageVersion(versionId) : undefined;
  const read = async (): Promise<SalesforceFacts> => ({
    ...(await org.readFacts({ username })),
    requested: described,
  });
  const facts = await read();

  if (request.operation === "readiness") return readiness(facts, request.targetOrg);
  if (request.operation === "observe") return observe(org, facts, request.targetOrg);
  if (request.operation === "package_install") {
    return packageInstall(org, facts, request, versionId, described, read);
  }
  if (request.operation === "digital_experiences_enable") {
    return digitalExperiencesEnable(org, facts, request, read);
  }
  if (request.operation === "audit_fields_enable")
    return auditFieldsEnable(org, facts, request, read);
  if (request.operation === "enhanced_email_enable") {
    return enhancedEmailEnable(org, facts, request, read);
  }
  if (request.operation === "connect") return connect(facts, request, read);
  return permissionsApply(org, facts, request, username, read);
}

/** Fin's live card is login.salesforce.com (production, Developer Edition); test is sandboxes. */
export function defaultEnvironmentCard(orgType: string): FinEnvironmentCard {
  return orgType === "sandbox" || orgType === "scratch" ? "test" : "live";
}

async function connect(
  facts: SalesforceFacts,
  request: SalesforceSetupRequest,
  read: () => Promise<SalesforceFacts>,
): Promise<SalesforceSetupResult> {
  const before = evaluateSalesforceReadiness(facts);
  if (!before.readyToConnect) {
    return fail(
      "Finish the Salesforce side first (package_install, audit_fields_enable, permissions_apply); readiness lists what is missing.",
      "not_ready",
      { checks: before.checks },
    );
  }
  const orgHost = facts.instanceUrl ? new URL(facts.instanceUrl).hostname : undefined;
  const integration = facts.integrationUser;
  if (!orgHost || !integration || !facts.user) {
    return fail("Could not resolve the org host, integration user, or Fin user.", "input");
  }
  const card = request.environment ?? defaultEnvironmentCard(facts.orgType);
  const finUserName = facts.user.name ?? facts.user.username;
  const plan = [
    `Plan: connect Fin to ${request.targetOrg} (${facts.orgType}) in the shared SF Pi browser.`,
    `- Fin: Connect → ${card === "live" ? "Deploy Fin in a live organization" : "Connect Fin to a test organization"} → Connect to Salesforce.`,
    `- Salesforce: approve "Fin for Salesforce" on ${orgHost} as ${integration.username}${facts.oauthConnected ? " (replaces the existing connection)" : ""}.`,
    `- Fin: Salesforce cases → Fin Salesforce user → "${finUserName}" → Save.`,
    "- Uses the saved Fin admin sign-in (/login sf-fin-browser); it is removed from the browser afterwards.",
  ];
  if (request.execute !== true) {
    return {
      ok: true,
      text: [
        ...plan,
        "",
        `To execute: sf_fin action='salesforce' operation='connect' target_org='${request.targetOrg}'${request.environment ? ` environment='${card}'` : ""} allow_mutation=true (SF Guardrail mediates it).`,
      ].join("\n"),
      details: {
        phase: "plan",
        environment: card,
        orgHost,
        integrationUser: integration.username,
        finUser: finUserName,
        alreadyConnected: facts.oauthConnected === true,
      },
    };
  }
  if (!request.connect) return fail("No browser runner is available for connect.", "internal");
  const run = await request.connect({
    card,
    orgHost,
    integrationUsername: integration.username,
    finUserName,
  });
  const after = await read();
  const report = evaluateSalesforceReadiness(after);
  const verified = run.ok && report.connected;
  return {
    ok: verified,
    text: [
      verified
        ? `✅ Fin is connected to ${request.targetOrg} (Fin for Salesforce OAuth token verified in the org) and uses "${finUserName}".`
        : `❌ Fin's connection to ${request.targetOrg} did not complete.`,
      ...run.steps.map((step) => `  ${step}`),
      "",
      ...renderChecks(report),
      "",
      ...nextSteps(report, request.targetOrg),
    ].join("\n"),
    details: {
      phase: "execute",
      environment: card,
      code: run.code,
      connected: report.connected,
      checks: report.checks,
    },
  };
}

async function auditFieldsEnable(
  org: FinSalesforceOrg,
  facts: SalesforceFacts,
  request: SalesforceSetupRequest,
  read: () => Promise<SalesforceFacts>,
): Promise<SalesforceSetupResult> {
  if (facts.auditFieldsEnabled === true) {
    return {
      ok: true,
      text: `✅ "Set Audit Fields upon Record Creation" is already enabled in ${request.targetOrg}. Nothing to do.`,
      details: { phase: "noop", setting: FIN_AUDIT_SETTING },
    };
  }
  if (request.execute !== true) {
    return {
      ok: true,
      text: [
        `Plan: enable the org setting behind "Set Audit Fields upon Record Creation" in ${request.targetOrg} (${facts.orgType}).`,
        `- Deploy SecuritySettings with only ${FIN_AUDIT_SETTING}=true. No other security setting is included, so none changes.`,
        "- This lets permission sets grant Set Audit Fields upon Record Creation and Update Records with Inactive Owners; it grants them to nobody.",
        PRODUCTION_LIKE.has(facts.orgType)
          ? "⚠️ Production or unknown org: SF Guardrail decides whether this may run."
          : undefined,
        "",
        `To execute: sf_fin action='salesforce' operation='audit_fields_enable' target_org='${request.targetOrg}' allow_mutation=true (SF Guardrail mediates it).`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
      details: { phase: "plan", setting: FIN_AUDIT_SETTING, value: true },
    };
  }
  const deployed = await org.enableAuditFields({ signal: request.signal });
  const after = await read();
  const verified = after.auditFieldsEnabled === true;
  const report = evaluateSalesforceReadiness(after);
  return {
    ok: verified,
    text: [
      verified
        ? `✅ "Set Audit Fields upon Record Creation" enabled in ${request.targetOrg} (verified in SecuritySettings).`
        : `❌ The audit field setting did not verify as enabled in ${request.targetOrg}.`,
      ...(verified || deployed.ok ? [] : [`  - ${deployed.error ?? "deploy failed"}`]),
      "",
      ...renderChecks(report),
      "",
      ...nextSteps(report, request.targetOrg),
    ].join("\n"),
    details: { phase: "execute", setting: FIN_AUDIT_SETTING, verified, error: deployed.error },
  };
}

async function digitalExperiencesEnable(
  org: FinSalesforceOrg,
  facts: SalesforceFacts,
  request: SalesforceSetupRequest,
  read: () => Promise<SalesforceFacts>,
): Promise<SalesforceSetupResult> {
  if (facts.digitalExperiencesEnabled === true && facts.feedVisibilityAvailable === true) {
    return {
      ok: true,
      text: `✅ Digital Experiences is already enabled in ${request.targetOrg} and ${FIN_FEED_VISIBILITY_FIELD} exists. Nothing to do.`,
      details: { phase: "noop", setting: FIN_DIGITAL_EXPERIENCES_SETTING },
    };
  }
  if (request.execute !== true) {
    return {
      ok: true,
      text: [
        `Plan: enable Digital Experiences in ${request.targetOrg} (${facts.orgType}) so ${FIN_FEED_VISIBILITY_FIELD} exists for Fin.`,
        `- Deploy CommunitiesSettings with only ${FIN_DIGITAL_EXPERIENCES_SETTING}=true. No other setting is included.`,
        "- ⚠️ One-way: Digital Experiences cannot be turned off again, and the org's Lightning Platform domain name can no longer be changed.",
        "- It creates no site and no external users; it only makes the feature available.",
        PRODUCTION_LIKE.has(facts.orgType)
          ? "⚠️ Production or unknown org: SF Guardrail decides whether this may run."
          : undefined,
        "",
        `To execute: sf_fin action='salesforce' operation='digital_experiences_enable' target_org='${request.targetOrg}' allow_mutation=true (SF Guardrail mediates it).`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
      details: {
        phase: "plan",
        setting: FIN_DIGITAL_EXPERIENCES_SETTING,
        value: true,
        oneWay: true,
      },
    };
  }
  const deployed = await org.enableDigitalExperiences({ signal: request.signal });
  const after = await read();
  const verified =
    after.digitalExperiencesEnabled === true && after.feedVisibilityAvailable === true;
  const report = evaluateSalesforceReadiness(after);
  return {
    ok: verified,
    text: [
      verified
        ? `✅ Digital Experiences enabled in ${request.targetOrg}; ${FIN_FEED_VISIBILITY_FIELD} now exists (verified).`
        : `❌ Digital Experiences or ${FIN_FEED_VISIBILITY_FIELD} did not verify in ${request.targetOrg}.`,
      ...(verified || deployed.ok ? [] : [`  - ${deployed.error ?? "deploy failed"}`]),
      "",
      ...renderChecks(report),
      "",
      ...nextSteps(report, request.targetOrg),
    ].join("\n"),
    details: {
      phase: "execute",
      setting: FIN_DIGITAL_EXPERIENCES_SETTING,
      verified,
      error: deployed.error,
    },
  };
}

async function enhancedEmailEnable(
  org: FinSalesforceOrg,
  facts: SalesforceFacts,
  request: SalesforceSetupRequest,
  read: () => Promise<SalesforceFacts>,
): Promise<SalesforceSetupResult> {
  if (facts.enhancedEmailEnabled === true) {
    return {
      ok: true,
      text: `✅ Enhanced Email is already enabled in ${request.targetOrg}. Nothing to do.`,
      details: { phase: "noop", setting: FIN_ENHANCED_EMAIL_SETTING },
    };
  }
  if (request.execute !== true) {
    return {
      ok: true,
      text: [
        `Plan: enable Enhanced Email in ${request.targetOrg} (${facts.orgType}) so Fin can sync each case's email history.`,
        `- Deploy EmailAdministrationSettings with only ${FIN_ENHANCED_EMAIL_SETTING}=true. No other email setting is included.`,
        "- 🌐 Org-wide: emails are stored as EmailMessage records for every user, not only Fin's cases.",
        PRODUCTION_LIKE.has(facts.orgType)
          ? "⚠️ Production or unknown org: SF Guardrail decides whether this may run."
          : undefined,
        "",
        `To execute: sf_fin action='salesforce' operation='enhanced_email_enable' target_org='${request.targetOrg}' allow_mutation=true (SF Guardrail mediates it).`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
      details: { phase: "plan", setting: FIN_ENHANCED_EMAIL_SETTING, value: true },
    };
  }
  const deployed = await org.enableEnhancedEmail({ signal: request.signal });
  const after = await read();
  const verified = after.enhancedEmailEnabled === true;
  const report = evaluateSalesforceReadiness(after);
  return {
    ok: verified,
    text: [
      verified
        ? `✅ Enhanced Email enabled in ${request.targetOrg} (verified in EmailAdministrationSettings).`
        : `❌ Enhanced Email did not verify as enabled in ${request.targetOrg}.`,
      ...(verified || deployed.ok ? [] : [`  - ${deployed.error ?? "deploy failed"}`]),
      "",
      ...renderChecks(report),
      "",
      ...nextSteps(report, request.targetOrg),
    ].join("\n"),
    details: {
      phase: "execute",
      setting: FIN_ENHANCED_EMAIL_SETTING,
      verified,
      error: deployed.error,
    },
  };
}

/** Fin's resolution states (finai__FinResolutionState__c), from Fin's Cases guide. */
const RESOLVED_STATES = new Set(["Soft Resolution", "Hard Resolution"]);
const ROUTED_STATES = new Set(["Routed to team"]);

async function observe(
  org: FinSalesforceOrg,
  facts: SalesforceFacts,
  targetOrg: string,
): Promise<SalesforceSetupResult> {
  if (!evaluateSalesforceReadiness(facts).packageReady) {
    return fail(
      "The Fin for Salesforce package is not installed, so there are no Fin Case fields to read. Run readiness first.",
      "package_missing",
    );
  }
  const activity = await org.readFinCaseActivity({ finUserId: facts.user?.id });
  const sum = (filter: Set<string>) =>
    Object.entries(activity.byResolution)
      .filter(([state]) => filter.has(state))
      .reduce((total, [, n]) => total + n, 0);
  const resolved = sum(RESOLVED_STATES);
  const routed = sum(ROUTED_STATES);
  const rate = activity.involved > 0 ? resolved / activity.involved : undefined;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lines =
    activity.involved === 0 && activity.finUserOwned === 0
      ? [
          `Fin on Salesforce Cases — ${targetOrg}`,
          "",
          "No case has been worked by Fin yet (finai__FinInvolved__c is false on every case, and the Fin user owns none).",
          "Next: assign one test case to the Fin user (or create one your routing Flow matches), then observe again.",
        ]
      : [
          `Fin on Salesforce Cases — ${targetOrg}`,
          "",
          `Fin-involved cases: ${activity.involved}${rate !== undefined ? ` · resolved ${resolved} (${pct(rate)})` : ""} · routed to team ${routed} · owned by Fin now ${activity.finUserOwned}`,
          `By resolution: ${formatCounts(activity.byResolution)}`,
          `By origin: ${formatCounts(activity.byOrigin)}`,
          "",
          "Recent:",
          ...activity.recent.map(
            (c) =>
              `- ${c.caseNumber} · ${c.status ?? "?"} · ${c.resolution ?? "no Fin state"}${c.ownedByFin ? " · owned by Fin" : ""}${c.origin ? ` · ${c.origin}` : ""}${c.subject ? ` · ${c.subject.slice(0, 80)}` : ""}`,
          ),
        ];
  return {
    ok: true,
    text: lines.join("\n"),
    details: {
      phase: "observe",
      involved: activity.involved,
      finUserOwned: activity.finUserOwned,
      resolved,
      routed,
      ...(rate !== undefined ? { resolutionRate: Math.round(rate * 100) / 100 } : {}),
      byResolution: activity.byResolution,
      byOrigin: activity.byOrigin,
      recent: activity.recent,
    },
  };
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([k, n]) => `${k} ${n}`).join(" · ") : "none";
}

function readiness(facts: SalesforceFacts, targetOrg: string): SalesforceSetupResult {
  const report = evaluateSalesforceReadiness(facts);
  const lines = [
    `Fin for Salesforce readiness — ${targetOrg} (${facts.orgType})`,
    "",
    ...renderChecks(report),
    "",
    ...nextSteps(report, targetOrg),
  ];
  return {
    ok: report.readyToConnect && report.orgFeaturesReady && report.connected,
    text: lines.join("\n"),
    details: {
      phase: "readiness",
      orgType: facts.orgType,
      packageReady: report.packageReady,
      permissionsReady: report.permissionsReady,
      readyToConnect: report.readyToConnect,
      orgFeaturesReady: report.orgFeaturesReady,
      connected: report.connected,
      goLiveReady: report.goLiveReady,
      checks: report.checks,
    },
  };
}

async function packageInstall(
  org: FinSalesforceOrg,
  facts: SalesforceFacts,
  request: SalesforceSetupRequest,
  versionId: string | undefined,
  described: Awaited<ReturnType<FinSalesforceOrg["describePackageVersion"]>>,
  read: () => Promise<SalesforceFacts>,
): Promise<SalesforceSetupResult> {
  if (!versionId) {
    return fail(
      "package_install needs package_version: the 04t id or install link from Fin's Connect page (Deploy → Salesforce cases → Connect → Install package). Fin requires its latest version, so SF Fin never hardcodes one.",
      "input",
    );
  }
  if (!described) {
    return fail(
      `Package version ${versionId} was not found from ${request.targetOrg}.`,
      "not_found",
    );
  }
  if (described.namespace !== FIN_PACKAGE_NAMESPACE) {
    return fail(
      `Package version ${versionId} belongs to namespace "${described.namespace ?? "none"}", not "${FIN_PACKAGE_NAMESPACE}". SF Fin installs only the Fin for Salesforce package.`,
      "wrong_package",
      { namespace: described.namespace },
    );
  }
  if (described.isPasswordProtected) {
    return fail(
      "This package version is password-protected; SF Fin does not handle install keys.",
      "refused",
    );
  }
  if (facts.installed?.versionId === versionId) {
    return {
      ok: true,
      text: `✅ ${described.packageName ?? "Fin for Salesforce"} ${described.version} is already installed in ${request.targetOrg}. Nothing to do.`,
      details: { phase: "noop", versionId, version: described.version },
    };
  }

  const plan = [
    `Plan: install ${described.packageName ?? "Fin for Salesforce"} ${described.version} (${versionId}) into ${request.targetOrg} (${facts.orgType}).`,
    `- Action: ${facts.installed ? `upgrade from ${facts.installed.version}` : "new install"} · namespace ${FIN_PACKAGE_NAMESPACE} · ${described.releaseState ?? "unknown"} release${described.isBeta ? " (beta)" : ""}`,
    "- Security: install for all users (Fin's setup instruction). Name conflicts block the install; nothing is renamed or overwritten.",
    described.remoteSites.length
      ? `- Third-party sites approved with the install: ${described.remoteSites.join(", ")}`
      : "- Third-party sites: none declared.",
    PRODUCTION_LIKE.has(facts.orgType)
      ? "⚠️ Production or unknown org: SF Guardrail decides whether this may run."
      : undefined,
  ].filter((line): line is string => Boolean(line));

  if (request.execute !== true) {
    return {
      ok: true,
      text: [
        ...plan,
        "",
        `To execute: sf_fin action='salesforce' operation='package_install' target_org='${request.targetOrg}' package_version='${versionId}' allow_mutation=true (SF Guardrail mediates it).`,
      ].join("\n"),
      details: {
        phase: "plan",
        versionId,
        version: described.version,
        upgrade: Boolean(facts.installed),
        remoteSites: described.remoteSites,
      },
    };
  }

  const result = await org.installPackage({
    versionId,
    enableRss: described.remoteSites.length > 0,
    signal: request.signal,
  });
  // Installed Packages is the verified outcome; the install request status is
  // only a hint (some orgs cannot read it), so it never overrides the org state.
  const after = await read();
  const verified = after.installed?.versionId === versionId;
  const report = evaluateSalesforceReadiness(after);
  return {
    ok: verified,
    text: [
      verified
        ? `✅ Installed ${described.packageName ?? "Fin for Salesforce"} ${described.version} in ${request.targetOrg} (verified in Installed Packages).`
        : `❌ Install ${result.status}${result.requestId ? ` (request ${result.requestId})` : ""}; the package did not verify as installed.`,
      ...(verified ? [] : result.errors.slice(0, 5).map((error) => `  - ${error}`)),
      "",
      ...renderChecks(report),
      "",
      ...nextSteps(report, request.targetOrg),
    ].join("\n"),
    details: {
      phase: "execute",
      versionId,
      requestId: result.requestId,
      status: result.status,
      verified,
      errors: result.errors,
      checks: report.checks,
    },
  };
}

async function permissionsApply(
  org: FinSalesforceOrg,
  facts: SalesforceFacts,
  request: SalesforceSetupRequest,
  username: string,
  read: () => Promise<SalesforceFacts>,
): Promise<SalesforceSetupResult> {
  const before = evaluateSalesforceReadiness(facts);
  if (!before.packageReady) {
    return fail(
      `Install the Fin for Salesforce package first (sf_fin action='salesforce' operation='package_install'); ${FIN_PACKAGE_PERMISSION_SET} and the Fin Case fields come from it.`,
      "package_missing",
      { checks: before.checks },
    );
  }
  if (!facts.profileExists) {
    return fail(`Profile "${FIN_USER_PROFILE}" not found in ${request.targetOrg}.`, "blocked");
  }
  if (
    !facts.user &&
    facts.profileLicensesAvailable !== undefined &&
    facts.profileLicensesAvailable < 1
  ) {
    return fail(
      `No free license for profile "${FIN_USER_PROFILE}"; free one up or pass an existing username.`,
      "blocked",
    );
  }
  if (facts.user && !facts.user.isActive) {
    return fail(
      `Fin user ${facts.user.username} is inactive; reactivate it in Setup first.`,
      "blocked",
    );
  }

  const rendered = renderAccessPermissionSet({
    permissionableFields: await org.permissionableFields(),
    includeAuditPermissions: facts.auditFieldsEnabled === true,
    availablePermissions: await org.availablePermissions(),
  });
  const both = [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET];
  const toAssign = both.filter((ps) => !facts.user?.assignedPermissionSets.includes(ps));
  // Fin checks the permission sets of the user that authorized (or will
  // authorize) its OAuth connection, which is not the Fin user.
  const integration =
    facts.integrationUser && facts.integrationUser.id !== facts.user?.id
      ? facts.integrationUser
      : undefined;
  const integrationAssign = integration
    ? both.filter((ps) => !integration.assignedPermissionSets.includes(ps))
    : [];
  const steps = [
    `- Deploy permission set ${rendered.name}: Case create/read/edit; Contact create/read/edit; Account read/edit; ${rendered.fields.length} field permissions; system permissions ${rendered.userPermissions.join(", ")}. No delete, no View All / Modify All.`,
    rendered.skippedFields.length
      ? `  Skipped (not permissionable in this org): ${rendered.skippedFields.join(", ")}`
      : undefined,
    facts.auditFieldsEnabled === true
      ? undefined
      : `  Not included: CreateAuditFields (Set Audit Fields upon Record Creation); run operation='audit_fields_enable' first, then permissions_apply again.`,
    facts.user
      ? `- Fin user ${facts.user.username} exists${facts.user.serviceCloudUser ? "" : "; set Service Cloud User"}.`
      : `- Create user ${username} (profile "${FIN_USER_PROFILE}", Service Cloud User, email ${request.email ? "as given" : "of the connected admin"}).`,
    toAssign.length
      ? `- Assign to the Fin user: ${toAssign.join(", ")}.`
      : "- Fin user already has both permission sets.",
    integration
      ? integrationAssign.length
        ? `- Assign to the integration user ${integration.username}${facts.oauthConnected ? " (holds Fin's OAuth connection)" : " (authorizes Fin during connect)"}: ${integrationAssign.join(", ")}.`
        : `- Integration user ${integration.username} already has both permission sets.`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  if (request.execute !== true) {
    return {
      ok: true,
      text: [
        `Plan: Fin for Salesforce permissions and dedicated Fin user in ${request.targetOrg} (${facts.orgType}).`,
        ...steps,
        "",
        `To execute: sf_fin action='salesforce' operation='permissions_apply' target_org='${request.targetOrg}'${request.username ? ` username='${username}'` : ""} allow_mutation=true (SF Guardrail mediates it).`,
      ].join("\n"),
      details: {
        phase: "plan",
        username,
        permissionSet: rendered.name,
        fields: rendered.fields,
        skippedFields: rendered.skippedFields,
        userPermissions: rendered.userPermissions,
        createUser: !facts.user,
        assign: toAssign,
        integrationUser: integration?.username,
        integrationAssign,
      },
    };
  }

  const problems: string[] = [];
  const deployed = await org.deployAccessPermissionSet({
    name: rendered.name,
    xml: rendered.xml,
    signal: request.signal,
  });
  if (!deployed.ok)
    problems.push(`Permission set deploy failed: ${deployed.error ?? "unknown error"}`);

  let userId = facts.user?.id;
  if (deployed.ok && !userId) {
    const admin = await org.connectedUser();
    const created = await org.createFinUser({
      username,
      email: request.email ?? admin.email,
      profileName: FIN_USER_PROFILE,
      defaults: admin,
    });
    if (created.ok) userId = created.id;
    else problems.push(`User create failed: ${created.error ?? "unknown error"}`);
  } else if (deployed.ok && facts.user && !facts.user.serviceCloudUser) {
    const set = await org.setServiceCloudUser(facts.user.id);
    if (!set.ok) problems.push(`Service Cloud User update failed: ${set.error ?? "unknown error"}`);
  }
  if (deployed.ok && userId && toAssign.length) {
    const assigned = await org.assignPermissionSets(userId, toAssign);
    problems.push(...assigned.errors);
  }
  if (deployed.ok && integration && integrationAssign.length) {
    const assigned = await org.assignPermissionSets(integration.id, integrationAssign);
    problems.push(...assigned.errors);
  }

  const report = evaluateSalesforceReadiness(await read());
  return {
    ok: problems.length === 0 && report.permissionsReady,
    text: [
      report.permissionsReady
        ? `✅ Fin permissions and user ready in ${request.targetOrg} (verified).`
        : `❌ Fin permissions are not fully in place in ${request.targetOrg}.`,
      ...problems.map((problem) => `  - ${problem}`),
      "",
      ...renderChecks(report),
      "",
      ...nextSteps(report, request.targetOrg),
    ].join("\n"),
    details: {
      phase: "execute",
      username,
      userId,
      problems,
      permissionsReady: report.permissionsReady,
      checks: report.checks,
    },
  };
}

function renderChecks(report: ReadinessReport): string[] {
  return report.checks.flatMap((check) => [
    `${ICON[check.state]} ${check.title}`,
    ...(check.detail ? [`   ${check.detail}`] : []),
  ]);
}

function nextSteps(report: ReadinessReport, targetOrg: string): string[] {
  const op = (name: string, extra = "") =>
    `Next: sf_fin action='salesforce' operation='${name}' target_org='${targetOrg}'${extra}.`;
  if (!report.packageReady) {
    return [op("package_install", " package_version='<04t id or install link from Fin Connect>'")];
  }
  for (const fix of [
    "audit_fields_enable",
    "digital_experiences_enable",
    "enhanced_email_enable",
  ] as const) {
    if (report.checks.some((check) => check.fix === fix)) return [op(fix)];
  }
  if (!report.permissionsReady) return [op("permissions_apply")];
  if (!report.connected) return [op("connect")];
  if (!report.orgFeaturesReady) {
    return [
      `⚠️ ${FIN_FEED_VISIBILITY_FIELD} is still missing although Digital Experiences is on; check the field in Setup.`,
    ];
  }
  // Go-live gaps in order of impact: access, routing, handoff, then email.
  const goLive = ["effective-access", "case-routing", "handoff-queue", "email-to-case"]
    .map((id) => report.checks.find((check) => check.id === id))
    .find((check) => check !== undefined && check.state !== "ok");
  if (goLive?.fix === "permissions_apply") return [op("permissions_apply")];
  if (goLive) {
    return [
      `⏳ Fin is connected. Before go-live: ${goLive.title}.${goLive.detail ? ` ${goLive.detail}` : ""}`,
    ];
  }
  return [
    "✅ Salesforce side complete, Fin is connected, and cases reach the Fin user. In Fin, click Retry on Connect → Assign permissions in Salesforce if it still shows errors.",
  ];
}

function fail(
  text: string,
  code: string,
  extra: Record<string, unknown> = {},
): SalesforceSetupResult {
  return { ok: false, text: `❌ ${text}`, details: { phase: "refused", code, ...extra } };
}
