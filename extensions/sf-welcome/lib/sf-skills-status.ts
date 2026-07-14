/* SPDX-License-Identifier: Apache-2.0 */
/**
 * forcedotcom/afv-library install + freshness status for the welcome splash.
 *
 * The companion `sf-skills` extension owns the install / update / link
 * lifecycle. This module is a strictly read-only sibling that surfaces a
 * single splash row:
 *
 *     📚 SF Skills    ✓ afv-library installed · latest
 *     📚 SF Skills    ✓ afv-library available
 *     📚 SF Skills    ↑ afv-library · 12 commits behind
 *     📚 SF Skills    ✓ afv-library linked · ~/work/afv-library
 *     📚 SF Skills    ↑ Install official skills (·  /sf-skills defaults install)
 *
 * Design rules (must hold so startup time stays flat):
 *
 *   1. First paint is purely local. existsSync() + cache read. No git, no
 *      subprocess, no fetch.
 *   2. Background refresh runs on a deferred timer (see index.ts). The local
 *      commit SHA comes from `.git/HEAD` directly so we avoid a `git`
 *      subprocess in the common case (depth-1 clones from
 *      `/sf-skills defaults install` always satisfy this).
 *   3. The upstream comparison hits GitHub's compare endpoint with a 5 s
 *      timeout. Failure degrades to `freshness: "unknown"` — we never
 *      throw out of detection.
 *   4. On-disk cache lives under the canonical sf-pi/<ns>/<file> layout via
 *      the shared state-store, with a 24 h TTL identical to sf-cli-status.
 *
 * Re-uses `managedClonePath()` from extensions/sf-skills/lib/defaults.ts as
 * the source of truth for managed-clone paths so the two extensions can never
 * disagree on where the repo lives.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { createStateStore } from "../../../lib/common/state-store.ts";
import { globalSettingsPath, projectSettingsPath } from "../../../lib/common/pi-paths.ts";
import { managedClonePath } from "../../sf-skills/lib/defaults.ts";
import type { SfSkillsStatusInfo } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

const REPO_OWNER = "forcedotcom";
const REPO_NAME = "afv-library";
const REPO_DEFAULT_BRANCH = "main";
const GITHUB_COMPARE_TIMEOUT_MS = 5_000;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MANAGED_SENTINEL_FILE = ".sf-skills-managed";
const SKILLS_SUBDIR = "skills";

// -------------------------------------------------------------------------------------------------
// State-store cache (mirrors sf-cli-status.ts)
// -------------------------------------------------------------------------------------------------

interface SfSkillsStatusCacheFile {
  status?: SfSkillsStatusInfo;
  savedAt?: number;
}

/**
 * Build a fresh state-store on every call so PI_CODING_AGENT_DIR overrides
 * applied after module load (notably in unit tests, but also in any pi SDK
 * consumer that boots with a custom agent dir) reach the cache path. The
 * factory call itself does no I/O — it just wires closures — so the
 * recomputation cost is negligible compared to the FS read/write that
 * follows.
 */
function getCacheStore() {
  return createStateStore<SfSkillsStatusCacheFile>({
    namespace: "sf-welcome",
    filename: "sf-skills-status.json",
    schemaVersion: 1,
    defaults: {},
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as SfSkillsStatusCacheFile)
        : null;
    },
  });
}

function parseCachedStatus(value: unknown): SfSkillsStatusInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SfSkillsStatusInfo>;
  if (
    record.installKind !== "managed" &&
    record.installKind !== "linked" &&
    record.installKind !== "not-installed"
  ) {
    return null;
  }
  if (
    record.freshness !== "checking" &&
    record.freshness !== "latest" &&
    record.freshness !== "update-available" &&
    record.freshness !== "unknown"
  ) {
    return null;
  }
  return {
    installKind: record.installKind,
    scope: record.scope === "global" || record.scope === "project" ? record.scope : undefined,
    skillsPath: typeof record.skillsPath === "string" ? record.skillsPath : undefined,
    rootPath: typeof record.rootPath === "string" ? record.rootPath : undefined,
    localSha: typeof record.localSha === "string" ? record.localSha : undefined,
    remoteSha: typeof record.remoteSha === "string" ? record.remoteSha : undefined,
    commitsBehind:
      typeof record.commitsBehind === "number" && Number.isFinite(record.commitsBehind)
        ? record.commitsBehind
        : undefined,
    skillCount:
      typeof record.skillCount === "number" && Number.isFinite(record.skillCount)
        ? record.skillCount
        : undefined,
    wired:
      typeof record.wired === "boolean"
        ? record.wired
        : record.installKind === "managed"
          ? true
          : undefined,
    freshness: record.freshness,
    // Cached values are display-ready; a background refresh may update them.
    loading: false,
    checkSkipped: record.checkSkipped === true,
    skipReason:
      record.skipReason === "offline" || record.skipReason === "version-check-disabled"
        ? record.skipReason
        : undefined,
  };
}

export function readCachedSfSkillsStatus(
  maxAgeMs: number = CACHE_MAX_AGE_MS,
): SfSkillsStatusInfo | null {
  try {
    const cache = getCacheStore().read();
    if (typeof cache.savedAt !== "number") return null;
    if (Date.now() - cache.savedAt > maxAgeMs) return null;
    return parseCachedStatus(cache.status);
  } catch {
    return null;
  }
}

export function writeCachedSfSkillsStatus(status: SfSkillsStatusInfo): void {
  try {
    getCacheStore().write({ status: { ...status, loading: false }, savedAt: Date.now() });
  } catch {
    // Cache is best-effort. Never let splash rendering depend on disk writes.
  }
}

// -------------------------------------------------------------------------------------------------
// Local detection (sync, FS-only)
// -------------------------------------------------------------------------------------------------

/**
 * Read the commit SHA pointed to by HEAD without spawning git.
 *
 * Depth-1 clones produced by `/sf-skills defaults install` always have the
 * branch tip in a loose ref under .git/refs/heads/<branch>, so this returns
 * a SHA in the common case. Falls back to packed-refs and finally to
 * `undefined` so the caller can degrade to freshness:"unknown".
 */
export function readLocalGitHead(rootPath: string): string | undefined {
  try {
    const headPath = path.join(rootPath, ".git", "HEAD");
    if (!existsSync(headPath)) return undefined;
    const head = readFileSync(headPath, "utf8").trim();
    // Detached HEAD or already-resolved SHA.
    if (/^[0-9a-f]{7,64}$/.test(head)) return head;
    // Symbolic ref: "ref: refs/heads/main"
    const match = head.match(/^ref:\s*(.+)$/);
    if (!match) return undefined;
    const refPath = match[1].trim();
    const loose = path.join(rootPath, ".git", refPath);
    if (existsSync(loose)) {
      const sha = readFileSync(loose, "utf8").trim();
      if (/^[0-9a-f]{7,64}$/.test(sha)) return sha;
    }
    // Fall back to packed-refs lookup.
    const packed = path.join(rootPath, ".git", "packed-refs");
    if (existsSync(packed)) {
      const lines = readFileSync(packed, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const [sha, ref] = trimmed.split(/\s+/);
        if (ref === refPath && /^[0-9a-f]{7,64}$/.test(sha)) return sha;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Count subdirectories under <skillsPath>/ that contain a SKILL.md.
 *
 * Best-effort and bounded: walks one level deep, no recursion. If anything
 * throws we return undefined so the row doesn't grow noisy with a misleading
 * count.
 */
export function countSkillsInDir(skillsPath: string): number | undefined {
  if (!existsSync(skillsPath)) return undefined;
  try {
    let count = 0;
    for (const entry of readdirSync(skillsPath)) {
      const entryPath = path.join(skillsPath, entry);
      try {
        if (statSync(entryPath).isDirectory() && existsSync(path.join(entryPath, "SKILL.md"))) {
          count++;
        }
      } catch {
        // Skip unreadable entries — never crash the splash here.
      }
    }
    return count;
  } catch {
    return undefined;
  }
}

/**
 * Scan global + project settings.skills[] for an entry that looks like a
 * user-owned afv-library checkout (linked, but not managed by us).
 *
 * Returns the rootPath of the first matching checkout, plus the scope it
 * was wired in. We accept any path whose final segment is "skills" and
 * whose parent directory has a `.git` entry — that matches both literal
 * `~/.../afv-library/skills` clones and forks renamed to other names. We
 * intentionally don't require "afv-library" in the path so renamed forks
 * still register as installed.
 */
export function detectLinkedAfvCheckout(
  cwd: string,
): { rootPath: string; skillsPath: string; scope: "global" | "project" } | null {
  const candidates: Array<{ filePath: string; scope: "global" | "project" }> = [
    { filePath: globalSettingsPath(), scope: "global" },
    { filePath: projectSettingsPath(cwd), scope: "project" },
  ];

  for (const { filePath, scope } of candidates) {
    if (!existsSync(filePath)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const skills = (parsed as Record<string, unknown>).skills;
    if (!Array.isArray(skills)) continue;

    for (const value of skills) {
      if (typeof value !== "string" || !value.trim()) continue;
      const expanded = expandPath(value, cwd);
      if (path.basename(expanded) !== "skills") continue;
      const rootPath = path.dirname(expanded);
      const gitMarker = path.join(rootPath, ".git");
      if (!existsSync(gitMarker)) continue;
      // Skip the managed paths; those are reported via Managed Source Availability.
      if (looksLikeManagedClone(rootPath)) continue;
      return { rootPath, skillsPath: expanded, scope };
    }
  }
  return null;
}

function expandPath(value: string, cwd: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("~/")) return path.join(homedir(), trimmed.slice(2));
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("./") || trimmed === ".") return path.resolve(cwd, trimmed);
  if (path.isAbsolute(trimmed)) return trimmed;
  return path.resolve(cwd, trimmed);
}

function looksLikeManagedClone(rootPath: string): boolean {
  return existsSync(path.join(rootPath, MANAGED_SENTINEL_FILE));
}

function isDirectory(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

function readSettingsSkills(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const skills = (parsed as Record<string, unknown>).skills;
    return Array.isArray(skills) ? skills.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function settingsIncludesSkillsPath(filePath: string, skillsPath: string, cwd: string): boolean {
  return readSettingsSkills(filePath).some(
    (value) => path.normalize(expandPath(value, cwd)) === path.normalize(skillsPath),
  );
}

function detectManagedWiring(
  skillsPath: string,
  cwd: string,
): { wired: boolean; scope?: "global" | "project" } {
  if (settingsIncludesSkillsPath(globalSettingsPath(), skillsPath, cwd)) {
    return { wired: true, scope: "global" };
  }
  if (settingsIncludesSkillsPath(projectSettingsPath(cwd), skillsPath, cwd)) {
    return { wired: true, scope: "project" };
  }
  return { wired: false };
}

function managedCloneAvailability(
  scope: "global" | "project",
  cwd: string,
): { rootPath: string; skillsPath: string; scope: "global" | "project"; wired: boolean } | null {
  const rootPath =
    scope === "project" ? managedClonePath("project", cwd) : managedClonePath("global");
  if (!isDirectory(rootPath)) return null;
  if (!existsSync(path.join(rootPath, MANAGED_SENTINEL_FILE))) return null;
  const skillsPath = path.join(rootPath, SKILLS_SUBDIR);
  const wiring = detectManagedWiring(skillsPath, cwd);
  return {
    rootPath,
    skillsPath,
    scope: wiring.scope ?? scope,
    wired: wiring.wired,
  };
}

function findManagedSourceAvailability(
  cwd: string,
): { rootPath: string; skillsPath: string; scope: "global" | "project"; wired: boolean } | null {
  return managedCloneAvailability("global", cwd) ?? managedCloneAvailability("project", cwd);
}

/**
 * O(1) startup-safe Managed Source Availability probe.
 *
 * This intentionally avoids git reads, skill counting, catalog loading, and
 * network calls. It only checks the managed clone paths + sentinel and whether
 * the current global/project settings wire that exact skills/ path.
 */
export function detectManagedSourceAvailabilityLocal(cwd: string): SfSkillsStatusInfo | null {
  const managed = findManagedSourceAvailability(cwd);
  if (!managed) return null;
  return {
    installKind: "managed",
    scope: managed.scope,
    wired: managed.wired,
    skillsPath: managed.skillsPath,
    rootPath: managed.rootPath,
    freshness: "unknown",
    loading: false,
  };
}

/** Merge a cached freshness result with live local Managed Source Availability. */
export function reconcileCachedSfSkillsStatus(
  cwd: string,
  cached: SfSkillsStatusInfo | null,
): SfSkillsStatusInfo | null {
  const localManaged = detectManagedSourceAvailabilityLocal(cwd);
  if (localManaged) {
    if (cached?.installKind === "managed" && cached.rootPath === localManaged.rootPath) {
      return {
        ...cached,
        scope: localManaged.scope,
        wired: localManaged.wired,
        skillsPath: localManaged.skillsPath,
        rootPath: localManaged.rootPath,
        loading: false,
      };
    }
    return localManaged;
  }

  if (cached?.installKind === "managed") {
    return { installKind: "not-installed", freshness: "unknown", loading: false };
  }
  return cached;
}

/**
 * Fully synchronous local detection.
 *
 * Order of preference:
 *   1. Global managed clone (most common — `/sf-skills defaults install`)
 *   2. Project managed clone
 *   3. Linked user-owned checkout (any scope)
 *   4. Not installed
 *
 * Returns a status whose `freshness` is `"unknown"` when installed (the
 * deferred refresh fills it in) and `"unknown"` when not installed
 * (the renderer treats not-installed specially regardless of freshness).
 */
export function detectInstallStateLocal(cwd: string): SfSkillsStatusInfo {
  const managed = findManagedSourceAvailability(cwd);
  if (managed) {
    return buildManagedStatus(managed.rootPath, managed.skillsPath, managed.scope, managed.wired);
  }

  const linked = detectLinkedAfvCheckout(cwd);
  if (linked) {
    return {
      installKind: "linked",
      scope: linked.scope,
      skillsPath: linked.skillsPath,
      rootPath: linked.rootPath,
      localSha: readLocalGitHead(linked.rootPath),
      skillCount: countSkillsInDir(linked.skillsPath),
      // Linked checkouts are user-owned working trees — never nag for
      // updates. Freshness stays "unknown" and the row renders without
      // the orange "↑ commits behind" suffix.
      freshness: "unknown",
      loading: false,
    };
  }

  return {
    installKind: "not-installed",
    freshness: "unknown",
    loading: false,
  };
}

function buildManagedStatus(
  rootPath: string,
  skillsPath: string,
  scope: "global" | "project",
  wired: boolean,
): SfSkillsStatusInfo {
  return {
    installKind: "managed",
    scope,
    wired,
    skillsPath,
    rootPath,
    localSha: readLocalGitHead(rootPath),
    skillCount: countSkillsInDir(skillsPath),
    // The remote comparison runs in detectSfSkillsStatus(); local-only
    // detection leaves this unknown so the row paints "Installed" / "Available"
    // while the network probe is in flight.
    freshness: "unknown",
    loading: false,
  };
}

// -------------------------------------------------------------------------------------------------
// Upstream comparison (network)
// -------------------------------------------------------------------------------------------------

/** Hook for tests to stub the GitHub call. */
export type SfSkillsFetchCompareFn = (
  localSha: string,
  signal?: AbortSignal,
) => Promise<{ remoteSha: string; behindBy: number } | undefined>;

/**
 * Compare a local SHA against `main` via the GitHub compare endpoint.
 *
 * One round-trip gives us both the upstream HEAD SHA and the commit-count
 * delta. Returns `undefined` on any failure (network down, rate-limit,
 * malformed payload, unauthenticated 403, …) so the caller degrades to
 * `freshness: "unknown"` cleanly.
 *
 * Anonymous GitHub API rate limit is 60/hour/IP. The cache-first first paint
 * + 24h cache TTL keeps a busy user well under that ceiling.
 */
export async function fetchUpstreamCompare(
  localSha: string,
  signal?: AbortSignal,
): Promise<{ remoteSha: string; behindBy: number } | undefined> {
  if (!/^[0-9a-f]{7,64}$/.test(localSha)) return undefined;
  try {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/compare/${localSha}...${REPO_DEFAULT_BRANCH}`;
    const timeoutSignal = AbortSignal.timeout(GITHUB_COMPARE_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(url, {
      signal: combined,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as {
      status?: unknown;
      ahead_by?: unknown;
      behind_by?: unknown;
      total_commits?: unknown;
      base_commit?: { sha?: unknown };
      merge_base_commit?: { sha?: unknown };
      commits?: Array<{ sha?: unknown }>;
    };
    // Resolve the upstream HEAD SHA. The `compare` endpoint reports the
    // upstream tip as the last entry of `commits` (the ones the caller is
    // behind on). When there are zero behind commits, the local SHA is the
    // upstream HEAD itself.
    const behindBy = typeof payload.behind_by === "number" ? payload.behind_by : undefined;
    if (typeof behindBy !== "number") return undefined;
    let remoteSha: string | undefined;
    if (behindBy === 0) {
      remoteSha = localSha;
    } else if (Array.isArray(payload.commits) && payload.commits.length > 0) {
      const last = payload.commits[payload.commits.length - 1];
      if (last && typeof last.sha === "string") remoteSha = last.sha;
    }
    if (!remoteSha) return undefined;
    return { remoteSha, behindBy };
  } catch {
    return undefined;
  }
}

// -------------------------------------------------------------------------------------------------
// Public detect
// -------------------------------------------------------------------------------------------------

/**
 * Full status: local FS detection plus (when installed) upstream comparison.
 *
 * Always resolves; never throws. Returns the input local status verbatim
 * with `freshness` filled in when the comparison succeeded.
 */
function versionCheckSkipReason(
  env: NodeJS.ProcessEnv = process.env,
): "offline" | "version-check-disabled" | undefined {
  if (env.PI_OFFLINE) return "offline";
  if (env.PI_SKIP_VERSION_CHECK) return "version-check-disabled";
  return undefined;
}

export async function detectSfSkillsStatus(
  cwd: string,
  fetchCompare: SfSkillsFetchCompareFn = fetchUpstreamCompare,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SfSkillsStatusInfo> {
  const local = detectInstallStateLocal(cwd);
  if (local.installKind === "not-installed" || local.installKind === "linked") {
    // Linked checkouts: don't poke the network — user owns the tree.
    // Not installed: nothing to compare.
    return local;
  }
  if (!local.localSha) {
    return { ...local, freshness: "unknown" };
  }

  const skipReason = versionCheckSkipReason(env);
  if (skipReason) {
    return {
      ...local,
      freshness: "unknown",
      checkSkipped: true,
      skipReason,
    };
  }

  const compare = await fetchCompare(local.localSha);
  if (!compare) {
    return { ...local, freshness: "unknown" };
  }

  return {
    ...local,
    remoteSha: compare.remoteSha,
    commitsBehind: compare.behindBy,
    freshness: compare.behindBy === 0 ? "latest" : "update-available",
  };
}
