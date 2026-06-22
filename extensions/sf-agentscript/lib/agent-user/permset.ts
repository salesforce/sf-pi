/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Permission Set read primitives for the agent user setup flow.
 *
 * - listPermissionSetAssignments  — every PS row for a user
 * - findPermissionSetByName        — resolve PS DeveloperName to its Id
 * - listClassAccessForUser         — capability lookup: which Apex classes
 *                                    can a user execute, via any PS they're
 *                                    assigned to. Used for the
 *                                    "is the custom PS wired up correctly"
 *                                    check; we look at access, not naming.
 *
 * No subprocess — `@salesforce/core` Connection only.
 *
 * Doc: skills/sf-ai-agentscript/references/agent-user-setup.md.
 */

import type { Connection } from "@salesforce/core";
import { boundedRestRequest } from "../bounded-salesforce-transport.ts";
import { safeQueryRecords } from "../preflight/soql.ts";

/** The PS that grants Service Agents permission to act in the org. */
export const SYSTEM_AGENT_PS_NAME = "AgentforceServiceAgentUser";

export interface PermissionSetAssignmentRow {
  AssignmentId: string;
  PermissionSetId: string;
  PermissionSetName: string;
  PermissionSetLabel?: string;
}

export interface ClassAccessRow {
  /** ApexClass.Name (the developer name). */
  apex_class: string;
  /** PS that grants this access — multiple are possible; we surface the first. */
  granted_via_permission_set: string;
}

/**
 * Every PS currently assigned to a user. Used for both diagnose
 * ("is the system PS assigned?") and provision (skip-if-already-assigned).
 */
export async function listPermissionSetAssignments(
  conn: Connection,
  userId: string,
): Promise<PermissionSetAssignmentRow[]> {
  // NOTE: do NOT add `ORDER BY PermissionSet.Name`. SOQL on
  // PermissionSetAssignment silently drops rows where the parent
  // PermissionSet has a NamespacePrefix (e.g. force) when ordered by a
  // parent field. Smoke-tested 2026-05-12 against an Agentforce-enabled
  // sandbox: ordering hid AgentforceServiceAgentUser entirely, producing
  // false-negative status/diagnose checks. Sort consumer-side if needed.
  const records =
    (await safeQueryRecords<{
      Id: string;
      PermissionSetId: string;
      PermissionSet: { Name: string; Label?: string } | null;
    }>(
      conn,
      "/query",
      `SELECT Id, PermissionSetId, PermissionSet.Name, PermissionSet.Label ` +
        `FROM PermissionSetAssignment WHERE AssigneeId='${escapeSoql(userId)}'`,
    )) ?? [];
  const rows: PermissionSetAssignmentRow[] = records.map((row) => ({
    AssignmentId: row.Id,
    PermissionSetId: row.PermissionSetId,
    PermissionSetName: row.PermissionSet?.Name ?? "",
    PermissionSetLabel: row.PermissionSet?.Label,
  }));
  rows.sort((a, b) => a.PermissionSetName.localeCompare(b.PermissionSetName));
  return rows;
}

/**
 * Resolve a PermissionSet DeveloperName to its Id. Returns undefined when
 * the PS doesn't exist (yet) — provision uses this to decide whether to
 * deploy the custom PS first.
 */
export async function findPermissionSetByName(
  conn: Connection,
  developerName: string,
): Promise<{ Id: string; Label?: string } | undefined> {
  const records =
    (await safeQueryRecords<{ Id: string; Label?: string }>(
      conn,
      "/query",
      `SELECT Id, Label FROM PermissionSet WHERE Name='${escapeSoql(developerName)}' LIMIT 1`,
    )) ?? [];
  const row = records[0];
  if (!row) return undefined;
  return { Id: row.Id, Label: row.Label };
}

/**
 * Capability check — for every Apex class the user can execute (via any
 * assigned PS), return the class name + the granting PS name.
 *
 * We deliberately do not filter on a specific PS DeveloperName ("does
 * AgentName_Access exist") because the doc warns auto-generated PS names
 * are unreliable and customers rename. Checking by capability gets the
 * right answer regardless of naming.
 *
 * Joins: PermissionSetAssignment → SetupEntityAccess (with
 * SetupEntityType='ApexClass') → ApexClass.
 */
export async function listClassAccessForUser(
  conn: Connection,
  userId: string,
): Promise<ClassAccessRow[]> {
  // SetupEntityAccess.SetupEntityId is a polymorphic FK; we filter by
  // SetupEntityType so the PS join only emits Apex-class rows.
  const psRows = await listPermissionSetAssignments(conn, userId);
  if (psRows.length === 0) return [];
  const psIds = psRows.map((p) => `'${escapeSoql(p.PermissionSetId)}'`).join(",");
  const psNameById = new Map(psRows.map((p) => [p.PermissionSetId, p.PermissionSetName]));

  const accessRecords =
    (await safeQueryRecords<{
      ParentId: string;
      SetupEntityId: string;
    }>(
      conn,
      "/query",
      `SELECT ParentId, SetupEntityId FROM SetupEntityAccess ` +
        `WHERE SetupEntityType='ApexClass' AND ParentId IN (${psIds})`,
    )) ?? [];
  if (accessRecords.length === 0) return [];

  // Resolve SetupEntityId → ApexClass.Name via a single ApexClass query.
  const classIds = Array.from(new Set(accessRecords.map((a) => a.SetupEntityId)));
  const classIdLiteral = classIds.map((id) => `'${escapeSoql(id)}'`).join(",");
  const classRecords =
    (await safeQueryRecords<{ Id: string; Name: string }>(
      conn,
      "/query",
      `SELECT Id, Name FROM ApexClass WHERE Id IN (${classIdLiteral})`,
    )) ?? [];
  const nameById = new Map(classRecords.map((c) => [c.Id, c.Name]));

  const out: ClassAccessRow[] = [];
  // De-duplicate per (apex_class) pair, preferring the first PS we encountered.
  const seen = new Set<string>();
  for (const a of accessRecords) {
    const className = nameById.get(a.SetupEntityId);
    if (!className) continue;
    if (seen.has(className)) continue;
    seen.add(className);
    out.push({
      apex_class: className,
      granted_via_permission_set: psNameById.get(a.ParentId) ?? "<unknown>",
    });
  }
  return out;
}

function escapeSoql(s: string): string {
  // Escape `\` first, then `'`, so a literal backslash in `s` can't pair
  // with the inserted `\` from the quote-escape pass and re-enable the
  // closing quote of the SOQL string literal.
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// -------------------------------------------------------------------------------------------------
// Write primitives (PR3 — provision_agent_user)
// -------------------------------------------------------------------------------------------------

export interface AssignPermissionSetInput {
  user_id: string;
  /** Either the PS Id or DeveloperName — we resolve name → id when needed. */
  permission_set_id?: string;
  permission_set_name?: string;
}

export interface AssignPermissionSetResult {
  ok: boolean;
  /** Set when an assignment was created. */
  assignment_id?: string;
  /** True when the assignment already existed; we don't create a duplicate. */
  already_assigned?: boolean;
  error?: string;
}

export interface AssignPermissionSetOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Idempotently assign a Permission Set to a user. If the assignment
 * already exists, returns ok=true with already_assigned=true and no
 * insert. The verb's caller relies on this to make repeated provision
 * runs safe.
 */
export async function assignPermissionSet(
  conn: Connection,
  input: AssignPermissionSetInput,
  options: AssignPermissionSetOptions = {},
): Promise<AssignPermissionSetResult> {
  let psId = input.permission_set_id;
  const psName = input.permission_set_name;
  if (!psId) {
    if (!psName) {
      return { ok: false, error: "need permission_set_id or permission_set_name" };
    }
    const found = await findPermissionSetByName(conn, psName);
    if (!found) {
      return {
        ok: false,
        error: `Permission Set '${psName}' not found in this org. Deploy it first or pass a different name.`,
      };
    }
    psId = found.Id;
  }

  // Idempotency check.
  const existing =
    (await safeQueryRecords<{ Id: string }>(
      conn,
      "/query",
      `SELECT Id FROM PermissionSetAssignment ` +
        `WHERE AssigneeId='${escapeSoql(input.user_id)}' ` +
        `AND PermissionSetId='${escapeSoql(psId)}' LIMIT 1`,
    )) ?? [];
  if (existing.length > 0) {
    return {
      ok: true,
      assignment_id: existing[0].Id,
      already_assigned: true,
    };
  }

  const result = await boundedRestRequest<{
    success?: boolean;
    id?: string;
    errors?: Array<{ message?: string }>;
  }>(conn, "/sobjects/PermissionSetAssignment", "POST", {
    body: {
      AssigneeId: input.user_id,
      PermissionSetId: psId,
    },
    signal: options.signal,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  if (result.ok === false) {
    return { ok: false, error: result.detail };
  }
  if (!result.body.success || !result.body.id) {
    const detail = result.body.errors?.[0]?.message ?? "unknown error";
    return { ok: false, error: detail };
  }
  return { ok: true, assignment_id: result.body.id, already_assigned: false };
}
