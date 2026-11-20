/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fin for Salesforce: the declared Salesforce-side contract.
 *
 * Pure data and pure functions only. Every object, field, and permission here
 * comes from Fin's published setup articles for the Fin for Salesforce
 * managed package (namespace `finai`) and its required permissions; nothing is
 * inferred from a particular org. The Salesforce adapter reads org state and
 * these functions decide readiness and render deployable metadata, so the
 * same inputs always produce the same plan.
 */

/** Namespace of the current Fin for Salesforce managed package. */
export const FIN_PACKAGE_NAMESPACE = "finai";

/** Permission set installed by the managed package (field access only). */
export const FIN_PACKAGE_PERMISSION_SET = `${FIN_PACKAGE_NAMESPACE}__Fin_for_Salesforce_permissions`;

/** Case fields the managed package adds. */
export const FIN_CASE_FIELDS = [
  `${FIN_PACKAGE_NAMESPACE}__FinInvolved__c`,
  `${FIN_PACKAGE_NAMESPACE}__FinResolutionState__c`,
  `${FIN_PACKAGE_NAMESPACE}__FinMarkedAsSpam__c`,
  `${FIN_PACKAGE_NAMESPACE}__FinConversationId__c`,
] as const;

/** Default API name of the second, SF Fin-generated permission set. */
export const FIN_ACCESS_PERMISSION_SET = "SF_Fin_Salesforce_Access";
export const FIN_ACCESS_PERMISSION_SET_LABEL = "SF Fin Salesforce Access";

/** Default alias for the dedicated Fin user. */
export const FIN_USER_ALIAS = "finagent";
/** Profile for the dedicated Fin user: least privilege; access comes from permission sets. */
export const FIN_USER_PROFILE = "Minimum Access - Salesforce";

/**
 * Object permissions Fin documents for the integration user's second
 * permission set. Never View All / Modify All; never Delete.
 */
export const FIN_OBJECT_ACCESS: ReadonlyArray<{
  object: "Case" | "Contact" | "Account";
  create: boolean;
  read: true;
  edit: true;
}> = [
  { object: "Case", create: true, read: true, edit: true },
  // Fin creates a Contact when a case's sender has none (Fin's permission matrix).
  { object: "Contact", create: true, read: true, edit: true },
  { object: "Account", create: false, read: true, edit: true },
];

/**
 * Object access Fin's published permission matrix requires, per user. Case
 * child records (EmailMessage, FeedItem, CaseFeed) follow Case access, so
 * the effective-access check reads Case and Contact.
 */
export const FIN_REQUIRED_ACCESS: Record<
  "fin" | "integration",
  Record<string, Array<"create" | "read" | "edit">>
> = {
  fin: { Case: ["create", "read", "edit"] },
  integration: { Case: ["create", "read", "edit"], Contact: ["create", "read"] },
};

/** EmailAdministrationSettings.enableEnhancedEmailEnabled (Fin syncs case email history through it). */
export const FIN_ENHANCED_EMAIL_SETTING = "enableEnhancedEmailEnabled";

/**
 * Standard field permissions (read + edit) Fin documents. The four `finai__`
 * Case fields are covered by the package's own permission set.
 */
export const FIN_FIELD_ACCESS: readonly string[] = [
  "Case.ContactId",
  "Case.Description",
  "Case.Origin",
  "Case.SourceId",
  "Case.Subject",
  "Case.SuppliedEmail",
  "Case.SuppliedName",
  "Contact.Email",
  "Task.ActivityDate",
  "Task.Description",
  "Task.WhatId",
  "Task.WhoId",
];

/**
 * System permissions Fin documents (Metadata API names; the PermissionSet
 * describe exposes each as `Permissions<Name>`). Only the ones the target org
 * exposes are rendered, so a deploy never names an unknown permission.
 */
export const FIN_SYSTEM_PERMISSIONS: readonly string[] = [
  "ApiEnabled",
  "CanInsertFeedSystemFields",
  "EditTask",
  "ViewAllUsers",
  "ViewRoles",
  "ViewSetup",
];

/**
 * "Set Audit Fields upon Record Creation". The org exposes it only after
 * SecuritySettings.enableAuditFieldsInactiveOwner is on (audit_fields_enable).
 */
export const FIN_AUDIT_PERMISSIONS: readonly string[] = ["CreateAuditFields"];

/** The org-wide setting Fin asks for, as Metadata API SecuritySettings field. */
export const FIN_AUDIT_SETTING = "enableAuditFieldsInactiveOwner";

/**
 * Digital Experiences (CommunitiesSettings.enableNetworksEnabled). Fin needs
 * it because FeedItem.Visibility, which tells internal case comments from
 * public ones, exists only once it is on.
 */
export const FIN_DIGITAL_EXPERIENCES_SETTING = "enableNetworksEnabled";
export const FIN_FEED_VISIBILITY_FIELD = "FeedItem.Visibility";

/** OAuth app name the Fin for Salesforce package's External Client App uses. */
export const FIN_OAUTH_APP_NAME = "Fin for Salesforce";

/** Salesforce package version ids are 04t + 12 or 15 characters. */
const PACKAGE_VERSION_ID_RE = /^04t[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/u;

export function isPackageVersionId(value: string | undefined): value is string {
  return typeof value === "string" && PACKAGE_VERSION_ID_RE.test(value.trim());
}

/**
 * Accept a bare `04t…` id or a Salesforce package install URL
 * (`…/packaging/installPackage.apexp?p0=04t…`). Returns undefined for
 * anything else so a pasted link can never smuggle another value.
 */
export function parsePackageVersionId(input: string | undefined): string | undefined {
  const raw = input?.trim();
  if (!raw) return undefined;
  if (isPackageVersionId(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  const candidate = url.searchParams.get("p0") ?? url.searchParams.get("packageId") ?? undefined;
  return isPackageVersionId(candidate) ? candidate : undefined;
}

// ─── Readiness model ────────────────────────────────────────────────────────

export interface PackageVersionFacts {
  id: string;
  namespace?: string;
  packageName?: string;
  version: string;
  releaseState?: string;
  isManaged?: boolean;
  isPasswordProtected?: boolean;
  isBeta?: boolean;
}

export interface InstalledPackageFacts {
  versionId: string;
  version: string;
}

export interface FinUserFacts {
  id: string;
  username: string;
  /** Display name; Fin lists users by it. */
  name?: string;
  isActive: boolean;
  serviceCloudUser: boolean;
  licenseName?: string;
  assignedPermissionSets: string[];
}

export interface SalesforceFacts {
  orgId: string;
  orgType: string;
  /** Package currently installed under the finai namespace, if any. */
  installed?: InstalledPackageFacts;
  /** Requested package version (from the Fin install link), if supplied. */
  requested?: PackageVersionFacts;
  /** Case fields present (QualifiedApiName). */
  caseFields: string[];
  /** Permission sets present (Name, with namespace prefix when packaged). */
  permissionSets: string[];
  /** Number of External Client Apps under the finai namespace. */
  finExternalClientApps: number;
  /** Dedicated Fin user, when the requested username exists. */
  user?: FinUserFacts;
  /** Requested dedicated Fin username. */
  username: string;
  /** Free licenses for the profile the user will be created with. */
  profileLicensesAvailable?: number;
  profileExists: boolean;
  /** SecuritySettings.enableAuditFieldsInactiveOwner, when readable. */
  auditFieldsEnabled?: boolean;
  /** Target org instance URL (Fin shows it on a connected environment). */
  instanceUrl?: string;
  /**
   * The integration user Fin checks permission sets on: the user holding the
   * Fin OAuth token, or (before connect) the target org's CLI user, who is the
   * one `connect` authorizes as.
   */
  integrationUser?: { id: string; username: string; assignedPermissionSets: string[] };
  /** True when a Fin for Salesforce OAuth token exists in the org. */
  oauthConnected?: boolean;
  /** CreateAuditFields enabled on the access permission set, when the org exposes it. */
  accessHasAuditPermission?: boolean;
  /** CommunitiesSettings.enableNetworksEnabled, when readable. */
  digitalExperiencesEnabled?: boolean;
  /** FeedItem.Visibility exists in the org (what Fin actually checks). */
  feedVisibilityAvailable?: boolean;
  /** EmailAdministrationSettings.enableEnhancedEmailEnabled, when readable. */
  enhancedEmailEnabled?: boolean;
  /** CaseSettings.emailToCase.enableEmailToCase, when readable. */
  emailToCaseEnabled?: boolean;
  /**
   * How cases reach the Fin user: active record-triggered Case Flows, the
   * active Case assignment rule, and how many cases the Fin user owns.
   */
  caseRouting?: {
    activeFlows: string[];
    activeAssignmentRule?: string;
    casesOwnedByFin: number;
  };
  /** Queues that accept Cases (Fin hands off to one). */
  caseQueues?: string[];
  /** Effective object access per user, from their assigned permission sets and profile. */
  effectiveAccess?: Record<
    "fin" | "integration",
    Record<string, { create: boolean; read: boolean; edit: boolean }>
  >;
}

export type CheckState = "ok" | "missing" | "warn" | "blocked";

export interface ReadinessCheck {
  id: string;
  state: CheckState;
  title: string;
  detail?: string;
  /** Which operation fixes it. */
  fix?:
    | "package_install"
    | "audit_fields_enable"
    | "digital_experiences_enable"
    | "enhanced_email_enable"
    | "permissions_apply"
    | "connect"
    | "human";
}

export interface ReadinessReport {
  checks: ReadinessCheck[];
  packageReady: boolean;
  permissionsReady: boolean;
  /** Everything Salesforce-side done; only the Fin Connect step remains. */
  readyToConnect: boolean;
  /** Org features Fin depends on (FeedItem.Visibility via Digital Experiences). */
  orgFeaturesReady: boolean;
  /** Fin holds an OAuth token in this org. */
  connected: boolean;
  /**
   * Connected, and every go-live check the org could be read for passes
   * (routing, email, handoff queue, effective access). Unreadable checks are
   * omitted rather than guessed.
   */
  goLiveReady: boolean;
}

export function evaluateSalesforceReadiness(
  facts: SalesforceFacts,
  options: { accessPermissionSet?: string } = {},
): ReadinessReport {
  const access = options.accessPermissionSet ?? FIN_ACCESS_PERMISSION_SET;
  const checks: ReadinessCheck[] = [];

  const upgradeAvailable =
    facts.installed && facts.requested && facts.installed.versionId !== facts.requested.id;
  checks.push(
    facts.installed
      ? {
          id: "package",
          state: upgradeAvailable ? "warn" : "ok",
          title: `Fin for Salesforce package installed (${FIN_PACKAGE_NAMESPACE} ${facts.installed.version})`,
          detail: upgradeAvailable
            ? `Fin's install link points to ${facts.requested?.version} (${facts.requested?.id}); Fin requires the latest version.`
            : undefined,
          fix: upgradeAvailable ? "package_install" : undefined,
        }
      : {
          id: "package",
          state: "missing",
          title: "Fin for Salesforce package not installed",
          detail: facts.requested
            ? `Ready to install ${facts.requested.packageName ?? "the package"} ${facts.requested.version} (${facts.requested.id}).`
            : "Pass package_version (the 04t id or install link from Fin's Connect page).",
          fix: "package_install",
        },
  );

  const missingFields = FIN_CASE_FIELDS.filter((field) => !facts.caseFields.includes(field));
  checks.push({
    id: "case-fields",
    state: missingFields.length === 0 ? "ok" : "missing",
    title:
      missingFields.length === 0
        ? "Fin Case fields present"
        : `Fin Case fields missing: ${missingFields.join(", ")}`,
    fix: missingFields.length === 0 ? undefined : "package_install",
  });

  const packagePs = facts.permissionSets.includes(FIN_PACKAGE_PERMISSION_SET);
  checks.push({
    id: "package-permission-set",
    state: packagePs ? "ok" : "missing",
    title: packagePs
      ? `Permission set ${FIN_PACKAGE_PERMISSION_SET} present`
      : `Permission set ${FIN_PACKAGE_PERMISSION_SET} missing`,
    fix: packagePs ? undefined : "package_install",
  });

  checks.push({
    id: "external-client-app",
    state: facts.finExternalClientApps > 0 ? "ok" : facts.installed ? "warn" : "missing",
    title:
      facts.finExternalClientApps > 0
        ? "Fin External Client App present"
        : "Fin External Client App not found",
    detail:
      facts.finExternalClientApps > 0 || !facts.installed
        ? undefined
        : "The current package version ships the External Client App Fin connects through.",
    fix: facts.finExternalClientApps > 0 ? undefined : "package_install",
  });

  const accessPs = facts.permissionSets.includes(access);
  checks.push({
    id: "access-permission-set",
    state: accessPs ? "ok" : "missing",
    title: accessPs ? `Permission set ${access} present` : `Permission set ${access} not deployed`,
    fix: accessPs ? undefined : "permissions_apply",
  });

  checks.push({
    id: "audit-fields",
    state: facts.auditFieldsEnabled === true ? "ok" : "missing",
    title:
      facts.auditFieldsEnabled === true
        ? "Audit fields on record creation enabled"
        : facts.auditFieldsEnabled === false
          ? "Audit fields on record creation not enabled"
          : "Audit field setting not readable",
    detail:
      facts.auditFieldsEnabled === true
        ? undefined
        : 'Fin asks for the org setting behind "Set Audit Fields upon Record Creation".',
    fix: facts.auditFieldsEnabled === true ? undefined : "audit_fields_enable",
  });
  checks.push({
    id: "feed-visibility",
    state: facts.feedVisibilityAvailable ? "ok" : "missing",
    title: facts.feedVisibilityAvailable
      ? `${FIN_FEED_VISIBILITY_FIELD} available (Digital Experiences enabled)`
      : `${FIN_FEED_VISIBILITY_FIELD} not available (Digital Experiences ${facts.digitalExperiencesEnabled ? "enabled, field still missing" : "not enabled"})`,
    detail: facts.feedVisibilityAvailable
      ? undefined
      : "Fin reads this field to tell internal case comments from public ones; without it Fin's permission check reports errors.",
    fix: facts.feedVisibilityAvailable
      ? undefined
      : facts.digitalExperiencesEnabled
        ? "human"
        : "digital_experiences_enable",
  });
  if (facts.auditFieldsEnabled === true && accessPs) {
    checks.push({
      id: "access-audit-permission",
      state: facts.accessHasAuditPermission ? "ok" : "missing",
      title: facts.accessHasAuditPermission
        ? `${access} grants Set Audit Fields upon Record Creation`
        : `${access} does not grant Set Audit Fields upon Record Creation yet`,
      fix: facts.accessHasAuditPermission ? undefined : "permissions_apply",
    });
  }

  if (!facts.profileExists) {
    checks.push({
      id: "profile",
      state: "blocked",
      title: `Profile "${FIN_USER_PROFILE}" not found`,
      fix: "human",
    });
  }

  const user = facts.user;
  if (!user) {
    const noLicense =
      facts.profileLicensesAvailable !== undefined && facts.profileLicensesAvailable < 1;
    checks.push({
      id: "fin-user",
      state: noLicense ? "blocked" : "missing",
      title: `Dedicated Fin user ${facts.username} not created`,
      detail: noLicense ? "No free Salesforce license for the Fin user." : undefined,
      fix: noLicense ? "human" : "permissions_apply",
    });
  } else {
    checks.push({
      id: "fin-user",
      state: user.isActive ? "ok" : "blocked",
      title: user.isActive
        ? `Fin user ${user.username} exists${user.licenseName ? ` (${user.licenseName})` : ""}`
        : `Fin user ${user.username} is inactive`,
      fix: user.isActive ? undefined : "human",
    });
    const needs = [FIN_PACKAGE_PERMISSION_SET, access].filter(
      (ps) => !user.assignedPermissionSets.includes(ps),
    );
    checks.push({
      id: "fin-user-assignments",
      state: needs.length === 0 ? "ok" : "missing",
      title:
        needs.length === 0
          ? "Fin user has both permission sets"
          : `Fin user missing: ${needs.join(", ")}`,
      fix: needs.length === 0 ? undefined : "permissions_apply",
    });
    checks.push({
      id: "service-cloud-user",
      state: user.serviceCloudUser ? "ok" : "missing",
      title: user.serviceCloudUser
        ? "Fin user is a Service Cloud User"
        : "Fin user is not a Service Cloud User",
      detail: user.serviceCloudUser
        ? undefined
        : "Fin replies on Cases as this user, which needs the Service Cloud User license.",
      fix: user.serviceCloudUser ? undefined : "permissions_apply",
    });
  }
  const integration = facts.integrationUser;
  if (integration && integration.id !== user?.id) {
    const needs = [FIN_PACKAGE_PERMISSION_SET, access].filter(
      (ps) => !integration.assignedPermissionSets.includes(ps),
    );
    checks.push({
      id: "integration-user-assignments",
      state: needs.length === 0 ? "ok" : "missing",
      title:
        needs.length === 0
          ? `Integration user ${integration.username} has both permission sets`
          : `Integration user ${integration.username} missing: ${needs.join(", ")}`,
      detail: facts.oauthConnected
        ? "Fin checks the permission sets of the user that authorized its connection."
        : "This user authorizes Fin during connect, and Fin checks its permission sets.",
      fix: needs.length === 0 ? undefined : "permissions_apply",
    });
  }
  checks.push({
    id: "oauth-connection",
    state: facts.oauthConnected ? "ok" : "missing",
    title: facts.oauthConnected
      ? `Fin is connected to this org (${FIN_OAUTH_APP_NAME} OAuth token present)`
      : "Fin is not connected to this org yet",
    fix: facts.oauthConnected ? undefined : "connect",
  });

  checks.push(...goLiveChecks(facts));

  const byId = (id: string) => checks.find((check) => check.id === id);
  const packageReady = ["package", "case-fields", "package-permission-set"].every(
    (id) => byId(id)?.state === "ok",
  );
  const orgFeaturesReady = byId("feed-visibility")?.state === "ok";
  const permissionsReady =
    ["access-permission-set", "fin-user", "fin-user-assignments", "service-cloud-user"].every(
      (id) => byId(id)?.state === "ok",
    ) &&
    ["access-audit-permission", "integration-user-assignments"].every(
      (id) => byId(id) === undefined || byId(id)?.state === "ok",
    );
  return {
    checks,
    packageReady,
    permissionsReady,
    readyToConnect: packageReady && permissionsReady,
    orgFeaturesReady,
    connected: facts.oauthConnected === true,
    goLiveReady:
      facts.oauthConnected === true &&
      packageReady &&
      permissionsReady &&
      orgFeaturesReady &&
      checks.filter((c) => GO_LIVE_IDS.has(c.id)).every((c) => c.state === "ok"),
  };
}

const GO_LIVE_IDS = new Set([
  "enhanced-email",
  "email-to-case",
  "case-routing",
  "handoff-queue",
  "effective-access",
]);

/** Checks that decide whether Fin can actually work cases, from Fin's Cases setup guide. */
function goLiveChecks(facts: SalesforceFacts): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  if (facts.enhancedEmailEnabled !== undefined) {
    checks.push({
      id: "enhanced-email",
      state: facts.enhancedEmailEnabled ? "ok" : "missing",
      title: facts.enhancedEmailEnabled ? "Enhanced Email enabled" : "Enhanced Email is off",
      detail: facts.enhancedEmailEnabled
        ? undefined
        : "Fin syncs a case's email history through the Emails relationship, which needs Enhanced Email.",
      fix: facts.enhancedEmailEnabled ? undefined : "enhanced_email_enable",
    });
  }
  if (facts.emailToCaseEnabled !== undefined) {
    checks.push({
      id: "email-to-case",
      state: facts.emailToCaseEnabled ? "ok" : "warn",
      title: facts.emailToCaseEnabled
        ? "Email-to-Case enabled"
        : "Email-to-Case is off (Fin replies to cases over email only with it)",
      detail: facts.emailToCaseEnabled
        ? "Fin's reply address must be a verified, active routing address; replies thread back with Lightning threading."
        : "Not needed for Web-to-Case or manually created cases. To reply by email: enable Email-to-Case, add and verify a routing address in Setup (Salesforce emails a confirmation link), then select it in Fin. Enabling it cannot be undone.",
      fix: facts.emailToCaseEnabled ? undefined : "human",
    });
  }
  const routing = facts.caseRouting;
  if (routing) {
    const routed = routing.activeFlows.length > 0;
    checks.push({
      id: "case-routing",
      state: !routed ? "missing" : routing.casesOwnedByFin > 0 ? "ok" : "warn",
      title: !routed
        ? "No active Case Flow assigns cases to the Fin user"
        : routing.casesOwnedByFin > 0
          ? `Cases reach the Fin user (${routing.activeFlows.join(", ")}; ${routing.casesOwnedByFin} owned)`
          : `Active Case Flow ${routing.activeFlows.join(", ")}, but no case is owned by the Fin user yet`,
      detail: !routed
        ? `Fin only works cases assigned to its user. Build a record-triggered Case Flow with sf_flow that sets Owner to the Fin user${routing.activeAssignmentRule ? ` (it runs after the active assignment rule "${routing.activeAssignmentRule}", so its owner wins)` : ""}, or assign cases by hand to test.`
        : routing.casesOwnedByFin > 0
          ? undefined
          : "Create one test case that matches the Flow and check that its owner becomes the Fin user.",
      fix: routed && routing.casesOwnedByFin > 0 ? undefined : "human",
    });
  }
  if (facts.caseQueues) {
    checks.push({
      id: "handoff-queue",
      state: facts.caseQueues.length > 0 ? "ok" : "warn",
      title:
        facts.caseQueues.length > 0
          ? `Case queues available for Fin's handoff: ${facts.caseQueues.slice(0, 3).join(", ")}`
          : "No queue accepts Cases",
      detail:
        facts.caseQueues.length > 0
          ? undefined
          : 'When Fin hands off ("Routed to team"), it assigns the case to a queue or user you pick in Fin. Create a Case queue in Setup, or pick a user.',
      fix: facts.caseQueues.length > 0 ? undefined : "human",
    });
  }
  if (facts.effectiveAccess) {
    const gaps: string[] = [];
    for (const who of ["fin", "integration"] as const) {
      for (const [object, needs] of Object.entries(FIN_REQUIRED_ACCESS[who])) {
        const has = facts.effectiveAccess[who]?.[object];
        const missing = needs.filter((op) => !has?.[op]);
        if (missing.length) {
          gaps.push(
            `${who === "fin" ? "Fin user" : "integration user"}: ${object} ${missing.join("/")}`,
          );
        }
      }
    }
    checks.push({
      id: "effective-access",
      state: gaps.length === 0 ? "ok" : "missing",
      title:
        gaps.length === 0
          ? "Object access matches Fin's permission matrix"
          : `Missing object access — ${gaps.join("; ")}`,
      detail:
        gaps.length === 0
          ? undefined
          : "Fin's published matrix needs Case create/read/edit for both users and Contact create/read for the integration user.",
      fix: gaps.length === 0 ? undefined : "permissions_apply",
    });
  }
  return checks;
}

// ─── Metadata rendering ─────────────────────────────────────────────────────

export interface AccessPermissionSetInput {
  name?: string;
  label?: string;
  /** Fields that exist and are permissionable in the target org. */
  permissionableFields?: readonly string[];
  /** Include FIN_AUDIT_PERMISSIONS (only when the org setting is on). */
  includeAuditPermissions?: boolean;
  /**
   * System permission names the org exposes (from the PermissionSet describe).
   * When given, only these are rendered.
   */
  availablePermissions?: readonly string[];
}

export interface RenderedPermissionSet {
  name: string;
  label: string;
  xml: string;
  fields: string[];
  skippedFields: string[];
  userPermissions: string[];
}

/**
 * Deterministic PermissionSet XML for the second Fin permission set. Field
 * entries are filtered to those the org reports as permissionable, because a
 * PermissionSet that names a required or non-permissionable field fails to
 * deploy. Output order is fixed so plans are reproducible.
 */
export function renderAccessPermissionSet(
  input: AccessPermissionSetInput = {},
): RenderedPermissionSet {
  const name = input.name ?? FIN_ACCESS_PERMISSION_SET;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(name) || /__/u.test(name) || name.endsWith("_")) {
    throw new Error(`Invalid permission set API name: ${name}`);
  }
  const label = input.label ?? FIN_ACCESS_PERMISSION_SET_LABEL;
  const allowed = input.permissionableFields ? new Set(input.permissionableFields) : undefined;
  const fields = FIN_FIELD_ACCESS.filter((field) => !allowed || allowed.has(field));
  const skippedFields = FIN_FIELD_ACCESS.filter((field) => allowed && !allowed.has(field));
  const available = input.availablePermissions ? new Set(input.availablePermissions) : undefined;
  const userPermissions = [
    ...FIN_SYSTEM_PERMISSIONS,
    ...(input.includeAuditPermissions ? FIN_AUDIT_PERMISSIONS : []),
  ]
    .filter((permission) => !available || available.has(permission))
    .sort();

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">',
    `    <description>${escapeXml("Salesforce access for the Fin for Salesforce integration user. Generated by SF Fin from Fin's documented requirements.")}</description>`,
  ];
  for (const field of [...fields].sort()) {
    lines.push(
      "    <fieldPermissions>",
      "        <editable>true</editable>",
      `        <field>${escapeXml(field)}</field>`,
      "        <readable>true</readable>",
      "    </fieldPermissions>",
    );
  }
  lines.push("    <hasActivationRequired>false</hasActivationRequired>");
  lines.push(`    <label>${escapeXml(label)}</label>`);
  for (const access of [...FIN_OBJECT_ACCESS].sort((a, b) => a.object.localeCompare(b.object))) {
    lines.push(
      "    <objectPermissions>",
      `        <allowCreate>${access.create}</allowCreate>`,
      "        <allowDelete>false</allowDelete>",
      "        <allowEdit>true</allowEdit>",
      "        <allowRead>true</allowRead>",
      "        <modifyAllRecords>false</modifyAllRecords>",
      `        <object>${access.object}</object>`,
      "        <viewAllRecords>false</viewAllRecords>",
      "    </objectPermissions>",
    );
  }
  for (const permission of userPermissions) {
    lines.push(
      "    <userPermissions>",
      "        <enabled>true</enabled>",
      `        <name>${escapeXml(permission)}</name>`,
      "    </userPermissions>",
    );
  }
  lines.push("</PermissionSet>", "");
  return { name, label, xml: lines.join("\n"), fields, skippedFields, userPermissions };
}

/**
 * Deterministic Settings source for the one SecuritySettings field Fin needs.
 * A Settings deploy updates only the fields present in the file, so no other
 * security setting is touched.
 */
export function renderAuditFieldsSecuritySettings(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<SecuritySettings xmlns="http://soap.sforce.com/2006/04/metadata">',
    `    <${FIN_AUDIT_SETTING}>true</${FIN_AUDIT_SETTING}>`,
    "</SecuritySettings>",
    "",
  ].join("\n");
}

/** EmailAdministrationSettings source that turns on Enhanced Email and nothing else. */
export function renderEnhancedEmailSettings(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<EmailAdministrationSettings xmlns="http://soap.sforce.com/2006/04/metadata">',
    `    <${FIN_ENHANCED_EMAIL_SETTING}>true</${FIN_ENHANCED_EMAIL_SETTING}>`,
    "</EmailAdministrationSettings>",
    "",
  ].join("\n");
}

/** CommunitiesSettings source that turns on Digital Experiences and nothing else. */
export function renderDigitalExperiencesSettings(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<CommunitiesSettings xmlns="http://soap.sforce.com/2006/04/metadata">',
    `    <${FIN_DIGITAL_EXPERIENCES_SETTING}>true</${FIN_DIGITAL_EXPERIENCES_SETTING}>`,
    "</CommunitiesSettings>",
    "",
  ].join("\n");
}

/**
 * Default Fin username: globally unique per org (usernames are unique across
 * all Salesforce orgs) and never a person's address. Same shape SF Pi uses
 * for Agentforce agent users.
 */
export function defaultFinUsername(orgId: string): string {
  const safe = orgId.replace(/[^A-Za-z0-9]/gu, "").toLowerCase();
  return `fin_agent@${safe}.ext`;
}

const USERNAME_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function isValidUsername(value: string | undefined): value is string {
  return typeof value === "string" && value.length <= 80 && USERNAME_RE.test(value);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}
