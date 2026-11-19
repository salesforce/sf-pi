/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Salesforce adapter for the Fin for Salesforce setup.
 *
 * Every org call crosses the shared SF Pi connection Module (`sf-conn`), so
 * the target org, API version, and bounded requests stay owned in one place.
 * Reads are fixed SOQL against Fin's declared contract; writes are exactly:
 * one Tooling PackageInstallRequest, one PermissionSet deploy, one User
 * create/update, and PermissionSetAssignment inserts. Nothing else changes.
 */
import type { SalesforceSession } from "../../../../lib/common/sf-conn/index.ts";
import { deployPermissionSet } from "../../../sf-agentscript/lib/agent-user/deploy.ts";
import {
  FIN_ACCESS_PERMISSION_SET,
  FIN_CASE_FIELDS,
  FIN_FIELD_ACCESS,
  FIN_PACKAGE_NAMESPACE,
  FIN_PACKAGE_PERMISSION_SET,
  FIN_USER_ALIAS,
  FIN_USER_PROFILE,
  type FinUserFacts,
  type PackageVersionFacts,
  type SalesforceFacts,
} from "./contract.ts";

const INSTALL_POLL_MS = 5_000;
const INSTALL_TIMEOUT_MS = 15 * 60_000;

/** Narrow seam the setup orchestration depends on (faked in tests). */
export interface FinSalesforceOrg {
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

export function createFinSalesforceOrg(session: SalesforceSession): FinSalesforceOrg {
  const query = async <T>(soql: string, api: "rest" | "tooling" = "rest", maxRows = 200) =>
    (await session.query<T>({ soql, api, maxRows })).records;

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

  return {
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
          IsActive: boolean;
          UserPermissionsSupportUser: boolean;
          Profile?: { UserLicense?: { Name?: string } | null } | null;
        }>(
          `SELECT Id, Username, IsActive, UserPermissionsSupportUser, Profile.UserLicense.Name FROM User WHERE Username = '${soql(username)}'`,
          "rest",
          1,
        );
        const row = rows[0];
        if (row) {
          const assignments = await query<{
            PermissionSet?: { Name?: string; NamespacePrefix?: string | null } | null;
          }>(
            `SELECT PermissionSet.Name, PermissionSet.NamespacePrefix FROM PermissionSetAssignment WHERE AssigneeId = '${soql(row.Id)}'`,
          );
          user = {
            id: row.Id,
            username: row.Username,
            isActive: row.IsActive,
            serviceCloudUser: row.UserPermissionsSupportUser === true,
            licenseName: row.Profile?.UserLicense?.Name,
            assignedPermissionSets: assignments
              .map((a) =>
                a.PermissionSet?.Name
                  ? qualified(a.PermissionSet.NamespacePrefix ?? null, a.PermissionSet.Name)
                  : undefined,
              )
              .filter((name): name is string => Boolean(name)),
          };
        }
      }

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
        auditFieldsEnabled: await readAuditFieldsSetting(session),
      };
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
      const deadline = Date.now() + INSTALL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(INSTALL_POLL_MS, input.signal);
        const polled = await session.request<{
          Status?: string;
          Errors?: { errors?: Array<{ message?: string }> } | null;
        }>({
          method: "GET",
          path: `/tooling/sobjects/PackageInstallRequest/${encodeURIComponent(requestId)}`,
          signal: input.signal,
        });
        const status = polled.body?.Status ?? "Unknown";
        if (status === "Success") return { ok: true, requestId, status, errors: [] };
        if (status === "Error" || status === "Canceled") {
          const errors = (polled.body?.Errors?.errors ?? [])
            .map((e) => e.message)
            .filter((m): m is string => Boolean(m));
          return { ok: false, requestId, status, errors };
        }
      }
      return {
        ok: false,
        requestId,
        status: "InProgress",
        errors: [`Install still running after ${INSTALL_TIMEOUT_MS / 60_000} minutes.`],
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

/** SecuritySettings.enableAuditFieldsInactiveOwner; undefined when unreadable. */
async function readAuditFieldsSetting(session: SalesforceSession): Promise<boolean | undefined> {
  try {
    const metadata = session.connection.metadata as unknown as {
      read(type: string, names: string[]): Promise<unknown>;
    };
    const result = (await metadata.read("SecuritySettings", ["Security"])) as Record<
      string,
      unknown
    >;
    const value = (Array.isArray(result) ? result[0] : result)?.enableAuditFieldsInactiveOwner;
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
