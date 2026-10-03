#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/** Fail on production high/critical advisories except exact, expiring no-fix exceptions. */

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const TEMPORARY_NO_FIX_ADVISORIES = [
  {
    id: "GHSA-vfj7-8cjw-p6xm",
    packageName: "braces",
    expiresOn: "2026-11-02",
    reason:
      "No patched npm release exists; transitive through fast-glob in @salesforce/apex-node. Remove when upstream issue micromatch/braces#70 is fixed.",
  },
  {
    id: "GHSA-ch52-4w7c-c8xp",
    packageName: "http-cache-semantics",
    expiresOn: "2026-11-02",
    reason:
      "No patched npm release exists; transitive through got in @salesforce/source-deploy-retrieve. SF Pi is not a shared HTTP cache. Remove when upstream issue kornelski/http-cache-semantics#56 is fixed.",
  },
];

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

/**
 * @param {Record<string, any>} report
 * @param {Array<{id: string, packageName: string, expiresOn: string, reason: string}>} allowlist
 * @param {Date} now
 */
export function evaluateAuditReport(
  report,
  allowlist = TEMPORARY_NO_FIX_ADVISORIES,
  now = new Date(),
) {
  const vulnerabilities = report?.vulnerabilities ?? {};
  const exceptions = new Map(allowlist.map((entry) => [entry.id, entry]));
  const allowedSeen = new Set();
  const unresolved = [];

  function resolve(packageName, path = [], visiting = new Set()) {
    if (visiting.has(packageName)) {
      return [
        finding(
          packageName,
          undefined,
          `cyclic audit dependency: ${[...path, packageName].join(" -> ")}`,
        ),
      ];
    }
    const vulnerability = vulnerabilities[packageName];
    if (!vulnerability) {
      return [
        finding(
          packageName,
          undefined,
          `missing audit dependency: ${[...path, packageName].join(" -> ")}`,
        ),
      ];
    }
    const via = Array.isArray(vulnerability.via) ? vulnerability.via : [];
    if (via.length === 0) {
      return [
        finding(packageName, undefined, "high-severity vulnerability has no advisory details"),
      ];
    }

    const nextVisiting = new Set(visiting).add(packageName);
    return via.flatMap((item) => {
      if (typeof item === "string") {
        return resolve(item, [...path, packageName], nextVisiting);
      }

      const id = advisoryId(item?.url);
      const exception = id ? exceptions.get(id) : undefined;
      if (!exception || exception.packageName !== item?.name) {
        return [finding(item?.name ?? packageName, id, item?.title ?? "unapproved advisory")];
      }

      const expiresAt = new Date(`${exception.expiresOn}T23:59:59.999Z`);
      if (!Number.isFinite(expiresAt.getTime()) || now > expiresAt) {
        return [finding(item.name, id, `temporary exception expired on ${exception.expiresOn}`)];
      }

      allowedSeen.add(id);
      return [];
    });
  }

  for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
    if (!BLOCKING_SEVERITIES.has(String(vulnerability?.severity ?? "").toLowerCase())) continue;
    unresolved.push(...resolve(packageName));
  }

  const uniqueUnresolved = [
    ...new Map(
      unresolved.map((item) => [`${item.packageName}:${item.id ?? "none"}:${item.reason}`, item]),
    ).values(),
  ];
  const stale = allowlist.map((entry) => entry.id).filter((id) => !allowedSeen.has(id));
  return {
    ok: uniqueUnresolved.length === 0 && stale.length === 0,
    allowed: [...allowedSeen].sort(),
    unresolved: uniqueUnresolved,
    stale,
  };
}

function finding(packageName, id, reason) {
  return { packageName, id, reason };
}

function advisoryId(url) {
  return typeof url === "string" ? url.match(/GHSA-[a-z0-9-]+/iu)?.[0] : undefined;
}

function main() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const env = { ...process.env };
  delete env.npm_config_allow_scripts;
  delete env.NPM_CONFIG_ALLOW_SCRIPTS;
  const audit = spawnSync(npm, ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
    env,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (audit.error) throw audit.error;

  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    console.error(audit.stderr || audit.stdout || "npm audit returned no JSON output");
    process.exitCode = 1;
    return;
  }

  if (report?.error) {
    console.error(
      `npm audit failed: ${report.error.code ?? "unknown"} · ${report.error.summary ?? "unknown error"}`,
    );
    process.exitCode = 1;
    return;
  }

  const result = evaluateAuditReport(report);
  if (!result.ok) {
    for (const item of result.unresolved) {
      console.error(`❌ ${item.id ?? "unknown advisory"} · ${item.packageName}: ${item.reason}`);
    }
    for (const id of result.stale) {
      console.error(`❌ Stale npm audit exception: ${id}. Remove it or restore its evidence.`);
    }
    process.exitCode = 1;
    return;
  }

  for (const id of result.allowed) {
    const entry = TEMPORARY_NO_FIX_ADVISORIES.find((candidate) => candidate.id === id);
    console.warn(`⚠️ ${id} temporarily allowed until ${entry?.expiresOn}: ${entry?.reason}`);
  }
  console.log("✅ Production npm audit passed with only exact, active no-fix exceptions.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
