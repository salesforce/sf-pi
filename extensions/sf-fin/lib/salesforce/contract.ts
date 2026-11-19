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
  { object: "Contact", create: false, read: true, edit: true },
  { object: "Account", create: false, read: true, edit: true },
];

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
 * System permissions Fin documents (Metadata API names). `Can Insert Feed
 * System Fields` (InsertFeedSystemFields) also needs the org's audit-field
 * setting and a license that offers it, so it is reported separately rather
 * than deployed blindly; see FIN_AUDIT_PERMISSIONS.
 */
export const FIN_SYSTEM_PERMISSIONS: readonly string[] = [
  "ApiEnabled",
  "EditTask",
  "ViewAllUsers",
  "ViewRoles",
  "ViewSetup",
];

/** Permissions that depend on SecuritySettings.enableAuditFieldsInactiveOwner. */
export const FIN_AUDIT_PERMISSIONS: readonly string[] = ["InsertFeedSystemFields"];

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
}

export type CheckState = "ok" | "missing" | "warn" | "blocked";

export interface ReadinessCheck {
  id: string;
  state: CheckState;
  title: string;
  detail?: string;
  /** Which operation fixes it. */
  fix?: "package_install" | "permissions_apply" | "connect" | "human";
}

export interface ReadinessReport {
  checks: ReadinessCheck[];
  packageReady: boolean;
  permissionsReady: boolean;
  /** Everything Salesforce-side done; only the Fin Connect step remains. */
  readyToConnect: boolean;
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
    state: facts.auditFieldsEnabled === true ? "ok" : "warn",
    title:
      facts.auditFieldsEnabled === true
        ? "Audit fields on record creation enabled"
        : facts.auditFieldsEnabled === false
          ? "Audit fields on record creation not enabled"
          : "Audit field setting not readable",
    detail:
      facts.auditFieldsEnabled === true
        ? undefined
        : 'Fin asks for "Set Audit Fields upon Record Creation"; SF Fin leaves this org-wide setting to the admin (Setup → User Interface).',
    fix: facts.auditFieldsEnabled === true ? undefined : "human",
  });

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
  const byId = (id: string) => checks.find((check) => check.id === id);
  const packageReady = ["package", "case-fields", "package-permission-set"].every(
    (id) => byId(id)?.state === "ok",
  );
  const permissionsReady =
    byId("access-permission-set")?.state === "ok" &&
    byId("fin-user")?.state === "ok" &&
    byId("fin-user-assignments")?.state === "ok" &&
    byId("service-cloud-user")?.state === "ok";
  return {
    checks,
    packageReady,
    permissionsReady,
    readyToConnect: packageReady && permissionsReady,
  };
}

// ─── Metadata rendering ─────────────────────────────────────────────────────

export interface AccessPermissionSetInput {
  name?: string;
  label?: string;
  /** Fields that exist and are permissionable in the target org. */
  permissionableFields?: readonly string[];
  /** Include FIN_AUDIT_PERMISSIONS (only when the org setting is on). */
  includeAuditPermissions?: boolean;
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
  const userPermissions = [
    ...FIN_SYSTEM_PERMISSIONS,
    ...(input.includeAuditPermissions ? FIN_AUDIT_PERMISSIONS : []),
  ].sort();

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
