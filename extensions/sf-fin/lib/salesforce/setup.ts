/* SPDX-License-Identifier: Apache-2.0 */
/**
 * `sf_fin action='salesforce'`: the deterministic Fin for Salesforce setup.
 *
 *   readiness            read-only, both halves of the checklist
 *   package_install      plan by default; execute installs one exact 04t
 *   permissions_apply    plan by default; execute deploys the access
 *                        permission set, creates or updates the dedicated Fin
 *                        user, and assigns both permission sets
 *
 * Execution intent is `allow_mutation=true`; SF Guardrail owns approval
 * before this runs. Every execute path re-reads org state afterwards and
 * reports the verified result, never the requested one.
 */
import {
  defaultFinUsername,
  evaluateSalesforceReadiness,
  FIN_ACCESS_PERMISSION_SET,
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

export type SalesforceOperation = "readiness" | "package_install" | "permissions_apply";

export interface SalesforceSetupRequest {
  operation: SalesforceOperation;
  targetOrg: string;
  /** 04t id or Fin's install link. */
  packageVersion?: string;
  username?: string;
  email?: string;
  execute?: boolean;
  signal?: AbortSignal;
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
  if (request.operation === "package_install") {
    return packageInstall(org, facts, request, versionId, described, read);
  }
  return permissionsApply(org, facts, request, username, read);
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
    ok: report.readyToConnect,
    text: lines.join("\n"),
    details: {
      phase: "readiness",
      orgType: facts.orgType,
      packageReady: report.packageReady,
      permissionsReady: report.permissionsReady,
      readyToConnect: report.readyToConnect,
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
  });
  const toAssign = [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET].filter(
    (ps) => !facts.user?.assignedPermissionSets.includes(ps),
  );
  const steps = [
    `- Deploy permission set ${rendered.name}: Case create/read/edit; Contact and Account read/edit; ${rendered.fields.length} field permissions; system permissions ${rendered.userPermissions.join(", ")}. No delete, no View All / Modify All.`,
    rendered.skippedFields.length
      ? `  Skipped (not permissionable in this org): ${rendered.skippedFields.join(", ")}`
      : undefined,
    facts.auditFieldsEnabled === true
      ? undefined
      : `  Not included: InsertFeedSystemFields, which needs "Set Audit Fields upon Record Creation" (Setup → User Interface; an org-wide admin choice SF Fin does not change).`,
    facts.user
      ? `- Fin user ${facts.user.username} exists${facts.user.serviceCloudUser ? "" : "; set Service Cloud User"}.`
      : `- Create user ${username} (profile "${FIN_USER_PROFILE}", Service Cloud User, email ${request.email ? "as given" : "of the connected admin"}).`,
    toAssign.length
      ? `- Assign: ${toAssign.join(", ")}.`
      : "- Both permission sets already assigned.",
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
  if (!report.packageReady) {
    return [
      `Next: sf_fin action='salesforce' operation='package_install' target_org='${targetOrg}' package_version='<04t id or install link from Fin Connect>'.`,
    ];
  }
  if (!report.permissionsReady) {
    return [
      `Next: sf_fin action='salesforce' operation='permissions_apply' target_org='${targetOrg}'.`,
    ];
  }
  return [
    "Next (human): in Fin, Deploy → Salesforce cases → Connect → Connect to Salesforce, approve the OAuth connection, and pick the Fin user. Then rerun readiness and sf_fin action='admin' operation='read' page='salesforce-cases'.",
  ];
}

function fail(
  text: string,
  code: string,
  extra: Record<string, unknown> = {},
): SalesforceSetupResult {
  return { ok: false, text: `❌ ${text}`, details: { phase: "refused", code, ...extra } };
}
