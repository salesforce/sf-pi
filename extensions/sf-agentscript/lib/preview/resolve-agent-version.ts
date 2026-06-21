/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolve `agentDefinition.agentVersion.developerName` for v1.1 preview/sessions.
 *
 * Why this exists: the SFAP /preview/sessions endpoint validates the
 * `agentDefinition.agentVersion.developerName` against its planner cache. If
 * it doesn't match a known BotVersion (and isn't the special sentinel "v0"),
 * the server returns:
 *
 *     HTTP 500 "Attempted to retrieve bot version ID to insert into cache,
 *               but record not found"
 *
 * Our local compile output sets `developerName: null` — guaranteed 500. The
 * upstream CLI overrides this from `<target>X.vN</target>` in the
 * bundle-meta.xml, defaulting to `"v0"`. We do the same, plus a SOQL fallback
 * so re-previewing an already-published agent picks up its actual latest
 * BotVersion automatically.
 *
 * Resolution priority (first hit wins):
 *   1. Caller-supplied override
 *   2. `<target>...vN</target>` in the matching bundle-meta.xml (CLI parity)
 *   3. Latest BotVersion DeveloperName via SOQL (best when re-previewing)
 *   4. `"v0"`  (CLI fallback; server treats as fresh-preview sentinel)
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Connection } from "@salesforce/core";
import {
  boundedSoqlQuery,
  DEFAULT_BOUNDED_LOOKUP_TIMEOUT_MS,
  type BoundedSoqlOptions,
} from "../bounded-salesforce-transport.ts";

// `<target>Hello_Bot.v3</target>` → `"v3"`
// Tolerant of whitespace and either CLI or hand-written bundle-meta.xml.
const TARGET_REGEX = /<target>\s*[^<]*?\.(v\d+)\s*<\/target>/i;
// Fallback: `<target>v3</target>` (no agent-name prefix) just in case.
const TARGET_BARE_REGEX = /<target>\s*(v\d+)\s*<\/target>/i;
const VERSION_REGEX = /^v\d+$/;

export interface ResolveAgentVersionOptions {
  /** Test-time override or caller-supplied pin. Highest priority. */
  override?: string;
  /**
   * Absolute path to the `.agent` file, used to locate the sibling
   * `<bundle>.bundle-meta.xml`. Optional — when missing we skip step 2.
   */
  agentFilePath?: string;
  /**
   * Org connection for the optional SOQL fallback. Optional — when missing
   * we skip step 3.
   */
  conn?: Connection;
  /**
   * Agent DeveloperName to query on `BotDefinition.DeveloperName`. Required
   * for step 3. Usually `path.basename(agentFilePath, ".agent")`.
   */
  agentName?: string;
  /** Timeout for bounded org lookups. Defaults to 10s. */
  lookupTimeoutMs?: number;
  /** Test hook for the bounded native-fetch transport. */
  fetchImpl?: BoundedSoqlOptions["fetchImpl"];
  /** Optional caller cancellation signal from the Pi tool runtime. */
  signal?: AbortSignal;
}

export interface ResolveAgentVersionResult {
  developerName: string;
  /** Where the value came from, for diagnostics + tests. */
  source: "override" | "bundle-meta" | "soql" | "default";
  /** Non-blocking lookup diagnostic when we had to fall back to default. */
  lookup_warning?: string;
  timed_out_after_ms?: number;
}

/**
 * Extract `vN` from a bundle-meta.xml string. Returns `undefined` when no
 * recognizable `<target>` is present.
 */
export function parseTargetFromBundleMeta(meta: string): string | undefined {
  const m = TARGET_REGEX.exec(meta) ?? TARGET_BARE_REGEX.exec(meta);
  if (!m) return undefined;
  const v = m[1].trim();
  return VERSION_REGEX.test(v) ? v : undefined;
}

/**
 * SOQL the org for the most recent BotVersion DeveloperName of `agentName`.
 * Returns undefined when the agent isn't published yet, the SOQL fails, or
 * the relationship is unavailable in this org. Never throws.
 */
export async function findLatestBotVersionDeveloperName(
  conn: Connection,
  agentName: string,
  opts: BoundedSoqlOptions = {},
): Promise<{ developerName?: string; warning?: string; timed_out_after_ms?: number }> {
  const safe = agentName.replace(/'/g, "''");
  const r = await boundedSoqlQuery<{
    BotVersions?: {
      records?: Array<{ DeveloperName?: string | null }>;
    } | null;
  }>(
    conn,
    `SELECT Id, ` +
      `(SELECT DeveloperName FROM BotVersions ORDER BY VersionNumber DESC LIMIT 1) ` +
      `FROM BotDefinition WHERE DeveloperName='${safe}'`,
    {
      timeoutMs: opts.timeoutMs ?? DEFAULT_BOUNDED_LOOKUP_TIMEOUT_MS,
      fetchImpl: opts.fetchImpl,
      signal: opts.signal,
    },
  );
  if (r.ok === false) {
    return {
      warning: `Latest BotVersion lookup skipped: ${r.detail}`,
      timed_out_after_ms: r.timed_out_after_ms,
    };
  }
  const dev = r.records[0]?.BotVersions?.records?.[0]?.DeveloperName;
  if (typeof dev === "string" && VERSION_REGEX.test(dev)) return { developerName: dev };
  return {};
}

/**
 * Pick the right `agentDefinition.agentVersion.developerName` for a v1.1
 * preview start. Always returns a value — defaults to `"v0"`.
 */
export async function resolveAgentVersionDeveloperName(
  opts: ResolveAgentVersionOptions,
): Promise<ResolveAgentVersionResult> {
  // 1. Explicit caller override always wins.
  if (opts.override && VERSION_REGEX.test(opts.override)) {
    return { developerName: opts.override, source: "override" };
  }

  // 2. Bundle-meta.xml `<target>X.vN</target>` (CLI parity).
  if (opts.agentFilePath) {
    const dir = path.dirname(opts.agentFilePath);
    const base = path.basename(opts.agentFilePath, ".agent");
    const metaPath = path.join(dir, `${base}.bundle-meta.xml`);
    try {
      const meta = await readFile(metaPath, "utf8");
      const v = parseTargetFromBundleMeta(meta);
      if (v) return { developerName: v, source: "bundle-meta" };
    } catch {
      /* missing or unreadable — fall through */
    }
  }

  // 3. SOQL latest BotVersion (re-preview already-published agent).
  if (opts.conn && opts.agentName) {
    const latest = await findLatestBotVersionDeveloperName(opts.conn, opts.agentName, {
      timeoutMs: opts.lookupTimeoutMs ?? DEFAULT_BOUNDED_LOOKUP_TIMEOUT_MS,
      fetchImpl: opts.fetchImpl,
      signal: opts.signal,
    });
    if (latest.developerName) return { developerName: latest.developerName, source: "soql" };
    if (latest.warning) {
      return {
        developerName: "v0",
        source: "default",
        lookup_warning: latest.warning,
        timed_out_after_ms: latest.timed_out_after_ms,
      };
    }
  }

  // 4. CLI default sentinel.
  return { developerName: "v0", source: "default" };
}
