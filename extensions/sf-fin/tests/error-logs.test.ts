/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior Proofs for reading Fin's Error logs and mapping Salesforce errors to fixes (synthetic). */
import { describe, expect, it } from "vitest";
import { finAdminLocation, finAdminPageUrl } from "../../../lib/common/fin-admin-surface.ts";
import { runAdmin, type AdminRunner, type AdminSignin } from "../lib/admin.ts";
import { diagnoseFinError, FIN_SALESFORCE_ERRORS } from "../lib/error-logs.ts";
import type { WorkspaceProfile } from "../lib/workspaces.ts";

const APP = "abc123";
const BOUND: WorkspaceProfile = { name: "default", kind: "test", appId: APP, region: "us" };
const SIGNED_IN: AdminSignin = {
  loginId: "sf-fin-browser",
  restore: async () => "restored",
  finish: async () => undefined,
};

/**
 * Like agent-browser: `snapshot -i` returns interactive elements only, so
 * static text (Fin's "No API errors" empty state) appears only without -i.
 */
function runner(snapshot: string): AdminRunner {
  let current = "";
  return async (args) => {
    if (args[0] === "open") {
      current = args[1]!;
      return { stdout: "", stderr: "", code: 0 };
    }
    if (args[0] === "get") return { stdout: `${current}\n`, stderr: "", code: 0 };
    if (args[0] === "snapshot") {
      const interactiveOnly = args.includes("-i");
      const out = interactiveOnly
        ? snapshot
            .split("\n")
            .filter((line) => !/StaticText|heading/u.test(line) || /\[level=1/u.test(line))
            .join("\n")
        : snapshot;
      return { stdout: out, stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "", code: 0 };
  };
}

describe("error-logs admin page", () => {
  it("is a verified, non-secret page at Fin's observed path", () => {
    expect(finAdminPageUrl("us", APP, "error-logs")).toBe(
      `https://app.intercom.com/a/apps/${APP}/settings/standalone/error-logs`,
    );
    expect(
      finAdminLocation(`https://app.intercom.com/a/apps/${APP}/settings/standalone/error-logs`)
        ?.page,
    ).toBe("error-logs");
  });

  it("reports an empty log plainly (Fin's live empty state)", async () => {
    const result = await runAdmin(
      { operation: "read", page: "error-logs" },
      BOUND,
      runner(
        [
          '- heading "Settings Error logs" [level=1, ref=e1]',
          '- button "Webhook" [expanded=false, ref=e2]',
          '- textbox "Conversation ID" [ref=e3]',
          '- StaticText "No API errors"',
        ].join("\n"),
      ),
      async () => undefined,
      SIGNED_IN,
    );
    expect(result.ok).toBe(true);
    expect(result.details).toMatchObject({ page: "error-logs", errorCount: 0 });
    expect(result.text).toContain("No API errors");
  });

  it("diagnoses each listed Salesforce error with the fix SF Fin owns", async () => {
    const result = await runAdmin(
      { operation: "read", page: "error-logs" },
      BOUND,
      runner(
        [
          '- heading "Settings Error logs" [level=1, ref=e1]',
          '- button "Webhook" [ref=e2]',
          '- cell "INVALID_FIELD" [ref=e3]',
          '- cell "CaseFeed" [ref=e4]',
          '- cell "INVALID_TYPE" [ref=e5]',
          '- cell "Emails" [ref=e6]',
          '- cell "UNABLE_TO_LOCK_ROW" [ref=e7]',
          '- cell "Case" [ref=e8]',
        ].join("\n"),
      ),
      async () => undefined,
      SIGNED_IN,
    );
    expect(result.ok).toBe(true);
    const diagnoses = result.details.diagnoses as Array<{ code: string; fix?: string }>;
    expect(diagnoses.map((d) => [d.code, d.fix])).toEqual([
      ["INVALID_FIELD", "digital_experiences_enable"],
      ["INVALID_TYPE", "enhanced_email_enable"],
      ["UNABLE_TO_LOCK_ROW", undefined],
    ]);
    expect(result.text).toContain("digital_experiences_enable");
    expect(result.text).toContain("Fin retries");
  });
});

describe("diagnoseFinError", () => {
  it("maps Fin's documented Salesforce error codes by object to an SF Fin fix or guidance", () => {
    const cases: Array<[string, string | undefined, string | undefined]> = [
      ["OAUTH_EC_APP_NOT_FOUND", undefined, "package_install"],
      ["INVALID_FIELD_FOR_INSERT_UPDATE", "Case", "audit_fields_enable"],
      ["INVALID_FIELD_FOR_INSERT_UPDATE", "EmailMessage", "audit_fields_enable"],
      ["INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY", "EmailMessage", "permissions_apply"],
      ["CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY", "Case", "permissions_apply"],
      ["UNKNOWN_EXCEPTION", "FeedItem", "permissions_apply"],
      ["INVALID_TYPE", "Emails", "enhanced_email_enable"],
      ["INVALID_FIELD", "CaseFeed", "digital_experiences_enable"],
      ["INVALID_FIELD", "Case", "permissions_apply"],
      ["CANNOT_EXECUTE_FLOW_TRIGGER", "Case", undefined],
      ["FIELD_CUSTOM_VALIDATION_EXCEPTION", "Case", undefined],
    ];
    for (const [code, object, fix] of cases) {
      const d = diagnoseFinError({ code, object });
      expect(d.known, `${code}/${object}`).toBe(true);
      expect(d.fix, `${code}/${object}`).toBe(fix);
      expect(d.advice.length, `${code}/${object}`).toBeGreaterThan(20);
    }
    // Flow errors point at sf_flow, not at a setting.
    expect(
      diagnoseFinError({ code: "CANNOT_EXECUTE_FLOW_TRIGGER", object: "Case" }).advice,
    ).toContain("sf_flow");
  });

  it("never guesses: an unknown code is reported as unknown with the next diagnostic step", () => {
    const d = diagnoseFinError({ code: "SOMETHING_NEW", object: "Case" });
    expect(d).toMatchObject({ known: false, fix: undefined });
    expect(d.advice).toContain("readiness");
  });

  it("every documented code is covered by the table", () => {
    const codes = new Set(FIN_SALESFORCE_ERRORS.map((e) => e.code));
    for (const code of [
      "OAUTH_EC_APP_NOT_FOUND",
      "INVALID_FIELD_FOR_INSERT_UPDATE",
      "FIELD_CUSTOM_VALIDATION_EXCEPTION",
      "CANNOT_EXECUTE_FLOW_TRIGGER",
      "INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST",
      "UNABLE_TO_LOCK_ROW",
      "INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY",
      "UNKNOWN_EXCEPTION",
      "CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY",
      "REQUIRED_FIELD_MISSING",
      "INVALID_EMAIL_ADDRESS",
      "INVALID_TYPE",
      "INVALID_FIELD",
    ]) {
      expect(codes.has(code), code).toBe(true);
    }
  });
});
