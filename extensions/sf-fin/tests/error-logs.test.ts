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

  it("opens each row's details and diagnoses the fix SF Fin owns, grouped by code", async () => {
    const LIST = [
      '- heading "Settings Error logs" [level=1, ref=e1]',
      '- button "Webhook" [ref=e2]',
      '- cell "10:00 – January 2, 2026" [ref=e10]',
      '- cell "example-org" [ref=e11]',
      '- cell "Invalid request." [ref=e12]',
      '- cell "09:59 – January 2, 2026" [ref=e13]',
      '- cell "example-org" [ref=e14]',
      '- cell "Invalid request." [ref=e15]',
      '- cell "09:58 – January 2, 2026" [ref=e16]',
      '- cell "example-org" [ref=e17]',
      '- cell "Invalid request." [ref=e18]',
    ].join("\n");
    const details: Record<string, [string, string]> = {
      e12: ["INVALID_FIELD", "CaseFeed"],
      e15: ["INVALID_FIELD", "CaseFeed"],
      e18: ["INVALID_TYPE", "Emails"],
    };
    let open: string | undefined;
    const run: AdminRunner = async (args) => {
      if (args[0] === "open") return { stdout: "", stderr: "", code: 0 };
      if (args[0] === "get")
        return {
          stdout: `https://app.intercom.com/a/apps/${APP}/settings/standalone/error-logs\n`,
          stderr: "",
          code: 0,
        };
      if (args[0] === "click") {
        open = args[1]?.replace("@", "");
        return { stdout: "", stderr: "", code: 0 };
      }
      if (args[0] === "press") {
        open = undefined;
        return { stdout: "", stderr: "", code: 0 };
      }
      if (args[0] === "snapshot") {
        const d = open ? details[open] : undefined;
        const out = d
          ? `${LIST}\n- dialog "Error details"\n- cell "Error code" [ref=e90]\n- cell "${d[0]}" [ref=e91]\n- cell "Object type" [ref=e92]\n- cell "${d[1]}" [ref=e93]`
          : LIST;
        return { stdout: out, stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };
    const result = await runAdmin(
      { operation: "read", page: "error-logs" },
      BOUND,
      run,
      async () => undefined,
      SIGNED_IN,
    );
    expect(result.ok).toBe(true);
    expect(result.details.errorCount).toBe(3);
    const diagnoses = result.details.diagnoses as Array<{
      code: string;
      fix?: string;
      count: number;
    }>;
    expect(diagnoses.map((d) => [d.code, d.fix, d.count])).toEqual([
      ["INVALID_FIELD", "digital_experiences_enable", 2],
      ["INVALID_TYPE", "enhanced_email_enable", 1],
    ]);
    expect(result.text).toContain("×2");
    expect(result.text).toContain("digital_experiences_enable");
  });
});

describe("Fin's real Error logs layout (observed live)", () => {
  // List rows carry only a date, the org, and a generic message; the code and
  // object appear in each row's "Error details" dialog as label/value cells.
  const LIST = [
    '- heading "Settings Error logs" [level=1, ref=e1]',
    '- button "Webhook" [expanded=false, ref=e2]',
    '- textbox "Conversation ID" [ref=e3]',
    '- columnheader "Date and time (EST)" [ref=e4]',
    '- columnheader "Organization" [ref=e5]',
    '- columnheader "Error" [ref=e6]',
    '- cell "10:00 – January 2, 2026" [ref=e10]',
    '- cell "example-org" [ref=e11]',
    '- cell "Invalid request. There was a problem with the payload or parameters." [ref=e12]',
    '- cell "09:59 – January 2, 2026" [ref=e13]',
    '- cell "example-org" [ref=e14]',
    '- cell "Invalid request. There was a problem with the payload or parameters." [ref=e15]',
  ].join("\n");
  const detail = (code: string, object: string) =>
    [
      LIST,
      '- dialog "Error details"',
      '- heading "Error details" [level=2, ref=e20]',
      '- button "Close" [ref=e21]',
      '- cell "Organization" [ref=e22]',
      '- cell "example-org" [ref=e23]',
      '- cell "Error code" [ref=e24]',
      `- cell "${code}" [ref=e25]`,
      '- cell "System error" [ref=e26]',
      '- cell "A validation rule rejected the update." [ref=e27]',
      '- cell "Request method" [ref=e28]',
      '- cell "PATCH" [ref=e29]',
      '- cell "Status code" [ref=e30]',
      '- cell "400" [ref=e31]',
      '- cell "Product feature" [ref=e32]',
      '- cell "Salesforce Cases" [ref=e33]',
      '- cell "Object type" [ref=e34]',
      `- cell "${object}" [ref=e35]`,
    ].join("\n");

  it("opens each row's details and diagnoses the code and object from them", async () => {
    const { readErrorLogEntries } = await import("../lib/error-logs.ts");
    const opened: string[] = [];
    let current = LIST;
    const codes = ["FIELD_CUSTOM_VALIDATION_EXCEPTION", "INVALID_TYPE"];
    const objects = ["Case", "Emails"];
    const browser = {
      snapshot: async () => current,
      click: async (ref: string) => {
        opened.push(ref);
        const i = opened.length - 1;
        current = detail(codes[i]!, objects[i]!);
      },
      close: async () => {
        current = LIST;
      },
    };
    const entries = await readErrorLogEntries(browser, { max: 5 });
    expect(opened).toEqual(["e12", "e15"]);
    expect(entries).toEqual([
      expect.objectContaining({
        code: "FIELD_CUSTOM_VALIDATION_EXCEPTION",
        object: "Case",
        when: "10:00 – January 2, 2026",
        feature: "Salesforce Cases",
        status: "400",
      }),
      expect.objectContaining({ code: "INVALID_TYPE", object: "Emails" }),
    ]);
    // System error text can carry record data; it is never part of an entry.
    expect(JSON.stringify(entries)).not.toContain("validation rule rejected");
  });

  it("counts rows even when a details dialog cannot be read", async () => {
    const { readErrorLogEntries } = await import("../lib/error-logs.ts");
    const browser = {
      snapshot: async () => LIST,
      click: async () => undefined,
      close: async () => undefined,
    };
    const entries = await readErrorLogEntries(browser, { max: 5 });
    expect(entries).toHaveLength(2);
    expect(entries[0]?.code).toBeUndefined();
    expect(entries[0]?.message).toContain("Invalid request");
  });

  it("stops at max rows", async () => {
    const { readErrorLogEntries } = await import("../lib/error-logs.ts");
    const clicks: string[] = [];
    const browser = {
      snapshot: async () => LIST,
      click: async (ref: string) => void clicks.push(ref),
      close: async () => undefined,
    };
    await readErrorLogEntries(browser, { max: 1 });
    expect(clicks).toEqual(["e12"]);
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
