/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Einstein Agent User read primitives.
 *
 * "Einstein Agent User" is identified by `Profile.Name = 'Einstein Agent User'`.
 * Older orgs may assign the agent role via a different profile; the doc
 * recognizes this and recommends checking by profile first, then falling
 * back to a username-pattern lookup.
 *
 * No subprocess — every call goes through `@salesforce/core` Connection.
 *
 * Doc: skills/sf-ai-agentscript/references/agent-user-setup.md.
 */

import type { Connection } from "@salesforce/core";
import { safeQueryRecords } from "../preflight/soql.ts";

export interface AgentUserRow {
  Id: string;
  Username: string;
  IsActive: boolean;
  ProfileName?: string;
}

/**
 * List all active users whose profile is "Einstein Agent User". Used by
 * both diagnose (is there at least one?) and provision (skip create-user
 * when one exists).
 */
export async function findEinsteinAgentUsers(conn: Connection): Promise<AgentUserRow[]> {
  const records =
    (await safeQueryRecords<{
      Id: string;
      Username: string;
      IsActive: boolean;
      Profile: { Name: string } | null;
    }>(
      conn,
      "/query",
      `SELECT Id, Username, IsActive, Profile.Name FROM User ` +
        `WHERE Profile.Name='Einstein Agent User' AND IsActive=true ` +
        `ORDER BY Username`,
    )) ?? [];
  return records.map((row) => ({
    Id: row.Id,
    Username: row.Username,
    IsActive: row.IsActive,
    ProfileName: row.Profile?.Name,
  }));
}

/**
 * Look up a single User by username. Returns undefined when not found.
 * Used to verify that a `default_agent_user` from a .agent file actually
 * resolves in the target org.
 */
export async function findUserByUsername(
  conn: Connection,
  username: string,
): Promise<AgentUserRow | undefined> {
  const records =
    (await safeQueryRecords<{
      Id: string;
      Username: string;
      IsActive: boolean;
      Profile: { Name: string } | null;
    }>(
      conn,
      "/query",
      `SELECT Id, Username, IsActive, Profile.Name FROM User ` +
        `WHERE Username='${escapeSoql(username)}' LIMIT 1`,
    )) ?? [];
  const row = records[0];
  if (!row) return undefined;
  return {
    Id: row.Id,
    Username: row.Username,
    IsActive: row.IsActive,
    ProfileName: row.Profile?.Name,
  };
}

/**
 * Find the Profile Id for "Einstein Agent User". Required input to
 * provisioning a new agent user. Returns undefined when the profile
 * doesn't exist in the target org (rare; older orgs).
 */
export async function getEinsteinAgentUserProfileId(conn: Connection): Promise<string | undefined> {
  const records =
    (await safeQueryRecords<{ Id: string }>(
      conn,
      "/query",
      `SELECT Id FROM Profile WHERE Name='Einstein Agent User' LIMIT 1`,
    )) ?? [];
  return records[0]?.Id;
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

export interface CreateAgentUserInput {
  /** Username — typically `{agent}_agent@{orgId}.ext`. Verbatim, no expansion. */
  username: string;
  /** ProfileId — must point at the Einstein Agent User profile. */
  profile_id: string;
  /** Required surface fields with safe defaults baked into the implementation. */
  email?: string;
  alias?: string;
  last_name?: string;
  time_zone?: string;
  locale?: string;
  language?: string;
  email_encoding?: string;
}

export interface CreateAgentUserResult {
  ok: boolean;
  user_id?: string;
  error?: string;
}

/**
 * Insert a new User row tagged with the Einstein Agent User profile.
 *
 * One REST call. The doc's split between scratch (`sf org create user
 * --definition-file`) vs sandbox/prod (`sf data create record User`) is an
 * sf CLI artifact — platform-side, both end up doing this exact insert,
 * so a single Connection-based path covers every org type.
 */
export async function createAgentUser(
  conn: Connection,
  input: CreateAgentUserInput,
): Promise<CreateAgentUserResult> {
  // Defaults come from the agent-user-setup doc's reference user definition.
  const last = input.last_name ?? "Agent";
  const alias = (input.alias ?? deriveAlias(input.username)).slice(0, 8);
  const email = input.email ?? "placeholder@example.com";
  const body: Record<string, unknown> = {
    Username: input.username,
    LastName: last,
    Email: email,
    Alias: alias,
    ProfileId: input.profile_id,
    TimeZoneSidKey: input.time_zone ?? "America/Los_Angeles",
    LocaleSidKey: input.locale ?? "en_US",
    EmailEncodingKey: input.email_encoding ?? "UTF-8",
    LanguageLocaleKey: input.language ?? "en_US",
  };
  try {
    const result = (await conn.sobject("User").create(body)) as {
      success?: boolean;
      id?: string;
      errors?: Array<{ message?: string }>;
    };
    if (!result.success || !result.id) {
      const detail = result.errors?.[0]?.message ?? "unknown error";
      return { ok: false, error: detail };
    }
    return { ok: true, user_id: result.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Derive an 8-character alias from the username's local part. */
function deriveAlias(username: string): string {
  const local = username.split("@")[0] ?? username;
  const sanitized = local.replace(/[^A-Za-z0-9]/g, "");
  return sanitized.length > 0 ? sanitized : "agnt";
}
