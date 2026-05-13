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
  const r = await conn.query<{
    Id: string;
    Username: string;
    IsActive: boolean;
    Profile: { Name: string } | null;
  }>(
    `SELECT Id, Username, IsActive, Profile.Name FROM User ` +
      `WHERE Profile.Name='Einstein Agent User' AND IsActive=true ` +
      `ORDER BY Username`,
  );
  return r.records.map((row) => ({
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
  const r = await conn.query<{
    Id: string;
    Username: string;
    IsActive: boolean;
    Profile: { Name: string } | null;
  }>(
    `SELECT Id, Username, IsActive, Profile.Name FROM User ` +
      `WHERE Username='${escapeSoql(username)}' LIMIT 1`,
  );
  const row = r.records[0];
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
  const r = await conn.query<{ Id: string }>(
    `SELECT Id FROM Profile WHERE Name='Einstein Agent User' LIMIT 1`,
  );
  return r.records[0]?.Id;
}

function escapeSoql(s: string): string {
  return s.replace(/'/g, "\\'");
}
