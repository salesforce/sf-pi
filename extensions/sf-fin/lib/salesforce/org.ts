/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Salesforce adapter for the Fin for Salesforce setup.
 *
 * Every org call crosses the shared SF Pi connection Module (`sf-conn`), so
 * the target org, API version, and bounded requests stay owned in one place.
 * Reads are fixed SOQL against Fin's declared contract; writes are exactly:
 * one Tooling PackageInstallRequest, single-field Settings deploys
 * (SecuritySettings.enableAuditFieldsInactiveOwner,
 * CommunitiesSettings.enableNetworksEnabled, and
 * EmailAdministrationSettings.enableEnhancedEmailEnabled), one PermissionSet
 * deploy, one User create/update, and PermissionSetAssignment inserts.
 * Nothing else changes.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SalesforceSession } from "../../../../lib/common/sf-conn/index.ts";
import { deployPermissionSet } from "../../../sf-agentscript/lib/agent-user/deploy.ts";
import type { TokenTransferOrg } from "./token-transfer.ts";
import {
  FIN_ACCESS_PERMISSION_SET,
  FIN_AUDIT_PERMISSIONS,
  FIN_AUDIT_SETTING,
  FIN_CASE_FIELDS,
  FIN_DIGITAL_EXPERIENCES_SETTING,
  FIN_ENHANCED_EMAIL_SETTING,
  FIN_FIELD_ACCESS,
  FIN_OAUTH_APP_NAME,
  FIN_PACKAGE_NAMESPACE,
  FIN_PACKAGE_PERMISSION_SET,
  FIN_SYSTEM_PERMISSIONS,
  FIN_USER_ALIAS,
  FIN_USER_PROFILE,
  renderAuditFieldsSecuritySettings,
  renderDigitalExperiencesSettings,
  renderEnhancedEmailSettings,
  type FinUserFacts,
  type PackageVersionFacts,
  type SalesforceFacts,
} from "./contract.ts";

const INSTALL_POLL_MS = 5_000;
const INSTALL_TIMEOUT_MS = 15 * 60_000;
const SETTINGS_DEPLOY_TIMEOUT_MS = 5 * 60_000;

/** How Fin has worked Cases in this org, from the Fin package's Case fields. */
export interface FinCaseActivity {
  /** Cases currently owned by the Fin user. */
  finUserOwned: number;
  /** Cases with finai__FinInvolved__c = true. */
  involved: number;
  /** finai__FinResolutionState__c counts among Fin-involved cases. */
  byResolution: Record<string, number>;
  /** Case Origin counts among Fin-involved cases. */
  byOrigin: Record<string, number>;
  /** Most recently modified Fin-involved cases (no description or body fields). */
  recent: Array<{
    caseNumber: string;
    subject?: string;
    status?: string;
    origin?: string;
    resolution?: string;
    ownedByFin: boolean;
    lastModified?: string;
  }>;
}

/** Narrow seam the setup orchestration depends on (faked in tests). */
export interface FinSalesforceOrg {
  /** Read-only: how Fin has worked Cases (needs the Fin package's Case fields). */
  readFinCaseActivity(input: { finUserId?: string }): Promise<FinCaseActivity>;
  /** 18-character org id of the target org. */
  orgId(): Promise<string>;
  /** Org state for Fin's contract; `requested` is filled in by the caller. */
  readFacts(input: { username: string }): Promise<Omit<SalesforceFacts, "requested">>;
  /** Package version details plus third-party sites it asks to reach. */
  describePackageVersion(
    id: string,
  ): Promise<(PackageVersionFacts & { remoteSites: string[] }) | undefined>;
  /** Fields that exist and accept field permissions in this org (`Object.Field`). */
  permissionableFields(): Promise<string[]>;
  /** Fin system permissions this org's PermissionSet exposes (Metadata API names). */
  availablePermissions(): Promise<string[]>;
  /** Deploy SecuritySettings with only enableAuditFieldsInactiveOwner=true. */
  enableAuditFields(input: { signal?: AbortSignal }): Promise<{ ok: boolean; error?: string }>;
  /** Deploy EmailAdministrationSettings with only enableEnhancedEmailEnabled=true. */
  enableEnhancedEmail(input: { signal?: AbortSignal }): Promise<{ ok: boolean; error?: string }>;
  /** A queue by API name, with the objects it accepts; undefined when none. */
  findQueue(
    developerName: string,
  ): Promise<{ developerName: string; name: string; sobjectTypes: string[] } | undefined>;
  /** Deploy one Queue component (Cases only, no members). */
  deployQueue(input: {
    developerName: string;
    name: string;
    xml: string;
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; error?: string }>;
  /** Deploy CommunitiesSettings with only enableNetworksEnabled=true. */
  enableDigitalExperiences(input: {
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; error?: string }>;
  installPackage(input: {
    versionId: string;
    enableRss: boolean;
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; requestId?: string; status: string; errors: string[] }>;
  deployAccessPermissionSet(input: {
    name: string;
    xml: string;
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; error?: string }>;
  /** Connected (running) user details used as defaults for the Fin user. */
  connectedUser(): Promise<{
    id: string;
    email: string;
    timeZone: string;
    locale: string;
    language: string;
    emailEncoding: string;
  }>;
  createFinUser(input: {
    username: string;
    email: string;
    profileName: string;
    defaults: { timeZone: string; locale: string; language: string; emailEncoding: string };
  }): Promise<{ ok: boolean; id?: string; error?: string }>;
  setServiceCloudUser(userId: string): Promise<{ ok: boolean; error?: string }>;
  assignPermissionSets(
    userId: string,
    names: string[],
  ): Promise<{ ok: boolean; assigned: string[]; errors: string[] }>;
}

export interface FinSalesforceOrgOptions {
  /** Wait between install completion checks. */
  installPollMs?: number;
  /** Give up waiting for an install after this long. */
  installTimeoutMs?: number;
}

export function createFinSalesforceOrg(
  session: SalesforceSession,
  options: FinSalesforceOrgOptions = {},
): FinSalesforceOrg {
  const pollMs = options.installPollMs ?? INSTALL_POLL_MS;
  const timeoutMs = options.installTimeoutMs ?? INSTALL_TIMEOUT_MS;
  const query = async <T>(soql: string, api: "rest" | "tooling" = "rest", maxRows = 200) =>
    (await session.query<T>({ soql, api, maxRows })).records;

  /** Installed Packages is the source of truth; the install request may be unreadable. */
  const isInstalled = async (versionId: string) =>
    (
      await query<{ SubscriberPackageVersionId: string }>(
        "SELECT SubscriberPackageVersionId FROM InstalledSubscriberPackage",
        "tooling",
      )
    ).some((row) => row.SubscriberPackageVersionId === versionId);

  const permissionSetIds = async (names: string[]) => {
    const rows = await query<{ Id: string; Name: string; NamespacePrefix: string | null }>(
      `SELECT Id, Name, NamespacePrefix FROM PermissionSet WHERE IsOwnedByProfile = false AND (${names
        .map((full) => {
          const [ns, name] = splitNamespace(full);
          return ns
            ? `(NamespacePrefix = '${soql(ns)}' AND Name = '${soql(name)}')`
            : `(NamespacePrefix = null AND Name = '${soql(name)}')`;
        })
        .join(" OR ")})`,
    );
    return new Map(rows.map((row) => [qualified(row.NamespacePrefix, row.Name), row.Id]));
  };

  const assignedPermissionSets = async (userId: string) =>
    (
      await query<{ PermissionSet?: { Name?: string; NamespacePrefix?: string | null } | null }>(
        `SELECT PermissionSet.Name, PermissionSet.NamespacePrefix FROM PermissionSetAssignment WHERE AssigneeId = '${soql(userId)}'`,
      )
    )
      .map((a) =>
        a.PermissionSet?.Name
          ? qualified(a.PermissionSet.NamespacePrefix ?? null, a.PermissionSet.Name)
          : undefined,
      )
      .filter((name): name is string => Boolean(name));

  /** Union of object permissions across the user's profile and permission sets. */
  const effectiveAccess = async (userId: string) => {
    const rows = await query<{
      SobjectType: string;
      PermissionsCreate: boolean;
      PermissionsRead: boolean;
      PermissionsEdit: boolean;
    }>(
      `SELECT SobjectType, PermissionsCreate, PermissionsRead, PermissionsEdit FROM ObjectPermissions WHERE SobjectType IN ('Case', 'Contact') AND ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${soql(userId)}')`,
      "rest",
      200,
    ).catch(() => []);
    const out: Record<string, { create: boolean; read: boolean; edit: boolean }> = {};
    for (const row of rows) {
      const current = out[row.SobjectType] ?? { create: false, read: false, edit: false };
      out[row.SobjectType] = {
        create: current.create || row.PermissionsCreate,
        read: current.read || row.PermissionsRead,
        edit: current.edit || row.PermissionsEdit,
      };
    }
    return out;
  };

  /** Active record-triggered Case Flows, the active Case assignment rule, and Fin-owned cases. */
  const readCaseRouting = async (finUserId: string) => {
    const flows = await query<{ ApiName: string; TriggerType?: string }>(
      "SELECT ApiName, TriggerType FROM FlowDefinitionView WHERE TriggerObjectOrEventLabel = 'Case' AND IsActive = true",
      "rest",
      50,
    ).catch(() => undefined);
    if (!flows) return undefined;
    const rule = await query<{ Name: string }>(
      "SELECT Name FROM AssignmentRule WHERE SobjectType = 'Case' AND Active = true",
      "rest",
      1,
    ).catch(() => []);
    const owned = await session
      .query<{ expr0?: number }>({
        soql: `SELECT COUNT() FROM Case WHERE OwnerId = '${soql(finUserId)}'`,
        api: "rest",
        maxRows: 1,
      })
      .then((r) => r.totalSize ?? 0)
      .catch(() => 0);
    return {
      // A Flow that runs on Case records may assign them; record-triggered only.
      activeFlows: flows
        .filter((f) => !f.TriggerType || /^Record/.test(f.TriggerType))
        .map((f) => f.ApiName),
      activeAssignmentRule: rule[0]?.Name,
      casesOwnedByFin: owned,
    };
  };

  const groupCounts = async (field: string, where: string) =>
    Object.fromEntries(
      (
        await query<Record<string, unknown>>(
          `SELECT ${field} k, COUNT(Id) n FROM Case WHERE ${where} GROUP BY ${field}`,
          "rest",
          50,
        ).catch(() => [])
      ).map((row) => [typeof row.k === "string" && row.k ? row.k : "(none)", Number(row.n ?? 0)]),
    );

  return {
    async readFinCaseActivity(input) {
      const involvedWhere = "finai__FinInvolved__c = true";
      const count = (where: string) =>
        session
          .query<unknown>({
            soql: `SELECT COUNT() FROM Case WHERE ${where}`,
            api: "rest",
            maxRows: 1,
          })
          .then((r) => r.totalSize ?? 0)
          .catch(() => 0);
      const recentRows = await query<{
        CaseNumber: string;
        Subject?: string;
        Status?: string;
        Origin?: string;
        OwnerId?: string;
        LastModifiedDate?: string;
        finai__FinResolutionState__c?: string;
      }>(
        `SELECT CaseNumber, Subject, Status, Origin, OwnerId, LastModifiedDate, finai__FinResolutionState__c FROM Case WHERE ${involvedWhere}${input.finUserId ? ` OR OwnerId = '${soql(input.finUserId)}'` : ""} ORDER BY LastModifiedDate DESC`,
        "rest",
        10,
      ).catch(() => []);
      return {
        finUserOwned: input.finUserId ? await count(`OwnerId = '${soql(input.finUserId)}'`) : 0,
        involved: await count(involvedWhere),
        byResolution: await groupCounts("finai__FinResolutionState__c", involvedWhere),
        byOrigin: await groupCounts("Origin", involvedWhere),
        recent: recentRows.map((row) => ({
          caseNumber: row.CaseNumber,
          subject: row.Subject,
          status: row.Status,
          origin: row.Origin,
          resolution: row.finai__FinResolutionState__c,
          ownedByFin: Boolean(input.finUserId) && row.OwnerId === input.finUserId,
          lastModified: row.LastModifiedDate,
        })),
      };
    },

    async orgId() {
      return session.target.orgId ?? (await session.identity()).org_id;
    },

    async readFacts(input) {
      const access = FIN_ACCESS_PERMISSION_SET;
      const installedRows = await query<{
        SubscriberPackageVersionId: string;
        SubscriberPackage?: { NamespacePrefix?: string | null } | null;
        SubscriberPackageVersion?: VersionParts | null;
      }>(
        "SELECT SubscriberPackageVersionId, SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion, SubscriberPackageVersion.PatchVersion, SubscriberPackageVersion.BuildNumber FROM InstalledSubscriberPackage",
        "tooling",
      );
      const installedRow = installedRows.find(
        (row) => row.SubscriberPackage?.NamespacePrefix === FIN_PACKAGE_NAMESPACE,
      );
      const caseFields = (
        await query<{ QualifiedApiName: string }>(
          `SELECT QualifiedApiName FROM EntityParticle WHERE EntityDefinition.QualifiedApiName = 'Case' AND QualifiedApiName IN (${FIN_CASE_FIELDS.map((f) => `'${f}'`).join(", ")})`,
        )
      ).map((row) => row.QualifiedApiName);
      const permissionSets = [
        ...(await permissionSetIds([FIN_PACKAGE_PERMISSION_SET, access])).keys(),
      ];
      const ecas = await query<{ Id: string }>(
        `SELECT Id FROM ExternalClientApplication WHERE NamespacePrefix = '${FIN_PACKAGE_NAMESPACE}'`,
        "tooling",
      );
      const profiles = await query<{
        Id: string;
        UserLicense?: { TotalLicenses?: number; UsedLicenses?: number } | null;
      }>(
        `SELECT Id, UserLicense.TotalLicenses, UserLicense.UsedLicenses FROM Profile WHERE Name = '${soql(FIN_USER_PROFILE)}'`,
      );
      const profile = profiles[0];
      const licenses = profile?.UserLicense;

      const username = input.username;
      let user: FinUserFacts | undefined;
      {
        const rows = await query<{
          Id: string;
          Username: string;
          Name?: string;
          IsActive: boolean;
          UserPermissionsSupportUser: boolean;
          Profile?: { UserLicense?: { Name?: string } | null } | null;
        }>(
          `SELECT Id, Username, Name, IsActive, UserPermissionsSupportUser, Profile.UserLicense.Name FROM User WHERE Username = '${soql(username)}'`,
          "rest",
          1,
        );
        const row = rows[0];
        if (row) {
          user = {
            id: row.Id,
            username: row.Username,
            name: row.Name,
            isActive: row.IsActive,
            serviceCloudUser: row.UserPermissionsSupportUser === true,
            licenseName: row.Profile?.UserLicense?.Name,
            assignedPermissionSets: await assignedPermissionSets(row.Id),
          };
        }
      }

      // The integration user is whoever authorized Fin's OAuth connection;
      // before connect it is the CLI user, who is the one connect runs as.
      const tokens = await query<{ UserId: string; User?: { Username?: string } | null }>(
        `SELECT UserId, User.Username FROM OauthToken WHERE AppName = '${soql(FIN_OAUTH_APP_NAME)}' ORDER BY CreatedDate DESC`,
        "rest",
        1,
      ).catch(() => []);
      const tokenUser = tokens[0];
      const identity = await session.identity();
      const integrationId = tokenUser?.UserId ?? identity.user_id;
      const integrationUsername =
        tokenUser?.User?.Username ??
        (
          await query<{ Username: string }>(
            `SELECT Username FROM User WHERE Id = '${soql(integrationId)}'`,
            "rest",
            1,
          )
        )[0]?.Username ??
        integrationId;

      const accessPermission = FIN_AUDIT_PERMISSIONS[0] ?? "CreateAuditFields";
      const accessHasAuditPermission = permissionSets.includes(access)
        ? await query<Record<string, unknown>>(
            `SELECT Permissions${accessPermission} FROM PermissionSet WHERE Name = '${soql(access)}' AND NamespacePrefix = null`,
            "rest",
            1,
          )
            .then((rows) => rows[0]?.[`Permissions${accessPermission}`] === true)
            .catch(() => false)
        : false;

      return {
        orgId: await this.orgId(),
        orgType: session.target.orgType,
        installed: installedRow
          ? {
              versionId: installedRow.SubscriberPackageVersionId,
              version: versionText(installedRow.SubscriberPackageVersion ?? {}),
            }
          : undefined,
        caseFields,
        permissionSets,
        finExternalClientApps: ecas.length,
        user,
        username,
        profileExists: Boolean(profile),
        profileLicensesAvailable:
          licenses && typeof licenses.TotalLicenses === "number"
            ? licenses.TotalLicenses - (licenses.UsedLicenses ?? 0)
            : undefined,
        auditFieldsEnabled: await readSetting(
          session,
          "SecuritySettings",
          "Security",
          FIN_AUDIT_SETTING,
        ),
        digitalExperiencesEnabled: await readSetting(
          session,
          "CommunitiesSettings",
          "Communities",
          FIN_DIGITAL_EXPERIENCES_SETTING,
        ),
        feedVisibilityAvailable:
          (
            await query<{ QualifiedApiName: string }>(
              "SELECT QualifiedApiName FROM EntityParticle WHERE EntityDefinition.QualifiedApiName = 'FeedItem' AND QualifiedApiName = 'Visibility'",
              "rest",
              1,
            ).catch(() => [])
          ).length > 0,
        instanceUrl: session.target.instanceUrl,
        integrationUser: {
          id: integrationId,
          username: integrationUsername,
          assignedPermissionSets: await assignedPermissionSets(integrationId),
        },
        oauthConnected: Boolean(tokenUser),
        accessHasAuditPermission,
        enhancedEmailEnabled: await readSetting(
          session,
          "EmailAdministrationSettings",
          "EmailAdministration",
          FIN_ENHANCED_EMAIL_SETTING,
        ),
        emailToCaseEnabled: await readEmailToCase(session),
        caseRouting: user ? await readCaseRouting(user.id) : undefined,
        caseQueues: await query<{ Queue?: { Name?: string } | null }>(
          "SELECT Queue.Name FROM QueueSobject WHERE SobjectType = 'Case'",
          "rest",
          20,
        )
          .then((rows) => rows.map((row) => row.Queue?.Name).filter((n): n is string => Boolean(n)))
          .catch(() => undefined),
        effectiveAccess: user
          ? {
              fin: await effectiveAccess(user.id),
              integration: await effectiveAccess(integrationId),
            }
          : undefined,
      };
    },

    async availablePermissions() {
      const described = await session.request<{ fields?: Array<{ name?: string }> }>({
        method: "GET",
        path: "/sobjects/PermissionSet/describe",
      });
      const names = new Set((described.body?.fields ?? []).map((field) => field.name));
      return [...FIN_SYSTEM_PERMISSIONS, ...FIN_AUDIT_PERMISSIONS].filter((permission) =>
        names.has(`Permissions${permission}`),
      );
    },

    async enableAuditFields(input) {
      return deploySettings(session, "Security", renderAuditFieldsSecuritySettings(), input.signal);
    },

    async enableEnhancedEmail(input) {
      return deploySettings(
        session,
        "EmailAdministration",
        renderEnhancedEmailSettings(),
        input.signal,
      );
    },

    async findQueue(developerName) {
      const rows = await query<{
        DeveloperName: string;
        Name: string;
        QueueSobjects?: { records?: Array<{ SobjectType?: string }> } | null;
      }>(
        `SELECT DeveloperName, Name, (SELECT SobjectType FROM QueueSobjects) FROM Group WHERE Type = 'Queue' AND DeveloperName = '${soql(developerName)}'`,
        "rest",
        1,
      );
      const row = rows[0];
      if (!row) return undefined;
      return {
        developerName: row.DeveloperName,
        name: row.Name,
        sobjectTypes: (row.QueueSobjects?.records ?? [])
          .map((r) => r.SobjectType)
          .filter((t): t is string => Boolean(t)),
      };
    },

    async deployQueue(input) {
      return deploySource(
        session,
        "queues",
        `${input.developerName}.queue-meta.xml`,
        input.xml,
        input.signal,
      );
    },

    async enableDigitalExperiences(input) {
      return deploySettings(
        session,
        "Communities",
        renderDigitalExperiencesSettings(),
        input.signal,
      );
    },

    async describePackageVersion(id) {
      const rows = await query<
        VersionParts & {
          Id: string;
          Name?: string;
          SubscriberPackageId?: string;
          ReleaseState?: string;
          IsManaged?: boolean;
          IsPasswordProtected?: boolean;
          IsBeta?: boolean;
          RemoteSiteSettings?: { settings?: Array<{ url?: string }> } | null;
          CspTrustedSites?: { settings?: Array<{ endpointUrl?: string }> } | null;
        }
      >(
        `SELECT Id, Name, SubscriberPackageId, MajorVersion, MinorVersion, PatchVersion, BuildNumber, ReleaseState, IsManaged, IsPasswordProtected, IsBeta, RemoteSiteSettings, CspTrustedSites FROM SubscriberPackageVersion WHERE Id = '${soql(id)}'`,
        "tooling",
        1,
      );
      const row = rows[0];
      if (!row) return undefined;
      const pkg = row.SubscriberPackageId
        ? (
            await query<{ Name?: string; NamespacePrefix?: string | null }>(
              `SELECT Name, NamespacePrefix FROM SubscriberPackage WHERE Id = '${soql(row.SubscriberPackageId)}'`,
              "tooling",
              1,
            )
          )[0]
        : undefined;
      return {
        id: row.Id,
        namespace: pkg?.NamespacePrefix ?? undefined,
        packageName: pkg?.Name,
        version: versionText(row),
        releaseState: row.ReleaseState,
        isManaged: row.IsManaged,
        isPasswordProtected: row.IsPasswordProtected,
        isBeta: row.IsBeta,
        remoteSites: [
          ...(row.RemoteSiteSettings?.settings ?? []).map((s) => s.url),
          ...(row.CspTrustedSites?.settings ?? []).map((s) => s.endpointUrl),
        ].filter((url): url is string => typeof url === "string" && url.length > 0),
      };
    },

    async permissionableFields() {
      const objects = [...new Set(FIN_FIELD_ACCESS.map((field) => field.split(".")[0]))];
      const rows = await query<{
        QualifiedApiName: string;
        EntityDefinition?: { QualifiedApiName?: string } | null;
      }>(
        `SELECT EntityDefinition.QualifiedApiName, QualifiedApiName FROM EntityParticle WHERE EntityDefinition.QualifiedApiName IN (${objects.map((o) => `'${soql(o ?? "")}'`).join(", ")}) AND IsPermissionable = true`,
        "rest",
        2_000,
      );
      return rows
        .filter((row) => row.EntityDefinition?.QualifiedApiName)
        .map((row) => `${row.EntityDefinition?.QualifiedApiName}.${row.QualifiedApiName}`);
    },

    async installPackage(input) {
      const created = await session.request<{ id?: string; success?: boolean }>({
        method: "POST",
        path: "/tooling/sobjects/PackageInstallRequest",
        body: {
          SubscriberPackageVersionKey: input.versionId,
          // "Install for all users", as Fin's setup asks.
          SecurityType: "Full",
          // Never rename or overwrite existing components on a conflict.
          NameConflictResolution: "Block",
          EnableRss: input.enableRss,
        },
        signal: input.signal,
      });
      const requestId = created.body?.id;
      if (created.status >= 300 || !requestId) {
        return { ok: false, status: "Error", errors: [describeHttp(created.status, created.body)] };
      }
      // Some orgs reject reads of the install request (for example
      // INVALID_CROSS_REFERENCE_KEY) while the install proceeds, so each poll
      // also checks Installed Packages and completes as soon as it shows the
      // exact version.
      const deadline = Date.now() + timeoutMs;
      let unreadable: string | undefined;
      while (Date.now() < deadline) {
        await sleep(pollMs, input.signal);
        const polled = await session.request<{
          Status?: string;
          Errors?: { errors?: Array<{ message?: string }> } | null;
        }>({
          method: "GET",
          path: `/tooling/sobjects/PackageInstallRequest/${encodeURIComponent(requestId)}`,
          signal: input.signal,
        });
        const status = polled.status < 300 ? (polled.body?.Status ?? "Unknown") : "Unreadable";
        if (status === "Unreadable") unreadable = describeHttp(polled.status, polled.body);
        if (status === "Success") return { ok: true, requestId, status, errors: [] };
        if (status === "Error" || status === "Canceled") {
          const errors = (polled.body?.Errors?.errors ?? [])
            .map((e) => e.message)
            .filter((m): m is string => Boolean(m));
          return { ok: false, requestId, status, errors };
        }
        if (await isInstalled(input.versionId)) {
          return { ok: true, requestId, status: "Success", errors: [] };
        }
      }
      return {
        ok: false,
        requestId,
        status: "InProgress",
        errors: [
          `Install not confirmed after ${Math.round(timeoutMs / 1_000)} seconds.`,
          ...(unreadable ? [`Install request status unreadable: ${unreadable}`] : []),
        ],
      };
    },

    async deployAccessPermissionSet(input) {
      const result = await deployPermissionSet(
        session.connection,
        { developer_name: input.name, xml: input.xml },
        { signal: input.signal },
      );
      return { ok: result.ok, error: result.error };
    },

    async connectedUser() {
      const identity = await session.identity();
      const rows = await query<{
        Id: string;
        Email: string;
        TimeZoneSidKey: string;
        LocaleSidKey: string;
        LanguageLocaleKey: string;
        EmailEncodingKey: string;
      }>(
        `SELECT Id, Email, TimeZoneSidKey, LocaleSidKey, LanguageLocaleKey, EmailEncodingKey FROM User WHERE Id = '${soql(identity.user_id)}'`,
        "rest",
        1,
      );
      const row = rows[0];
      if (!row) throw new Error("Could not read the connected Salesforce user.");
      return {
        id: row.Id,
        email: row.Email,
        timeZone: row.TimeZoneSidKey,
        locale: row.LocaleSidKey,
        language: row.LanguageLocaleKey,
        emailEncoding: row.EmailEncodingKey,
      };
    },

    async createFinUser(input) {
      const profile = (
        await query<{ Id: string }>(
          `SELECT Id FROM Profile WHERE Name = '${soql(input.profileName)}'`,
          "rest",
          1,
        )
      )[0];
      if (!profile) return { ok: false, error: `Profile "${input.profileName}" not found.` };
      const response = await session.request<{ id?: string; success?: boolean } | ApiError[]>({
        method: "POST",
        path: "/sobjects/User",
        body: {
          Username: input.username,
          FirstName: "Fin",
          LastName: "AI Agent",
          Alias: FIN_USER_ALIAS,
          Email: input.email,
          ProfileId: profile.Id,
          UserPermissionsSupportUser: true,
          TimeZoneSidKey: input.defaults.timeZone,
          LocaleSidKey: input.defaults.locale,
          LanguageLocaleKey: input.defaults.language,
          EmailEncodingKey: input.defaults.emailEncoding,
        },
      });
      const body = response.body as { id?: string };
      if (response.status >= 300 || !body?.id) {
        return { ok: false, error: describeHttp(response.status, response.body) };
      }
      return { ok: true, id: body.id };
    },

    async setServiceCloudUser(userId) {
      const response = await session.request<unknown>({
        method: "PATCH",
        path: `/sobjects/User/${encodeURIComponent(userId)}`,
        body: { UserPermissionsSupportUser: true },
      });
      return response.status < 300
        ? { ok: true }
        : { ok: false, error: describeHttp(response.status, response.body) };
    },

    async assignPermissionSets(userId, names) {
      const ids = await permissionSetIds(names);
      const assigned: string[] = [];
      const errors: string[] = [];
      for (const name of names) {
        const id = ids.get(name);
        if (!id) {
          errors.push(`Permission set ${name} not found.`);
          continue;
        }
        const response = await session.request<unknown>({
          method: "POST",
          path: "/sobjects/PermissionSetAssignment",
          body: { AssigneeId: userId, PermissionSetId: id },
        });
        if (response.status < 300) assigned.push(name);
        else errors.push(`${name}: ${describeHttp(response.status, response.body)}`);
      }
      return { ok: errors.length === 0, assigned, errors };
    },
  };
}

interface VersionParts {
  MajorVersion?: number;
  MinorVersion?: number;
  PatchVersion?: number;
  BuildNumber?: number;
}

interface ApiError {
  message?: string;
  errorCode?: string;
}

/** Deploy one single-field `<name>.settings` through SDR. */
async function deploySettings(
  session: SalesforceSession,
  name: "Security" | "Communities" | "EmailAdministration" | "ExternalClientApp",
  xml: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  return deploySource(session, "settings", `${name}.settings-meta.xml`, xml, signal);
}

/** Deploy one source file through SDR; temp dir always removed. */
async function deploySource(
  session: SalesforceSession,
  folder: "settings" | "queues",
  file: string,
  xml: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "sf-fin-deploy-"));
  try {
    await mkdir(path.join(root, folder), { recursive: true });
    await writeFile(path.join(root, folder, file), xml, "utf8");
    const { ComponentSet } = await import("@salesforce/source-deploy-retrieve");
    const components = ComponentSet.fromSource(root);
    components.apiVersion = session.target.apiVersion;
    components.sourceApiVersion = session.target.apiVersion;
    const job = await components.deploy({
      usernameOrConnection: session.connection,
      apiOptions: { rollbackOnError: true, testLevel: "NoTestRun" },
    });
    const abort = () => void job.cancel?.();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      let result: Awaited<ReturnType<typeof job.pollStatus>>;
      try {
        result = await job.pollStatus(1_000, SETTINGS_DEPLOY_TIMEOUT_MS / 1_000);
      } catch (error) {
        // Timed out waiting: the deploy can still be queued and apply later.
        // Ask Salesforce to cancel it so a late apply does not surprise anyone;
        // callers verify the resulting state either way.
        await job.cancel?.().catch(() => undefined);
        throw error;
      }
      if (result.response.success === true) return { ok: true };
      const raw = result.response.details?.componentFailures as unknown;
      const failures = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      const problem = (failures[0] as { problem?: string } | undefined)?.problem;
      return { ok: false, error: problem ?? `deploy ${result.response.status}` };
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function versionText(parts: VersionParts): string {
  const nums = [parts.MajorVersion, parts.MinorVersion, parts.PatchVersion, parts.BuildNumber];
  return nums.every((n) => typeof n === "number") ? nums.join(".") : "unknown version";
}

function splitNamespace(full: string): [string | undefined, string] {
  const index = full.indexOf("__");
  return index > 0 ? [full.slice(0, index), full.slice(index + 2)] : [undefined, full];
}

function qualified(namespace: string | null, name: string): string {
  return namespace ? `${namespace}__${name}` : name;
}

/** Escape a value for a single-quoted SOQL literal (backslash first). */
function soql(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'");
}

function describeHttp(status: number, body: unknown): string {
  const first = Array.isArray(body) ? (body[0] as ApiError | undefined) : undefined;
  const message = first?.message ?? (typeof body === "string" ? body : undefined);
  return `HTTP ${status}${first?.errorCode ? ` ${first.errorCode}` : ""}${message ? `: ${message.slice(0, 300)}` : ""}`;
}

/** One boolean field of a Settings component; undefined when unreadable. */
async function readSetting(
  session: SalesforceSession,
  type:
    | "SecuritySettings"
    | "CommunitiesSettings"
    | "EmailAdministrationSettings"
    | "ExternalClientAppSettings",
  fullName: "Security" | "Communities" | "EmailAdministration" | "ExternalClientApp",
  field: string,
): Promise<boolean | undefined> {
  try {
    const metadata = session.connection.metadata as unknown as {
      read(type: string, names: string[]): Promise<unknown>;
    };
    const result = (await metadata.read(type, [fullName])) as Record<string, unknown>;
    const value = (Array.isArray(result) ? result[0] : result)?.[field];
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return undefined;
  } catch {
    return undefined;
  }
}

/** CaseSettings.emailToCase.enableEmailToCase; undefined when unreadable. */
async function readEmailToCase(session: SalesforceSession): Promise<boolean | undefined> {
  try {
    const metadata = session.connection.metadata as unknown as {
      read(type: string, names: string[]): Promise<unknown>;
    };
    const result = (await metadata.read("CaseSettings", ["Case"])) as Record<string, unknown>;
    const record = (Array.isArray(result) ? result[0] : result) as Record<string, unknown>;
    const e2c = record?.emailToCase as Record<string, unknown> | undefined;
    const value = e2c?.enableEmailToCase;
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return undefined;
  } catch {
    return undefined;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted."));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Aborted."));
      },
      { once: true },
    );
  });
}

/** ExternalClientAppSettings field behind "Allow access to … consumer secrets via REST API". */
const ECA_REST_SECRET_SETTING = "enableClientSecretInRestApiAccess";

/**
 * The org side of `token_transfer`. The consumer secret is returned only to
 * the runbook, which hands it straight to the browser form; it is never
 * logged, stored, or returned to a tool.
 */
export function createTokenTransferOrg(session: SalesforceSession): TokenTransferOrg {
  const query = async <T>(soql: string, api: "rest" | "tooling" = "rest") =>
    (await session.query<T>({ soql, api, maxRows: 5 })).records;
  return {
    host: new URL(session.target.instanceUrl).hostname,
    async findApp(name) {
      const app = (
        await query<{ Id: string; DeveloperName: string }>(
          `SELECT Id, DeveloperName FROM ExternalClientApplication WHERE DeveloperName = '${soql(name)}'`,
        )
      )[0];
      if (!app) return undefined;
      const metadata = session.connection.metadata as unknown as {
        read(type: string, names: string[]): Promise<unknown>;
      };
      const policy = (await metadata
        // The org-local policy component is named after the app.
        .read("ExtlClntAppOauthConfigurablePolicies", [name])
        .catch(() => undefined)) as
        Record<string, unknown> | Array<Record<string, unknown>> | undefined;
      const row = (Array.isArray(policy) ? policy[0] : policy) ?? {};
      const enabled = row.isClientCredentialsFlowEnabled;
      return {
        id: app.Id,
        name: app.DeveloperName,
        clientCredentials: enabled === true || enabled === "true",
        runAs:
          typeof row.clientCredentialsFlowUser === "string"
            ? row.clientCredentialsFlowUser
            : undefined,
      };
    },
    async restSecretSetting() {
      return readSetting(
        session,
        "ExternalClientAppSettings",
        "ExternalClientApp",
        ECA_REST_SECRET_SETTING,
      );
    },
    async setRestSecretSetting(value) {
      return deploySettings(
        session,
        "ExternalClientApp",
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<ExternalClientAppSettings xmlns="http://soap.sforce.com/2006/04/metadata">',
          `    <${ECA_REST_SECRET_SETTING}>${value}</${ECA_REST_SECRET_SETTING}>`,
          "</ExternalClientAppSettings>",
          "",
        ].join("\n"),
      );
    },
    async readCredentials(appId) {
      const listed = await session.request<{ consumers?: Array<{ id?: string }> }>({
        method: "GET",
        path: `/apps/oauth/credentials/${encodeURIComponent(appId)}`,
      });
      const consumer = listed.status < 300 ? listed.body?.consumers?.[0]?.id : undefined;
      if (!consumer) return undefined;
      const read = await session.request<{ key?: string; secret?: string }>({
        method: "GET",
        path: `/apps/oauth/credentials/${encodeURIComponent(appId)}/${encodeURIComponent(consumer)}`,
        query: { part: "keyandsecret" },
      });
      const key = read.status < 300 ? read.body?.key : undefined;
      const secret = read.status < 300 ? read.body?.secret : undefined;
      return key && secret ? { key, secret } : undefined;
    },
  };
}
