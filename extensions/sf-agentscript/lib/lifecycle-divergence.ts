/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Detect whether the local .agent file is newer than the most recently
 * created BotVersion for the same agent. Used as a soft preflight on
 * `agentscript_lifecycle action='activate'` to catch the iterate-then-
 * deploy footgun: editing the .agent (e.g. adding agent_type or
 * default_agent_user) and shipping via `sf project deploy` does NOT
 * propagate the change into the BotDefinition / BotVersion records.
 * Only `agentscript_lifecycle action='publish'` does. The activation
 * API will then succeed but with stale config in the bot.
 *
 * This helper reads two things and returns a structured result:
 *   - the .agent file's mtime
 *   - the latest BotVersion's CreatedDate (via SOQL)
 *
 * No mutations. Best-effort: file copies / git restores reset mtime,
 * so we describe the result in terms of "the file is newer than the
 * latest version" rather than "the file was edited after publish".
 */

import { stat } from "node:fs/promises";
import type { Connection } from "@salesforce/core";

export interface DivergenceCheckResult {
  /** True when we successfully read both timestamps. */
  ok: boolean;
  /** True when the .agent file's mtime is newer than the BotVersion. */
  diverged?: boolean;
  agent_file_mtime_iso?: string;
  latest_version_created_iso?: string;
  /** Bot version number used as the comparison baseline. */
  latest_version_number?: number;
  /** Human-readable summary; populated for both happy-path and failure. */
  detail: string;
}

export async function checkBundleVsBotDivergence(
  conn: Connection,
  agentApiName: string,
  agentFile: string,
): Promise<DivergenceCheckResult> {
  let mtimeMs: number;
  try {
    const s = await stat(agentFile);
    mtimeMs = s.mtimeMs;
  } catch (err) {
    return {
      ok: false,
      detail:
        `Cannot stat .agent file '${agentFile}': ${err instanceof Error ? err.message : String(err)}. ` +
        `Skipping divergence check.`,
    };
  }

  let row: { CreatedDate: string; VersionNumber: number } | undefined;
  try {
    // Resolve bot id then pick the latest BotVersion. We don't filter
    // on Status; Active vs Inactive both count for "what's currently
    // in the org". The doc-correct field is BotVersion.CreatedDate.
    const botResult = await conn.query<{ Id: string }>(
      `SELECT Id FROM BotDefinition WHERE DeveloperName='${escapeSoql(agentApiName)}' LIMIT 1`,
    );
    const botId = botResult.records[0]?.Id;
    if (!botId) {
      return {
        ok: false,
        detail: `No BotDefinition for '${agentApiName}' in this org — skipping divergence check.`,
      };
    }
    const versions = await conn.query<{
      VersionNumber: number;
      CreatedDate: string;
    }>(
      `SELECT VersionNumber, CreatedDate FROM BotVersion ` +
        `WHERE BotDefinitionId='${escapeSoql(botId)}' ` +
        `ORDER BY VersionNumber DESC LIMIT 1`,
    );
    row = versions.records[0];
  } catch (err) {
    return {
      ok: false,
      detail: `Divergence-check SOQL failed: ${err instanceof Error ? err.message : String(err)}.`,
    };
  }
  if (!row) {
    return {
      ok: false,
      detail: `No BotVersion for '${agentApiName}' — nothing to diverge from.`,
    };
  }

  const versionMs = Date.parse(row.CreatedDate);
  if (Number.isNaN(versionMs)) {
    return {
      ok: false,
      detail: `Could not parse CreatedDate '${row.CreatedDate}' for v${row.VersionNumber}.`,
    };
  }

  const diverged = mtimeMs > versionMs;
  const mtimeIso = new Date(mtimeMs).toISOString();
  return {
    ok: true,
    diverged,
    agent_file_mtime_iso: mtimeIso,
    latest_version_created_iso: row.CreatedDate,
    latest_version_number: row.VersionNumber,
    detail: diverged
      ? `Local .agent file is newer than v${row.VersionNumber} ` +
        `(file mtime ${mtimeIso}, version created ${row.CreatedDate}). ` +
        `If you've edited config.agent_type / default_agent_user since the ` +
        `last publish, re-publish via agentscript_lifecycle action='publish' ` +
        `— 'sf project deploy' alone does NOT propagate config-block changes ` +
        `to the BotDefinition.`
      : `Local .agent file is in sync with the latest BotVersion ` + `(v${row.VersionNumber}).`,
  };
}

function escapeSoql(s: string): string {
  return s.replace(/'/g, "\\'");
}
