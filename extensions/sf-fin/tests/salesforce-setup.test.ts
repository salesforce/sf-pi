/* SPDX-License-Identifier: Apache-2.0 */
/** Fin for Salesforce: contract, readiness, plan/execute, refusals, and verified results. */
import { describe, expect, it } from "vitest";
import {
  defaultFinUsername,
  evaluateSalesforceReadiness,
  FIN_ACCESS_PERMISSION_SET,
  FIN_CASE_FIELDS,
  FIN_PACKAGE_PERMISSION_SET,
  parsePackageVersionId,
  renderAccessPermissionSet,
  type SalesforceFacts,
} from "../lib/salesforce/contract.ts";
import type { FinSalesforceOrg } from "../lib/salesforce/org.ts";
import { runSalesforceSetup } from "../lib/salesforce/setup.ts";

const ORG_ID = "00D000000000001AAA";
const VERSION = "04t000000000001AAA";
const OTHER_VERSION = "04t000000000002AAA";
const USERNAME = defaultFinUsername(ORG_ID);

describe("package version parsing", () => {
  it("accepts a bare 04t id or a Salesforce install link and nothing else", () => {
    expect(parsePackageVersionId(VERSION)).toBe(VERSION);
    expect(parsePackageVersionId("04t000000000001")).toBe("04t000000000001");
    expect(
      parsePackageVersionId(
        `https://login.salesforce.com/packaging/installPackage.apexp?p0=${VERSION}`,
      ),
    ).toBe(VERSION);
    for (const bad of [
      "",
      "033000000000001AAA",
      `http://login.salesforce.com/packaging/installPackage.apexp?p0=${VERSION}`,
      "https://example.com/install?p0=not-an-id",
      `${VERSION}; DROP`,
    ]) {
      expect(parsePackageVersionId(bad)).toBeUndefined();
    }
  });
});

describe("access permission set rendering", () => {
  it("is deterministic, least-privilege, and filters non-permissionable fields", () => {
    const fields = ["Case.Subject", "Case.Description", "Contact.Email", "Task.WhatId"];
    const a = renderAccessPermissionSet({ permissionableFields: fields });
    const b = renderAccessPermissionSet({ permissionableFields: [...fields].reverse() });
    expect(a.xml).toBe(b.xml);
    expect(a.name).toBe(FIN_ACCESS_PERMISSION_SET);
    expect(a.fields).toEqual(["Case.Description", "Case.Subject", "Contact.Email", "Task.WhatId"]);
    expect(a.skippedFields).toContain("Case.SuppliedEmail");
    expect(a.xml).not.toMatch(/<allowDelete>true/);
    expect(a.xml).not.toMatch(/<(?:viewAllRecords|modifyAllRecords)>true/);
    expect(a.xml).toContain("<name>ViewSetup</name>");
    expect(a.xml).not.toContain("InsertFeedSystemFields");
    expect(renderAccessPermissionSet({ includeAuditPermissions: true }).xml).toContain(
      "<name>InsertFeedSystemFields</name>",
    );
  });

  it("refuses an unsafe API name", () => {
    expect(() => renderAccessPermissionSet({ name: "Bad Name" })).toThrow();
    expect(() => renderAccessPermissionSet({ name: "ns__Name" })).toThrow();
  });
});

describe("readiness", () => {
  it("reports every gap on an empty org and is not ready", () => {
    const report = evaluateSalesforceReadiness(emptyFacts());
    expect(report.readyToConnect).toBe(false);
    expect(states(report.checks)).toMatchObject({
      package: "missing",
      "case-fields": "missing",
      "package-permission-set": "missing",
      "access-permission-set": "missing",
      "fin-user": "missing",
    });
  });

  it("is ready to connect when the package, permission sets, and Fin user are in place", () => {
    const report = evaluateSalesforceReadiness(readyFacts());
    expect(report).toMatchObject({
      packageReady: true,
      permissionsReady: true,
      readyToConnect: true,
    });
  });

  it("flags an upgrade when Fin's link points to a different version", () => {
    const facts = readyFacts();
    facts.requested = { id: OTHER_VERSION, version: "2.0.0.1", namespace: "finai" };
    expect(states(evaluateSalesforceReadiness(facts).checks).package).toBe("warn");
  });
});

describe("runSalesforceSetup", () => {
  it("readiness is read-only", async () => {
    const org = fakeOrg();
    const result = await runSalesforceSetup(org, { operation: "readiness", targetOrg: "DevOrg" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("package_install");
    expect(org.writes).toEqual([]);
  });

  it("package_install requires a version and refuses malformed input", async () => {
    const org = fakeOrg();
    expect(
      (await runSalesforceSetup(org, { operation: "package_install", targetOrg: "DevOrg" }))
        .details,
    ).toMatchObject({ code: "input" });
    expect(
      (
        await runSalesforceSetup(org, {
          operation: "package_install",
          targetOrg: "DevOrg",
          packageVersion: "not-a-link",
        })
      ).details,
    ).toMatchObject({ code: "input" });
    expect(org.writes).toEqual([]);
  });

  it("refuses a package from another namespace, even with allow_mutation", async () => {
    const org = fakeOrg({ namespace: "other" });
    const result = await runSalesforceSetup(org, {
      operation: "package_install",
      targetOrg: "DevOrg",
      packageVersion: VERSION,
      execute: true,
    });
    expect(result.details).toMatchObject({ code: "wrong_package" });
    expect(org.writes).toEqual([]);
  });

  it("plans without writing, then installs the exact version and verifies it", async () => {
    const org = fakeOrg();
    const plan = await runSalesforceSetup(org, {
      operation: "package_install",
      targetOrg: "DevOrg",
      packageVersion: `https://login.salesforce.com/packaging/installPackage.apexp?p0=${VERSION}`,
    });
    expect(plan.details).toMatchObject({ phase: "plan", versionId: VERSION });
    expect(plan.text).toContain("allow_mutation=true");
    expect(org.writes).toEqual([]);

    const run = await runSalesforceSetup(org, {
      operation: "package_install",
      targetOrg: "DevOrg",
      packageVersion: VERSION,
      execute: true,
    });
    expect(org.writes).toEqual([`install:${VERSION}:rss=true`]);
    expect(run).toMatchObject({ ok: true, details: { phase: "execute", verified: true } });
  });

  it("reports failure when the install does not verify", async () => {
    const org = fakeOrg({ installSucceeds: false });
    const run = await runSalesforceSetup(org, {
      operation: "package_install",
      targetOrg: "DevOrg",
      packageVersion: VERSION,
      execute: true,
    });
    expect(run.ok).toBe(false);
    expect(run.details).toMatchObject({ verified: false });
  });

  it("is a no-op when the exact version is already installed", async () => {
    const org = fakeOrg({ installed: true });
    const run = await runSalesforceSetup(org, {
      operation: "package_install",
      targetOrg: "DevOrg",
      packageVersion: VERSION,
      execute: true,
    });
    expect(run.details).toMatchObject({ phase: "noop" });
    expect(org.writes).toEqual([]);
  });

  it("permissions_apply refuses before the package is installed", async () => {
    const org = fakeOrg();
    const run = await runSalesforceSetup(org, {
      operation: "permissions_apply",
      targetOrg: "DevOrg",
      execute: true,
    });
    expect(run.details).toMatchObject({ code: "package_missing" });
    expect(org.writes).toEqual([]);
  });

  it("permissions_apply plans, then deploys, creates the Fin user, assigns, and verifies", async () => {
    const org = fakeOrg({ installed: true });
    const plan = await runSalesforceSetup(org, {
      operation: "permissions_apply",
      targetOrg: "DevOrg",
    });
    expect(plan.details).toMatchObject({
      phase: "plan",
      username: USERNAME,
      createUser: true,
      assign: [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET],
    });
    expect(org.writes).toEqual([]);

    const run = await runSalesforceSetup(org, {
      operation: "permissions_apply",
      targetOrg: "DevOrg",
      execute: true,
    });
    expect(org.writes).toEqual([
      `deploy:${FIN_ACCESS_PERMISSION_SET}`,
      `createUser:${USERNAME}:admin@example.com`,
      `assign:005FIN:${FIN_PACKAGE_PERMISSION_SET},${FIN_ACCESS_PERMISSION_SET}`,
    ]);
    expect(run).toMatchObject({ ok: true, details: { permissionsReady: true } });
    expect(run.text).toContain("Connect to Salesforce");
  });

  it("permissions_apply on an existing user only fills the gaps", async () => {
    const org = fakeOrg({
      installed: true,
      accessPs: true,
      user: { serviceCloudUser: false, assigned: [FIN_PACKAGE_PERMISSION_SET] },
    });
    await runSalesforceSetup(org, {
      operation: "permissions_apply",
      targetOrg: "DevOrg",
      execute: true,
    });
    expect(org.writes).toEqual([
      `deploy:${FIN_ACCESS_PERMISSION_SET}`,
      "serviceCloud:005FIN",
      `assign:005FIN:${FIN_ACCESS_PERMISSION_SET}`,
    ]);
  });

  it("refuses an invalid username", async () => {
    const run = await runSalesforceSetup(fakeOrg(), {
      operation: "permissions_apply",
      targetOrg: "DevOrg",
      username: "not a username",
    });
    expect(run.details).toMatchObject({ code: "input" });
  });
});

// ─── fixtures ───────────────────────────────────────────────────────────────

function states(checks: Array<{ id: string; state: string }>): Record<string, string> {
  return Object.fromEntries(checks.map((check) => [check.id, check.state]));
}

function emptyFacts(): SalesforceFacts {
  return {
    orgId: ORG_ID,
    orgType: "developer",
    caseFields: [],
    permissionSets: [],
    finExternalClientApps: 0,
    username: USERNAME,
    profileExists: true,
    profileLicensesAvailable: 2,
    auditFieldsEnabled: false,
  };
}

function readyFacts(): SalesforceFacts {
  return {
    ...emptyFacts(),
    installed: { versionId: VERSION, version: "1.0.0.1" },
    caseFields: [...FIN_CASE_FIELDS],
    permissionSets: [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET],
    finExternalClientApps: 1,
    user: {
      id: "005FIN",
      username: USERNAME,
      isActive: true,
      serviceCloudUser: true,
      assignedPermissionSets: [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET],
    },
  };
}

interface FakeOptions {
  namespace?: string;
  installed?: boolean;
  installSucceeds?: boolean;
  accessPs?: boolean;
  user?: { serviceCloudUser: boolean; assigned: string[] };
}

/** In-memory org: state changes only through the FinSalesforceOrg write methods. */
function fakeOrg(options: FakeOptions = {}): FinSalesforceOrg & { writes: string[] } {
  const writes: string[] = [];
  const state = {
    installed: options.installed === true,
    accessPs: options.accessPs === true,
    user: options.user
      ? {
          id: "005FIN",
          serviceCloudUser: options.user.serviceCloudUser,
          assigned: [...options.user.assigned],
        }
      : (undefined as undefined | { id: string; serviceCloudUser: boolean; assigned: string[] }),
  };
  return {
    writes,
    async orgId() {
      return ORG_ID;
    },
    async readFacts({ username }) {
      return {
        orgId: ORG_ID,
        orgType: "developer",
        installed: state.installed ? { versionId: VERSION, version: "1.0.0.1" } : undefined,
        caseFields: state.installed ? [...FIN_CASE_FIELDS] : [],
        permissionSets: [
          ...(state.installed ? [FIN_PACKAGE_PERMISSION_SET] : []),
          ...(state.accessPs ? [FIN_ACCESS_PERMISSION_SET] : []),
        ],
        finExternalClientApps: state.installed ? 1 : 0,
        username,
        user: state.user
          ? {
              id: state.user.id,
              username,
              isActive: true,
              serviceCloudUser: state.user.serviceCloudUser,
              assignedPermissionSets: [...state.user.assigned],
            }
          : undefined,
        profileExists: true,
        profileLicensesAvailable: 2,
        auditFieldsEnabled: false,
      };
    },
    async describePackageVersion(id) {
      return {
        id,
        namespace: options.namespace ?? "finai",
        packageName: "Fin for Salesforce",
        version: "1.0.0.1",
        releaseState: "Released",
        isManaged: true,
        isPasswordProtected: false,
        isBeta: false,
        remoteSites: ["https://api.example.com"],
      };
    },
    async permissionableFields() {
      return ["Case.Subject", "Case.Description", "Contact.Email"];
    },
    async installPackage({ versionId, enableRss }) {
      writes.push(`install:${versionId}:rss=${enableRss}`);
      if (options.installSucceeds === false) {
        return { ok: false, requestId: "0Hf1", status: "Error", errors: ["install failed"] };
      }
      state.installed = true;
      return { ok: true, requestId: "0Hf1", status: "Success", errors: [] };
    },
    async deployAccessPermissionSet({ name }) {
      writes.push(`deploy:${name}`);
      state.accessPs = true;
      return { ok: true };
    },
    async connectedUser() {
      return {
        id: "005ADMIN",
        email: "admin@example.com",
        timeZone: "America/Los_Angeles",
        locale: "en_US",
        language: "en_US",
        emailEncoding: "UTF-8",
      };
    },
    async createFinUser({ username, email }) {
      writes.push(`createUser:${username}:${email}`);
      state.user = { id: "005FIN", serviceCloudUser: true, assigned: [] };
      return { ok: true, id: "005FIN" };
    },
    async setServiceCloudUser(userId) {
      writes.push(`serviceCloud:${userId}`);
      if (state.user) state.user.serviceCloudUser = true;
      return { ok: true };
    },
    async assignPermissionSets(userId, names) {
      writes.push(`assign:${userId}:${names.join(",")}`);
      state.user?.assigned.push(...names);
      return { ok: true, assigned: names, errors: [] };
    },
  };
}
