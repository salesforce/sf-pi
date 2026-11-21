/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fin's Salesforce error codes → what fixes them.
 *
 * Fin lists integration failures under Settings → Error logs (verified admin
 * page `error-logs`). Each entry carries Salesforce's error code and the
 * object it was working on. This table follows Fin's public troubleshooting
 * guide for Fin for Salesforce and maps each code to the SF Fin operation
 * that fixes it, or to plain guidance when the fix is outside SF Fin (a Flow,
 * a validation rule, a retry). Unknown codes are reported as unknown, never
 * guessed.
 */
import type { SalesforceOperation } from "./salesforce/setup.ts";

export interface FinSalesforceError {
  code: string;
  /** Salesforce object the error is about; undefined matches any object. */
  object?: string;
  /** SF Fin salesforce operation that fixes it, when one does. */
  fix?: Exclude<SalesforceOperation, "readiness" | "observe">;
  advice: string;
}

export const FIN_SALESFORCE_ERRORS: readonly FinSalesforceError[] = [
  {
    code: "OAUTH_EC_APP_NOT_FOUND",
    fix: "package_install",
    advice:
      "The Fin for Salesforce package is missing or out of date in this org. Install the latest version from Fin's Connect page (package_install), then connect again.",
  },
  {
    code: "INVALID_FIELD_FOR_INSERT_UPDATE",
    object: "Case",
    fix: "audit_fields_enable",
    advice:
      "Fin could not set CreatedById/LastModifiedById. Turn on Set Audit Fields upon Record Creation (audit_fields_enable), then re-run permissions_apply so the access permission set grants it. For any other field, check Fin's access to it.",
  },
  {
    code: "INVALID_FIELD_FOR_INSERT_UPDATE",
    object: "EmailMessage",
    fix: "audit_fields_enable",
    advice:
      "Fin could not set audit fields on the case email. Turn on Set Audit Fields upon Record Creation (audit_fields_enable), then re-run permissions_apply.",
  },
  {
    code: "INVALID_FIELD_FOR_INSERT_UPDATE",
    fix: "permissions_apply",
    advice:
      "Fin cannot set a field on this object. Re-run permissions_apply so the connected user has the access Fin documents, then check field-level security for the field named in the error.",
  },
  {
    code: "FIELD_CUSTOM_VALIDATION_EXCEPTION",
    advice:
      "A validation rule rejected Fin's change. Make the rule allow the Fin user (for example by excluding it), or give Fin the values the rule needs; the rule is outside SF Fin.",
  },
  {
    code: "CANNOT_EXECUTE_FLOW_TRIGGER",
    advice:
      "A Flow or process failed when Fin created or updated the Case. Find the failing Flow with sf_flow (lifecycle.status, then its fault path) and fix it there.",
  },
  {
    code: "INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST",
    advice:
      "Fin wrote a value a restricted picklist does not allow. Add the value to the picklist, or change the value Fin sets (case fields in Fin's Salesforce cases settings).",
  },
  {
    code: "UNABLE_TO_LOCK_ROW",
    advice:
      "Another process was updating the Case at the same time. Usually transient: Fin retries on its next update; if it repeats, look for automation that updates the same case right after Fin.",
  },
  {
    code: "INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY",
    object: "EmailMessage",
    fix: "permissions_apply",
    advice:
      "The connected user cannot reach the Case or User the email references (and, with Enhanced Email, the Task Salesforce creates). Re-run permissions_apply, then check sharing on that case.",
  },
  {
    code: "INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY",
    fix: "permissions_apply",
    advice:
      "The connected user cannot reach a referenced record. Re-run permissions_apply, then check sharing on the record in the error.",
  },
  {
    code: "UNKNOWN_EXCEPTION",
    object: "FeedItem",
    fix: "permissions_apply",
    advice:
      "Fin could not post rich text to the case feed. Re-run permissions_apply so the access permission set grants the feed permissions Fin documents.",
  },
  {
    code: "CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY",
    fix: "permissions_apply",
    advice:
      "Fin could not create the Case. Re-run permissions_apply so the connected user can create Cases; if it persists, a trigger or Flow on Case is failing (check it with sf_flow).",
  },
  {
    code: "REQUIRED_FIELD_MISSING",
    advice:
      "A required Case field had no value when Fin created the case. Map a value for it in Fin's case creation settings, or give the field a default in Salesforce.",
  },
  {
    code: "INVALID_EMAIL_ADDRESS",
    advice:
      "The customer email Fin received is not valid, so Salesforce refused the Case. Nothing to change in the org; check the email the customer gave.",
  },
  {
    code: "INVALID_TYPE",
    object: "Emails",
    fix: "enhanced_email_enable",
    advice:
      "Fin cannot read the case's emails, usually because Enhanced Email is off. Turn it on (enhanced_email_enable).",
  },
  {
    code: "INVALID_FIELD",
    object: "CaseFeed",
    fix: "digital_experiences_enable",
    advice:
      "Fin cannot read CaseFeed.Visibility, which exists only with Digital Experiences on. Turn it on (digital_experiences_enable; one-way), then re-run permissions_apply.",
  },
  {
    code: "INVALID_FIELD",
    fix: "permissions_apply",
    advice:
      "Fin cannot query a field it needs. Re-run permissions_apply, then check field-level security for the field named in the error.",
  },
];

export interface FinErrorDiagnosis {
  code: string;
  object?: string;
  known: boolean;
  fix?: FinSalesforceError["fix"];
  advice: string;
}

/** Most specific match first: code and object, then code alone. */
export function diagnoseFinError(input: { code: string; object?: string }): FinErrorDiagnosis {
  const code = input.code.trim().toUpperCase();
  const object = input.object?.trim();
  const exact = FIN_SALESFORCE_ERRORS.find((e) => e.code === code && e.object === object);
  const any = FIN_SALESFORCE_ERRORS.find((e) => e.code === code && e.object === undefined);
  const hit = exact ?? any;
  if (!hit) {
    return {
      code,
      object,
      known: false,
      fix: undefined,
      advice:
        "Not in Fin's documented Salesforce errors. Run sf_fin action='salesforce' operation='readiness' for the org, and open the entry in Fin (Copy all details) for the full system error.",
    };
  }
  return { code, object, known: true, fix: hit.fix, advice: hit.advice };
}

// ─── Fin's Error logs page (observed live) ─────────────────────────────────
//
// The list shows one row per error: a date cell, the organization, and a
// generic message. Salesforce's error code and object appear only in each
// row's "Error details" dialog, as label/value cell pairs.

export interface ErrorLogEntry {
  when?: string;
  org?: string;
  message?: string;
  code?: string;
  object?: string;
  feature?: string;
  method?: string;
  status?: string;
}

export interface ErrorLogBrowser {
  /** Full (not interactive-only) masked snapshot. */
  snapshot(): Promise<string>;
  click(ref: string): Promise<void>;
  /** Close the details dialog. */
  close(): Promise<void>;
}

const CELL = /- cell "((?:[^"\\]|\\.)*)" \[ref=(e\d+)\]/gu;
const DATE_CELL = /^\d{1,2}:\d{2} – /u;

function cellsOf(snapshot: string): Array<{ text: string; ref: string }> {
  return [...snapshot.matchAll(CELL)].flatMap((m) =>
    m[1] !== undefined && m[2] ? [{ text: m[1].replace(/\\(.)/gu, "$1"), ref: m[2] }] : [],
  );
}

/** List rows: each date cell starts a row of date, organization, message. */
export function errorLogRows(
  snapshot: string,
): Array<{ when: string; org?: string; message?: string; ref: string }> {
  const list = snapshot.split('dialog "Error details"')[0] ?? snapshot;
  const cells = cellsOf(list);
  const rows: Array<{ when: string; org?: string; message?: string; ref: string }> = [];
  cells.forEach((cell, i) => {
    if (!DATE_CELL.test(cell.text)) return;
    const message = cells[i + 2];
    rows.push({
      when: cell.text,
      org: cells[i + 1]?.text,
      message: message?.text,
      ref: message?.ref ?? cell.ref,
    });
  });
  return rows;
}

/** Label/value pairs from an open "Error details" dialog (no System error text). */
export function errorDetailFields(snapshot: string): Partial<ErrorLogEntry> {
  const at = snapshot.indexOf('dialog "Error details"');
  if (at < 0) return {};
  const cells = cellsOf(snapshot.slice(at));
  const value = (label: string) => {
    const i = cells.findIndex((c) => c.text === label);
    return i >= 0 ? cells[i + 1]?.text : undefined;
  };
  return {
    code: value("Error code"),
    object: value("Object type"),
    feature: value("Product feature"),
    method: value("Request method"),
    status: value("Status code"),
  };
}

/** Open each row's details (up to `max`) and collect its code and object. */
export async function readErrorLogEntries(
  browser: ErrorLogBrowser,
  options: { max: number },
): Promise<ErrorLogEntry[]> {
  const rows = errorLogRows(await browser.snapshot()).slice(0, options.max);
  const entries: ErrorLogEntry[] = [];
  for (const row of rows) {
    let detail: Partial<ErrorLogEntry>;
    try {
      await browser.click(row.ref);
      detail = errorDetailFields(await browser.snapshot());
    } catch {
      detail = {};
    } finally {
      await browser.close().catch(() => undefined);
    }
    entries.push({ when: row.when, org: row.org, message: row.message, ...detail });
  }
  return entries;
}
