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
  queueDeveloperName,
  renderAccessPermissionSet,
  renderHandoffQueue,
  type SalesforceFacts,
} from "../lib/salesforce/contract.ts";
import type { FinCaseActivity, FinSalesforceOrg } from "../lib/salesforce/org.ts";
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
    expect(a.xml).toContain("<name>CanInsertFeedSystemFields</name>");
    expect(a.xml).not.toContain("CreateAuditFields");
    expect(renderAccessPermissionSet({ includeAuditPermissions: true }).xml).toContain(
      "<name>CreateAuditFields</name>",
    );
    // Only permissions the org exposes are rendered.
    expect(
      renderAccessPermissionSet({
        includeAuditPermissions: true,
        availablePermissions: ["ApiEnabled"],
      }).userPermissions,
    ).toEqual(["ApiEnabled"]);
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

describe("go-live readiness (routing, email, handoff, effective access)", () => {
  const connected = (): SalesforceFacts => ({
    ...readyFacts(),
    auditFieldsEnabled: true,
    accessHasAuditPermission: true,
    feedVisibilityAvailable: true,
    digitalExperiencesEnabled: true,
    oauthConnected: true,
    integrationUser: {
      id: "005ADMIN",
      username: "admin@example.com",
      assignedPermissionSets: [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET],
    },
  });

  it("checks Enhanced Email, Email-to-Case, routing, handoff queue, and effective access", () => {
    const facts: SalesforceFacts = {
      ...connected(),
      enhancedEmailEnabled: false,
      emailToCaseEnabled: false,
      caseRouting: { activeFlows: [], activeAssignmentRule: "Standard", casesOwnedByFin: 0 },
      caseQueues: [],
      // Fin's matrix needs Case create/read/edit for both users and Contact create/read for the
      // integration user; EmailMessage and FeedItem follow Case access.
      effectiveAccess: {
        fin: { Case: { create: true, read: true, edit: false } },
        integration: {
          Case: { create: true, read: true, edit: true },
          Contact: { create: false, read: true, edit: true },
        },
      },
    };
    const report = evaluateSalesforceReadiness(facts);
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["enhanced-email"]).toMatchObject({
      state: "missing",
      fix: "enhanced_email_enable",
    });
    expect(byId["email-to-case"]).toMatchObject({ state: "warn", fix: "human" });
    expect(byId["case-routing"]).toMatchObject({ state: "missing", fix: "human" });
    expect(byId["case-routing"]?.detail).toContain("sf_flow");
    expect(byId["handoff-queue"]).toMatchObject({ state: "warn", fix: "handoff_queue_create" });
    expect(byId["effective-access"]).toMatchObject({ state: "missing", fix: "permissions_apply" });
    expect(byId["effective-access"]?.title).toContain("Fin user: Case edit");
    expect(byId["effective-access"]?.title).toContain("integration user: Contact create");
    // Connection stays the gate for "connected"; go-live gaps are reported separately.
    expect(report.connected).toBe(true);
    expect(report.goLiveReady).toBe(false);
  });

  it("is go-live ready when routing reaches the Fin user, email works, and access matches Fin's matrix", () => {
    const facts: SalesforceFacts = {
      ...connected(),
      enhancedEmailEnabled: true,
      emailToCaseEnabled: true,
      caseRouting: {
        activeFlows: ["Case_Assign_To_Fin"],
        activeAssignmentRule: "Standard",
        casesOwnedByFin: 3,
      },
      caseQueues: ["Support"],
      effectiveAccess: {
        fin: { Case: { create: true, read: true, edit: true } },
        integration: {
          Case: { create: true, read: true, edit: true },
          Contact: { create: true, read: true, edit: true },
        },
      },
    };
    const report = evaluateSalesforceReadiness(facts);
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c.state]));
    expect(byId).toMatchObject({
      "enhanced-email": "ok",
      "email-to-case": "ok",
      "case-routing": "ok",
      "handoff-queue": "ok",
      "effective-access": "ok",
    });
    expect(report.goLiveReady).toBe(true);
  });

  it("warns when an active Flow exists but no case has reached the Fin user yet", () => {
    const facts: SalesforceFacts = {
      ...connected(),
      caseRouting: { activeFlows: ["Case_Assign_To_Fin"], casesOwnedByFin: 0 },
    };
    const check = evaluateSalesforceReadiness(facts).checks.find((c) => c.id === "case-routing");
    expect(check).toMatchObject({ state: "warn" });
    expect(check?.detail).toContain("test case");
  });

  it("omits go-live checks the org could not read instead of guessing", () => {
    const ids = evaluateSalesforceReadiness(connected()).checks.map((c) => c.id);
    for (const id of [
      "enhanced-email",
      "email-to-case",
      "case-routing",
      "handoff-queue",
      "effective-access",
    ]) {
      expect(ids).not.toContain(id);
    }
  });
});

describe("enhanced_email_enable", () => {
  it("plans a single EmailAdministrationSettings field, executes, and verifies it", async () => {
    const org = fakeOrg({ installed: true, enhancedEmail: false });
    const plan = await runSalesforceSetup(org, {
      operation: "enhanced_email_enable",
      targetOrg: "DevOrg",
    });
    expect(plan.details).toMatchObject({
      phase: "plan",
      setting: "enableEnhancedEmailEnabled",
      value: true,
    });
    expect(plan.text).toContain("EmailAdministrationSettings");
    expect(org.writes).toEqual([]);
    const run = await runSalesforceSetup(org, {
      operation: "enhanced_email_enable",
      targetOrg: "DevOrg",
      execute: true,
    });
    expect(run.ok).toBe(true);
    expect(org.writes).toEqual(["settings:enableEnhancedEmailEnabled=true"]);
    const again = await runSalesforceSetup(org, {
      operation: "enhanced_email_enable",
      targetOrg: "DevOrg",
      execute: true,
    });
    expect(again.details).toMatchObject({ phase: "noop" });
  });
});

describe("handoff_queue_create", () => {
  it("derives a Salesforce-valid queue API name from the label", () => {
    expect(queueDeveloperName("Fin Handoff")).toBe("Fin_Handoff");
    expect(queueDeveloperName("  Tier 2 -- escalations! ")).toBe("Tier_2_escalations");
    expect(queueDeveloperName("2nd line")).toBe("Q_2nd_line");
    for (const bad of ["", "   ", "!!!", "x".repeat(41)]) {
      expect(queueDeveloperName(bad)).toBeUndefined();
    }
  });

  it("renders one Case queue with no members, no email, and no hierarchy access", () => {
    const xml = renderHandoffQueue("Fin Handoff");
    expect(xml).toContain("<name>Fin Handoff</name>");
    expect(xml).toContain("<sobjectType>Case</sobjectType>");
    expect(xml.match(/<queueSobject>/g)).toHaveLength(1);
    expect(xml).toContain("<doesIncludeBosses>false</doesIncludeBosses>");
    expect(xml).toContain("<doesSendEmailToMembers>false</doesSendEmailToMembers>");
    expect(xml).not.toContain("queueMembers");
    expect(renderHandoffQueue("R&D <team>")).toContain("<name>R&amp;D &lt;team&gt;</name>");
  });

  it("plans, executes, verifies, then is a no-op", async () => {
    const org = fakeOrg({ installed: true, goLive: { caseQueues: [] } });
    const plan = await runSalesforceSetup(org, {
      operation: "handoff_queue_create",
      targetOrg: "DevOrg",
    });
    expect(plan.details).toMatchObject({
      phase: "plan",
      queue: { name: "Fin Handoff", developerName: "Fin_Handoff", sobjectType: "Case" },
    });
    expect(plan.text).toContain("Fin_Handoff");
    expect(plan.text).toContain("Salesforce cases workflow");
    expect(org.writes).toEqual([]);

    const run = await runSalesforceSetup(org, {
      operation: "handoff_queue_create",
      targetOrg: "DevOrg",
      execute: true,
    });
    expect(run.ok).toBe(true);
    expect(run.details).toMatchObject({ phase: "execute", verified: true });
    expect(org.writes).toEqual(["queue:Fin_Handoff(Case)"]);
    expect(run.text).toContain("Fin → Deploy → Salesforce cases");

    const again = await runSalesforceSetup(org, {
      operation: "handoff_queue_create",
      targetOrg: "DevOrg",
      execute: true,
    });
    expect(again.details).toMatchObject({ phase: "noop" });
    expect(org.writes).toHaveLength(1);
  });

  it("uses a given queue name", async () => {
    const org = fakeOrg({ installed: true, goLive: { caseQueues: [] } });
    const run = await runSalesforceSetup(org, {
      operation: "handoff_queue_create",
      targetOrg: "DevOrg",
      queueName: "Tier 2 Support",
      execute: true,
    });
    expect(run.ok).toBe(true);
    expect(org.writes).toEqual(["queue:Tier_2_Support(Case)"]);
  });

  it("never changes an existing queue that does not accept Cases", async () => {
    const org = fakeOrg({
      installed: true,
      goLive: { caseQueues: [] },
      queues: [{ developerName: "Fin_Handoff", name: "Fin Handoff", sobjectTypes: ["Lead"] }],
    });
    const run = await runSalesforceSetup(org, {
      operation: "handoff_queue_create",
      targetOrg: "DevOrg",
      execute: true,
    });
    expect(run.ok).toBe(false);
    expect(run.details).toMatchObject({ phase: "refused", code: "queue_exists_other_objects" });
    expect(org.writes).toEqual([]);
  });

  it("refuses a name that cannot become a queue API name", async () => {
    const org = fakeOrg({ installed: true });
    const run = await runSalesforceSetup(org, {
      operation: "handoff_queue_create",
      targetOrg: "DevOrg",
      queueName: "!!!",
      execute: true,
    });
    expect(run.details).toMatchObject({ phase: "refused", code: "input" });
    expect(org.writes).toEqual([]);
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

  it("reports success from the verified org state, not from the install request status", async () => {
    const org = fakeOrg({ installReportsInProgress: true });
    const run = await runSalesforceSetup(org, {
      operation: "package_install",
      targetOrg: "DevOrg",
      packageVersion: VERSION,
      execute: true,
    });
    expect(run).toMatchObject({ ok: true, details: { verified: true } });
    expect(run.text).not.toContain("still running");
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
      `assign:005ADMIN:${FIN_PACKAGE_PERMISSION_SET},${FIN_ACCESS_PERMISSION_SET}`,
    ]);
    expect(run).toMatchObject({ ok: true, details: { permissionsReady: true } });
    // Audit fields are still off, so readiness points there next.
    expect(run.text).toContain("operation='audit_fields_enable'");
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
      `assign:005ADMIN:${FIN_PACKAGE_PERMISSION_SET},${FIN_ACCESS_PERMISSION_SET}`,
    ]);
  });

  it("audit_fields_enable plans, deploys only the one setting, verifies, and is idempotent", async () => {
    const org = fakeOrg({ installed: true });
    const plan = await runSalesforceSetup(org, {
      operation: "audit_fields_enable",
      targetOrg: "DevOrg",
    });
    expect(plan.details).toMatchObject({
      phase: "plan",
      setting: "enableAuditFieldsInactiveOwner",
    });
    expect(org.writes).toEqual([]);
    const run = await runSalesforceSetup(org, {
      operation: "audit_fields_enable",
      targetOrg: "DevOrg",
      execute: true,
    });
    expect(run).toMatchObject({ ok: true, details: { verified: true } });
    expect(org.writes).toEqual(["settings:enableAuditFieldsInactiveOwner=true"]);
    const again = await runSalesforceSetup(org, {
      operation: "audit_fields_enable",
      targetOrg: "DevOrg",
      execute: true,
    });
    expect(again.details).toMatchObject({ phase: "noop" });
    expect(org.writes).toHaveLength(1);
  });

  it("after audit_fields_enable, permissions_apply adds CreateAuditFields and readiness says connect next", async () => {
    const org = fakeOrg({
      installed: true,
      accessPs: true,
      auditFieldsEnabled: true,
      digitalExperiences: true,
      user: {
        serviceCloudUser: true,
        assigned: [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET],
      },
      integrationAssigned: [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET],
    });
    const before = await runSalesforceSetup(org, { operation: "readiness", targetOrg: "DevOrg" });
    expect(before.text).toContain("operation='permissions_apply'");
    const run = await runSalesforceSetup(org, {
      operation: "permissions_apply",
      targetOrg: "DevOrg",
      execute: true,
    });
    expect(run).toMatchObject({ ok: true, details: { permissionsReady: true } });
    expect(run.text).toContain("operation='connect'");
  });

  it("connect refuses until the Salesforce side is ready", async () => {
    const run = await runSalesforceSetup(fakeOrg({ installed: true }), {
      operation: "connect",
      targetOrg: "DevOrg",
      execute: true,
      connect: async () => ({ ok: true, steps: [] }),
    });
    expect(run.details).toMatchObject({ code: "not_ready" });
  });

  it("connect plans with the live card for Developer Edition, runs the runbook, and verifies the token", async () => {
    const org = fakeOrg({
      installed: true,
      accessPs: true,
      auditFieldsEnabled: true,
      accessHasAudit: true,
      user: {
        serviceCloudUser: true,
        assigned: [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET],
      },
      integrationAssigned: [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET],
    });
    const plan = await runSalesforceSetup(org, { operation: "connect", targetOrg: "DevOrg" });
    expect(plan.details).toMatchObject({
      phase: "plan",
      environment: "live",
      orgHost: "example.my.salesforce.com",
      integrationUser: "admin@example.com",
      finUser: "Fin AI Agent",
    });
    const calls: unknown[] = [];
    const run = await runSalesforceSetup(org, {
      operation: "connect",
      targetOrg: "DevOrg",
      execute: true,
      connect: async (input) => {
        calls.push(input);
        return { ok: true, steps: ["done"] };
      },
    });
    // The runbook ran, but the org shows no Fin token: not verified.
    expect(calls).toEqual([
      {
        card: "live",
        orgHost: "example.my.salesforce.com",
        integrationUsername: "admin@example.com",
        finUserName: "Fin AI Agent",
      },
    ]);
    expect(run).toMatchObject({ ok: false, details: { connected: false } });
  });

  it("readiness flags FeedItem.Visibility and names digital_experiences_enable", async () => {
    const org = fakeOrg({
      installed: true,
      accessPs: true,
      auditFieldsEnabled: true,
      accessHasAudit: true,
      oauthConnected: true,
      user: {
        serviceCloudUser: true,
        assigned: [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET],
      },
      integrationAssigned: [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET],
    });
    const before = await runSalesforceSetup(org, { operation: "readiness", targetOrg: "DevOrg" });
    expect(before.ok).toBe(false);
    expect(before.details).toMatchObject({ connected: true });
    expect(
      states((before.details as { checks: Array<{ id: string; state: string }> }).checks),
    ).toMatchObject({
      "feed-visibility": "missing",
    });
    expect(before.text).toContain("operation='digital_experiences_enable'");

    const plan = await runSalesforceSetup(org, {
      operation: "digital_experiences_enable",
      targetOrg: "DevOrg",
    });
    expect(plan.details).toMatchObject({ phase: "plan", setting: "enableNetworksEnabled" });
    expect(plan.text).toMatch(/cannot be turned off|can't be turned off|irreversible/iu);
    expect(org.writes).toEqual([]);

    const run = await runSalesforceSetup(org, {
      operation: "digital_experiences_enable",
      targetOrg: "DevOrg",
      execute: true,
    });
    expect(run).toMatchObject({ ok: true, details: { verified: true } });
    expect(org.writes).toEqual(["settings:enableNetworksEnabled=true"]);

    const after = await runSalesforceSetup(org, { operation: "readiness", targetOrg: "DevOrg" });
    expect(after.ok).toBe(true);
    expect(after.text).toContain("Salesforce side complete");

    const again = await runSalesforceSetup(org, {
      operation: "digital_experiences_enable",
      targetOrg: "DevOrg",
      execute: true,
    });
    expect(again.details).toMatchObject({ phase: "noop" });
    expect(org.writes).toHaveLength(1);
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
  /** Package installs, but the install request status never reads as Success. */
  installReportsInProgress?: boolean;
  accessPs?: boolean;
  user?: { serviceCloudUser: boolean; assigned: string[] };
  auditFieldsEnabled?: boolean;
  integrationAssigned?: string[];
  oauthConnected?: boolean;
  accessHasAudit?: boolean;
  digitalExperiences?: boolean;
  enhancedEmail?: boolean;
  goLive?: Pick<SalesforceFacts, "emailToCaseEnabled" | "caseRouting" | "caseQueues">;
  queues?: Array<{ developerName: string; name: string; sobjectTypes: string[] }>;
  observe?: FinCaseActivity;
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
    auditFieldsEnabled: options.auditFieldsEnabled === true,
    integrationAssigned: [...(options.integrationAssigned ?? [])],
    oauthConnected: options.oauthConnected === true,
    accessHasAudit: options.accessHasAudit === true,
    digitalExperiences: options.digitalExperiences === true,
    enhancedEmail: options.enhancedEmail,
    queues: [...(options.queues ?? [])],
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
              name: "Fin AI Agent",
              isActive: true,
              serviceCloudUser: state.user.serviceCloudUser,
              assignedPermissionSets: [...state.user.assigned],
            }
          : undefined,
        profileExists: true,
        profileLicensesAvailable: 2,
        auditFieldsEnabled: state.auditFieldsEnabled,
        instanceUrl: "https://example.my.salesforce.com",
        integrationUser: {
          id: "005ADMIN",
          username: "admin@example.com",
          assignedPermissionSets: [...state.integrationAssigned],
        },
        oauthConnected: state.oauthConnected,
        accessHasAuditPermission: state.accessHasAudit,
        digitalExperiencesEnabled: state.digitalExperiences,
        feedVisibilityAvailable: state.digitalExperiences,
        enhancedEmailEnabled: state.enhancedEmail,
        ...options.goLive,
        ...(options.goLive?.caseQueues
          ? {
              caseQueues: [
                ...options.goLive.caseQueues,
                ...state.queues.filter((q) => q.sobjectTypes.includes("Case")).map((q) => q.name),
              ],
            }
          : {}),
      };
    },
    async findQueue(developerName) {
      return state.queues.find((q) => q.developerName === developerName);
    },
    async deployQueue(input) {
      writes.push(`queue:${input.developerName}(Case)`);
      state.queues.push({
        developerName: input.developerName,
        name: input.name,
        sobjectTypes: ["Case"],
      });
      return { ok: true };
    },
    async readFinCaseActivity() {
      return (
        options.observe ?? {
          finUserOwned: 0,
          involved: 0,
          byResolution: {},
          byOrigin: {},
          recent: [],
        }
      );
    },
    async enableEnhancedEmail() {
      writes.push("settings:enableEnhancedEmailEnabled=true");
      state.enhancedEmail = true;
      return { ok: true };
    },
    async availablePermissions() {
      return [
        "ApiEnabled",
        "CanInsertFeedSystemFields",
        "EditTask",
        "ViewAllUsers",
        "ViewRoles",
        "ViewSetup",
        ...(state.auditFieldsEnabled ? ["CreateAuditFields"] : []),
      ];
    },
    async enableDigitalExperiences() {
      writes.push("settings:enableNetworksEnabled=true");
      state.digitalExperiences = true;
      return { ok: true };
    },
    async enableAuditFields() {
      writes.push("settings:enableAuditFieldsInactiveOwner=true");
      state.auditFieldsEnabled = true;
      return { ok: true };
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
      if (options.installReportsInProgress) {
        return {
          ok: false,
          requestId: "0Hf1",
          status: "InProgress",
          errors: ["Install still running after 15 minutes."],
        };
      }
      return { ok: true, requestId: "0Hf1", status: "Success", errors: [] };
    },
    async deployAccessPermissionSet({ name, xml }) {
      writes.push(`deploy:${name}`);
      state.accessPs = true;
      state.accessHasAudit = xml.includes("<name>CreateAuditFields</name>");
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
      if (userId === "005ADMIN") state.integrationAssigned.push(...names);
      else state.user?.assigned.push(...names);
      return { ok: true, assigned: names, errors: [] };
    },
  };
}

describe("observe (cases Fin worked)", () => {
  it("summarizes Fin's resolution states, origins, and recent cases without writing", async () => {
    const org = fakeOrg({
      installed: true,
      observe: {
        finUserOwned: 3,
        involved: 5,
        // Fin stores the picklist API values (labels are Soft Resolution, …).
        byResolution: { soft_resolution: 2, hard_resolution: 1, routed_to_team: 2 },
        byOrigin: { Web: 4, Email: 1 },
        recent: [
          {
            caseNumber: "00000001",
            subject: "Example question",
            status: "New",
            origin: "Web",
            resolution: "soft_resolution",
            ownedByFin: true,
            lastModified: "2026-01-02T00:00:00.000Z",
          },
        ],
      },
    });
    const result = await runSalesforceSetup(org, { operation: "observe", targetOrg: "DevOrg" });
    expect(result.ok).toBe(true);
    expect(result.details).toMatchObject({
      phase: "observe",
      involved: 5,
      resolved: 3,
      routed: 2,
      resolutionRate: 0.6,
    });
    expect(result.text).toContain("60%");
    expect(result.text).toContain("00000001");
    // Shown with Fin's labels, not raw API values.
    expect(result.text).toContain("Soft Resolution 2");
    expect(result.text).not.toContain("soft_resolution");
    expect(org.writes).toEqual([]);
  });

  it("flags Fin-owned cases with no Fin activity (assigned before the channel was live)", async () => {
    const org = fakeOrg({
      installed: true,
      observe: {
        finUserOwned: 2,
        involved: 1,
        byResolution: { soft_resolution: 1 },
        byOrigin: { Web: 1 },
        recent: [],
      },
    });
    const result = await runSalesforceSetup(org, { operation: "observe", targetOrg: "DevOrg" });
    expect(result.text).toContain("1 case(s) owned by the Fin user have no Fin activity");
    expect(result.text).toContain("channel is live");
  });

  it("explains an empty picture instead of reporting a 0% rate", async () => {
    const org = fakeOrg({
      installed: true,
      observe: { finUserOwned: 0, involved: 0, byResolution: {}, byOrigin: {}, recent: [] },
    });
    const result = await runSalesforceSetup(org, { operation: "observe", targetOrg: "DevOrg" });
    expect(result.details).toMatchObject({ involved: 0 });
    expect(result.details.resolutionRate).toBeUndefined();
    expect(result.text).toContain("No case has been worked by Fin yet");
  });

  it("refuses without the Fin package (no Fin fields to read)", async () => {
    const result = await runSalesforceSetup(fakeOrg(), {
      operation: "observe",
      targetOrg: "DevOrg",
    });
    expect(result).toMatchObject({ ok: false, details: { code: "package_missing" } });
  });
});

describe("go-live next step", () => {
  it("names handoff_queue_create once routing works and no Case queue exists", async () => {
    const org = fakeOrg({
      installed: true,
      accessPs: true,
      user: {
        serviceCloudUser: true,
        assigned: [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET],
      },
      auditFieldsEnabled: true,
      accessHasAudit: true,
      digitalExperiences: true,
      oauthConnected: true,
      integrationAssigned: [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET],
      goLive: {
        caseRouting: { activeFlows: ["Case_Assign_To_Fin"], casesOwnedByFin: 2 },
        caseQueues: [],
      },
    });
    const result = await runSalesforceSetup(org, { operation: "readiness", targetOrg: "DevOrg" });
    expect(result.text.split("\n").at(-1)).toBe(
      "Next: sf_fin action='salesforce' operation='handoff_queue_create' target_org='DevOrg'.",
    );
  });

  it("names routing before the handoff queue and Email-to-Case once Fin is connected", async () => {
    const org = fakeOrg({
      installed: true,
      accessPs: true,
      user: {
        serviceCloudUser: true,
        assigned: [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET],
      },
      auditFieldsEnabled: true,
      accessHasAudit: true,
      digitalExperiences: true,
      oauthConnected: true,
      integrationAssigned: [FIN_PACKAGE_PERMISSION_SET, FIN_ACCESS_PERMISSION_SET],
      goLive: {
        emailToCaseEnabled: false,
        caseRouting: { activeFlows: [], casesOwnedByFin: 0 },
        caseQueues: [],
      },
    });
    const result = await runSalesforceSetup(org, { operation: "readiness", targetOrg: "DevOrg" });
    const next = result.text.split("\n").at(-1) ?? "";
    expect(next).toContain("No active Case Flow assigns cases to the Fin user");
    expect(result.details).toMatchObject({ connected: true, goLiveReady: false });
  });
});
