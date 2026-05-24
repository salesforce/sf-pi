#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Deactivate sweep-owned Agentforce BotVersions by DeveloperName prefix.
 *
 * This is intentionally non-destructive: it only flips Active BotVersions to
 * Inactive. It does not delete BotDefinitions, BotVersions, Flows, Apex, or
 * AiAuthoringBundle metadata. Use it after example/lifecycle sweeps so test
 * agents stop serving without losing the evidence needed to debug failures.
 *
 * Usage:
 *   node scripts/agentscript-sweep-cleanup.mjs --org AgentforceSTDM --prefix ASV2_
 *   node scripts/agentscript-sweep-cleanup.mjs --org AgentforceSTDM --prefix ASV2_ --execute
 */

import { inspect } from "node:util";

function parseArgs(argv) {
  const out = { execute: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "--org" || arg === "-o") && argv[i + 1]) out.org = argv[++i];
    else if (arg.startsWith("--org=")) out.org = arg.slice("--org=".length);
    else if ((arg === "--prefix" || arg === "-p") && argv[i + 1]) out.prefix = argv[++i];
    else if (arg.startsWith("--prefix=")) out.prefix = arg.slice("--prefix=".length);
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return [
    "Usage: node scripts/agentscript-sweep-cleanup.mjs --org <alias> --prefix <DeveloperNamePrefix> [--execute]",
    "",
    "Dry-run is the default. Pass --execute to deactivate matching Active BotVersions.",
  ].join("\n");
}

function soqlEscape(value) {
  return String(value).replace(/'/g, "\\'");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.org) throw new Error("--org is required");
  if (!args.prefix) throw new Error("--prefix is required");
  if (args.prefix.length < 4) {
    throw new Error("--prefix must be at least 4 characters to avoid broad cleanup accidents");
  }

  const { Org } = await import("@salesforce/core");
  const org = await Org.create({ aliasOrUsername: args.org });
  const conn = org.getConnection();

  const query =
    "SELECT Id, DeveloperName, (SELECT Id, VersionNumber, Status FROM BotVersions ORDER BY VersionNumber DESC) " +
    `FROM BotDefinition WHERE DeveloperName LIKE '${soqlEscape(args.prefix)}%' ORDER BY DeveloperName`;
  const result = await conn.query(query);
  const matched = result.records ?? [];

  const candidates = [];
  for (const bot of matched) {
    const versions = bot.BotVersions?.records ?? [];
    for (const version of versions) {
      if (version.Status === "Active") {
        candidates.push({
          bot_id: bot.Id,
          agent_api_name: bot.DeveloperName,
          bot_version_id: version.Id,
          version_number: version.VersionNumber,
          status: version.Status,
        });
      }
    }
  }

  const deactivated = [];
  const failed = [];
  if (args.execute) {
    for (const candidate of candidates) {
      try {
        const body = await conn.request({
          method: "POST",
          url: `/connect/bot-versions/${candidate.bot_version_id}/activation`,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "Inactive" }),
        });
        if (body?.success === false) {
          failed.push({
            ...candidate,
            error: body.messages ?? "activation endpoint returned success=false",
          });
        } else {
          deactivated.push(candidate);
        }
      } catch (err) {
        failed.push({ ...candidate, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        org: args.org,
        prefix: args.prefix,
        dry_run: !args.execute,
        matched_agents: matched.length,
        active_candidates: candidates,
        deactivated,
        failed,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : inspect(err, { depth: 5 }));
  process.exit(1);
});
