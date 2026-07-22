/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read-only sf-pi doctor diagnostics.
 *
 * Keep this module side-effect free. Command handlers and startup code use it
 * to decide what to display; repair code lives in fixes.ts.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import {
  getInstalledPiVersion,
  MAX_PI_VERSION_EXCLUSIVE,
  MIN_PI_VERSION,
  RECOMMENDED_PI_VERSION,
} from "../pi-compat.ts";
import { isNodeRuntimeSupported, NODE_RUNTIME_FLOOR } from "../runtime-floor.ts";
import { normalizeNpmConfigValue, readConfiguredNpmCommand } from "../npm-release-age-policy.ts";
import { globalAgentPath, globalSettingsPath, projectSettingsPath } from "../pi-paths.ts";
import { readCachedRuntimeDiagnostics, writeCachedRuntimeDiagnostics } from "./runtime-cache.ts";
import type {
  AvailableSkillRoot,
  DoctorIssue,
  DoctorReport,
  RuntimeDiagnostics,
  SfPiPackageDuplicate,
  SkillCollision,
  SkillLocation,
  SkillRootKind,
  StaleSkillPath,
  StartupDoctorNudge,
} from "./types.ts";

interface SkillRootCandidate {
  root: string;
  label: string;
  kind: SkillRootKind;
  settingsValue?: string;
}

export type DoctorRuntimeMode = "live" | "cached";

export function runDoctorDiagnostics(
  options: { cwd?: string; home?: string; runtime?: DoctorRuntimeMode } = {},
): DoctorReport {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? os.homedir();
  const runtimeMode = options.runtime ?? "live";
  const globalSettings = readJsonObject(globalSettingsPath());
  const projectSettings = readJsonObject(projectSettingsPath(cwd));
  const effectiveSettings = { ...globalSettings, ...projectSettings };
  const sfPiSettings = readObject(effectiveSettings.sfPi);
  const welcomeSettings = readObject(sfPiSettings.welcome);
  const welcomeMode = typeof welcomeSettings.mode === "string" ? welcomeSettings.mode : undefined;

  const skillLocations = discoverSkillLocations({ cwd, home, settings: effectiveSettings });
  // Root-scan collisions cover all known harness roots (even unwired ones), so
  // the doctor can proactively warn. In live mode we also union Pi's
  // authoritative loadSkills collisions so the count can never be LOWER than
  // what Pi actually reports at startup (and matches the Skill Funnel). The
  // loader scan is skipped in cached mode to keep first paint off the hot path.
  const skillCollisions =
    runtimeMode === "live"
      ? mergeCollisions(
          findSkillCollisions(skillLocations),
          findLoaderCollisions({ cwd, home, settings: effectiveSettings }),
        )
      : findSkillCollisions(skillLocations);
  const staleSkillPaths = findStaleSkillPaths(effectiveSettings, home);
  const availableSkillRoots = findAvailableSkillRoots(effectiveSettings, home);
  const sfPiPackageDuplicates = findSfPiPackageDuplicates(cwd);
  const runtime =
    runtimeMode === "cached" ? collectStartupRuntimeDiagnostics() : collectRuntimeDiagnostics();
  const piVersion = runtime.piVersion;
  const nodeVersion = runtime.nodeVersion;
  const safeStartRequested = isTruthyEnv(process.env.SF_PI_SAFE_START);
  const welcomeDisabled = isWelcomeDisabled(effectiveSettings);

  const issues: DoctorIssue[] = [];
  if (piVersion && compareVersions(piVersion, MIN_PI_VERSION) < 0) {
    issues.push({
      id: "pi-version-old",
      severity: "error",
      title: `Pi runtime is older than ${MIN_PI_VERSION}`,
      detail: `Detected pi ${piVersion}. sf-pi supports >=${MIN_PI_VERSION} <${MAX_PI_VERSION_EXCLUSIVE}.`,
      fix: `Use Pi ${RECOMMENDED_PI_VERSION}, then run \`/sf-pi doctor runtime\` for install-specific guidance.`,
    });
  } else if (piVersion && compareVersions(piVersion, MAX_PI_VERSION_EXCLUSIVE) >= 0) {
    issues.push({
      id: "pi-version-new",
      severity: "error",
      title: `Pi runtime is outside the audited window`,
      detail: `Detected pi ${piVersion}. sf-pi supports >=${MIN_PI_VERSION} <${MAX_PI_VERSION_EXCLUSIVE}.`,
      fix: `Use Pi ${RECOMMENDED_PI_VERSION}, then run \`/sf-pi doctor runtime\` for install-specific guidance.`,
    });
  }

  if (!isNodeRuntimeSupported(nodeVersion)) {
    issues.push({
      id: "node-version-old",
      severity: "error",
      title: `Node.js is older than ${NODE_RUNTIME_FLOOR}`,
      detail: `Detected ${nodeVersion}. sf-pi requires Node.js ${NODE_RUNTIME_FLOOR} or newer.`,
      fix: "Install a current Node.js release, then reinstall sf-pi.",
    });
  }

  if (
    effectiveSettings.quietStartup !== true &&
    welcomeMode !== "header" &&
    welcomeMode !== "off"
  ) {
    issues.push({
      id: "startup-overlay-enabled",
      severity: "warn",
      title: "Full startup splash is enabled",
      detail: "Users with terminal focus issues can feel stuck behind the welcome overlay.",
      fix: "Run `/sf-pi doctor fix startup` to enable quiet/header startup.",
    });
  }

  if (skillCollisions.length > 0) {
    const duplicateCount = skillCollisions.reduce((sum, c) => sum + c.duplicates.length, 0);
    issues.push({
      id: "skill-collisions",
      severity: "warn",
      title: `${skillCollisions.length} duplicate skill name(s) detected`,
      detail: `${duplicateCount} duplicate skill location(s) will be skipped by pi at startup.`,
      fix: "Run `/sf-pi doctor fix skills` to move duplicate sf-* skills to quarantine and reload.",
    });
  }

  if (staleSkillPaths.length > 0) {
    issues.push({
      id: "stale-skill-paths",
      severity: "warn",
      title: `${staleSkillPaths.length} stale skills[] path(s)`,
      detail: "settings.skills[] includes paths that no longer exist.",
      fix: "Run `/sf-pi doctor fix skills` to prune stale skill paths.",
    });
  }

  if (availableSkillRoots.length > 0) {
    const skillCount = availableSkillRoots.reduce((sum, root) => sum + root.skillCount, 0);
    issues.push({
      id: "external-skills-unwired",
      severity: "info",
      title: `${availableSkillRoots.length} external skill root(s) available`,
      detail: `${skillCount} skill(s) are present in Claude/Codex/Cursor folders but are not wired into pi.`,
      fix: "Run `/sf-pi skills` or `/sf-pi doctor fix skills` to link them.",
    });
  }

  if (sfPiPackageDuplicates.length > 0) {
    issues.push({
      id: "sf-pi-package-duplicates",
      severity: "warn",
      title: "Multiple sf-pi package entries detected",
      detail: "More than one sf-pi package entry can load duplicate extensions or stale code.",
      fix: "Keep one sf-pi package source in settings.packages[].",
    });
  }

  if (safeStartRequested) {
    issues.push({
      id: "safe-start-active",
      severity: "info",
      title: "Safe start is active",
      detail: "SF_PI_SAFE_START is set, so sf-pi avoids blocking startup UI.",
      fix: "Unset SF_PI_SAFE_START after `/sf-pi doctor` reports clean startup.",
    });
  }

  return {
    piVersion,
    nodeVersion,
    runtime,
    quietStartup: effectiveSettings.quietStartup === true,
    welcomeMode,
    safeStartRequested,
    welcomeDisabled,
    issues,
    skillCollisions,
    staleSkillPaths,
    availableSkillRoots,
    sfPiPackageDuplicates,
  };
}

export function summarizeStartupDoctorNudge(report: DoctorReport): StartupDoctorNudge | undefined {
  const actionable = report.issues.filter(
    (issue) => issue.severity === "warn" || issue.severity === "error",
  );
  if (actionable.length === 0 && !report.safeStartRequested) return undefined;

  const collisionCount = report.skillCollisions.length;
  const staleSkillPathCount = report.staleSkillPaths.length;
  const packageDuplicateCount = report.sfPiPackageDuplicates.length;
  const pieces: string[] = [];
  if (collisionCount > 0)
    pieces.push(`${collisionCount} skill collision${collisionCount === 1 ? "" : "s"}`);
  if (staleSkillPathCount > 0) {
    pieces.push(`${staleSkillPathCount} stale skill path${staleSkillPathCount === 1 ? "" : "s"}`);
  }
  if (packageDuplicateCount > 0) pieces.push("duplicate sf-pi packages");
  if (
    report.quietStartup !== true &&
    report.welcomeMode !== "header" &&
    report.welcomeMode !== "off"
  ) {
    pieces.push("startup overlay enabled");
  }
  if (pieces.length === 0 && report.safeStartRequested) pieces.push("safe start active");

  return {
    issueCount: actionable.length,
    collisionCount,
    staleSkillPathCount,
    packageDuplicateCount,
    safeStartRequested: report.safeStartRequested,
    message: pieces.join(" · "),
    command: "/sf-pi doctor",
  };
}

export function shouldForceSafeWelcome(report: DoctorReport): boolean {
  if (report.welcomeDisabled) return true;
  if (report.safeStartRequested) return true;
  return report.issues.some((issue) => issue.severity === "warn" || issue.severity === "error");
}

export function isWelcomeDisabled(settings?: Record<string, unknown>): boolean {
  if (isTruthyEnv(process.env.SF_PI_WELCOME_OFF)) return true;
  if (String(process.env.SF_PI_WELCOME ?? "").toLowerCase() === "off") return true;
  const root = settings ?? {
    ...readJsonObject(globalSettingsPath()),
    ...readJsonObject(projectSettingsPath(process.cwd())),
  };
  const sfPi = readObject(root.sfPi);
  const welcome = readObject(sfPi.welcome);
  return welcome.mode === "off";
}

export function resolveConfiguredWelcomeMode(cwd: string): "auto" | "overlay" | "header" | "off" {
  const merged = {
    ...readJsonObject(globalSettingsPath()),
    ...readJsonObject(projectSettingsPath(cwd)),
  };
  if (isTruthyEnv(process.env.SF_PI_SAFE_START)) return "header";
  if (String(process.env.SF_PI_WELCOME ?? "").toLowerCase() === "off") return "off";
  const envMode = String(process.env.SF_PI_WELCOME ?? "").toLowerCase();
  if (envMode === "overlay" || envMode === "header" || envMode === "auto") return envMode;
  const sfPi = readObject(merged.sfPi);
  const welcome = readObject(sfPi.welcome);
  return welcome.mode === "overlay" || welcome.mode === "header" || welcome.mode === "off"
    ? welcome.mode
    : "auto";
}

export function discoverSkillLocations(options: {
  cwd: string;
  home: string;
  settings: Record<string, unknown>;
}): SkillLocation[] {
  const roots = buildSkillRootCandidates(options.cwd, options.home, options.settings);
  const locations: SkillLocation[] = [];
  const seenRoots = new Set<string>();
  for (const root of roots) {
    const normalizedRoot = path.resolve(root.root);
    if (seenRoots.has(normalizedRoot)) continue;
    seenRoots.add(normalizedRoot);
    if (!isDirectory(normalizedRoot)) continue;
    for (const skill of listImmediateSkills(normalizedRoot)) {
      locations.push({
        name: skill.name,
        file: skill.file,
        root: normalizedRoot,
        rootLabel: root.label,
        rootKind: root.kind,
        settingsValue: root.settingsValue,
      });
    }
  }
  return locations;
}

/**
 * Derive collisions from Pi's own loadSkills result — the authoritative record
 * of what Pi found competing at startup. Grouped by name: the winner is Pi's
 * kept copy, duplicates are every skipped copy. This is the same data Pi prints
 * as `[Skill conflicts]` and the Skill Funnel surfaces, so unioning it keeps all
 * three counts consistent.
 */
export function findLoaderCollisions(options: {
  cwd: string;
  home: string;
  settings: Record<string, unknown>;
}): SkillCollision[] {
  const skillPaths = Array.isArray(options.settings.skills)
    ? options.settings.skills.filter((v): v is string => typeof v === "string")
    : [];
  let diagnostics: Array<{ collision?: { name: string; winnerPath: string; loserPath: string } }>;
  try {
    const result = loadSkills({
      cwd: options.cwd,
      agentDir: globalAgentPath(),
      skillPaths,
      includeDefaults: true,
    });
    diagnostics = result.diagnostics as typeof diagnostics;
  } catch {
    return [];
  }

  // Group loser paths by name; the winner path is shared across a name's diagnostics.
  const byName = new Map<string, { winner: string; losers: Set<string> }>();
  for (const d of diagnostics) {
    const c = d.collision;
    if (!c) continue;
    const group = byName.get(c.name) ?? { winner: c.winnerPath, losers: new Set<string>() };
    group.losers.add(c.loserPath);
    byName.set(c.name, group);
  }

  const collisions: SkillCollision[] = [];
  for (const [name, group] of [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const preferred = loaderLocation(name, group.winner, options);
    const duplicates = [...group.losers].map((file) => loaderLocation(name, file, options));
    collisions.push({ name, locations: [preferred, ...duplicates], preferred, duplicates });
  }
  return collisions;
}

/** Best-effort SkillLocation for a loadSkills path (root/label are advisory here). */
function loaderLocation(name: string, file: string, options: { home: string }): SkillLocation {
  const dir = path.dirname(file);
  return {
    name,
    file,
    root: dir,
    rootLabel: toDisplayRoot(dir, options.home),
    rootKind: "settings",
    settingsValue: undefined,
  };
}

function toDisplayRoot(dir: string, home: string): string {
  return dir.startsWith(`${home}${path.sep}`) ? `~/${path.relative(home, dir)}` : dir;
}

/** Union two collision lists by skill name; entries from `base` win on overlap. */
export function mergeCollisions(base: SkillCollision[], extra: SkillCollision[]): SkillCollision[] {
  const byName = new Map<string, SkillCollision>();
  for (const c of base) byName.set(c.name, c);
  for (const c of extra) if (!byName.has(c.name)) byName.set(c.name, c);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findSkillCollisions(locations: SkillLocation[]): SkillCollision[] {
  const byName = new Map<string, SkillLocation[]>();
  for (const location of locations) {
    const existing = byName.get(location.name) ?? [];
    existing.push(location);
    byName.set(location.name, existing);
  }

  const collisions: SkillCollision[] = [];
  for (const [name, matches] of [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (matches.length <= 1) continue;
    const sorted = [...matches].sort(compareSkillLocationPriority);
    const preferred = sorted[0];
    if (!preferred) continue;
    collisions.push({ name, locations: sorted, preferred, duplicates: sorted.slice(1) });
  }
  return collisions;
}

function buildSkillRootCandidates(
  cwd: string,
  home: string,
  settings: Record<string, unknown>,
): SkillRootCandidate[] {
  const roots: SkillRootCandidate[] = [
    { root: globalAgentPath("skills"), label: "Pi", kind: "pi" },
    { root: path.join(home, ".agents", "skills"), label: "Agents", kind: "agents" },
    {
      root: path.join(home, ".claude", "skills"),
      label: "Claude Code",
      kind: "claude",
      settingsValue: "~/.claude/skills",
    },
    {
      root: path.join(home, ".codex", "skills"),
      label: "OpenAI Codex",
      kind: "codex",
      settingsValue: "~/.codex/skills",
    },
    {
      root: path.join(home, ".cursor", "skills"),
      label: "Cursor",
      kind: "cursor",
      settingsValue: "~/.cursor/skills",
    },
    { root: path.join(cwd, ".pi", "skills"), label: "Project Pi", kind: "project-pi" },
    { root: path.join(cwd, ".agents", "skills"), label: "Project Agents", kind: "project-agents" },
  ];

  const skills = Array.isArray(settings.skills) ? settings.skills : [];
  for (const raw of skills) {
    if (typeof raw !== "string") continue;
    const resolved = resolvePath(raw, home);
    if (!resolved) continue;
    roots.push({ root: resolved, label: `settings:${raw}`, kind: "settings", settingsValue: raw });
  }
  return roots;
}

function listImmediateSkills(root: string): Array<{ name: string; file: string }> {
  const results: Array<{ name: string; file: string }> = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry);
    try {
      const stats = statSync(entryPath);
      if (stats.isDirectory()) {
        const skillFile = path.join(entryPath, "SKILL.md");
        if (existsSync(skillFile))
          results.push({ name: readSkillName(skillFile, entry), file: skillFile });
      } else if (
        stats.isFile() &&
        entry.endsWith(".md") &&
        root.endsWith(path.join("agent", "skills"))
      ) {
        results.push({ name: path.basename(entry, ".md"), file: entryPath });
      }
    } catch {
      // Ignore unreadable entries.
    }
  }
  return results;
}

function readSkillName(file: string, fallback: string): string {
  try {
    const raw = readFileSync(file, "utf8");
    const match = /^---\s*\n([\s\S]*?)\n---/.exec(raw);
    if (!match) return fallback;
    const nameMatch = /^name:\s*["']?([^"'\n]+)["']?\s*$/m.exec(match[1] ?? "");
    return nameMatch?.[1]?.trim() || fallback;
  } catch {
    return fallback;
  }
}

function compareSkillLocationPriority(a: SkillLocation, b: SkillLocation): number {
  return (
    skillRootPriority(a.rootKind) - skillRootPriority(b.rootKind) || a.file.localeCompare(b.file)
  );
}

function skillRootPriority(kind: SkillRootKind): number {
  switch (kind) {
    case "claude":
      return 10;
    case "pi":
      return 20;
    case "agents":
      return 30;
    case "codex":
      return 40;
    case "cursor":
      return 50;
    case "project-pi":
      return 60;
    case "project-agents":
      return 70;
    case "settings":
      return 80;
  }
}

function findStaleSkillPaths(settings: Record<string, unknown>, home: string): StaleSkillPath[] {
  const skills = Array.isArray(settings.skills) ? settings.skills : [];
  const stale: StaleSkillPath[] = [];
  for (const raw of skills) {
    if (typeof raw !== "string") continue;
    const resolved = resolvePath(raw, home);
    if (resolved && !isDirectory(resolved)) stale.push({ raw, resolved });
  }
  return stale;
}

function findAvailableSkillRoots(
  settings: Record<string, unknown>,
  home: string,
): AvailableSkillRoot[] {
  const wired = new Set(
    (Array.isArray(settings.skills) ? settings.skills : [])
      .filter((value): value is string => typeof value === "string")
      .map((value) => resolvePath(value, home))
      .filter((value): value is string => !!value),
  );
  const candidates = [
    {
      label: "Claude Code",
      settingsPath: "~/.claude/skills",
      absolutePath: path.join(home, ".claude", "skills"),
    },
    {
      label: "OpenAI Codex",
      settingsPath: "~/.codex/skills",
      absolutePath: path.join(home, ".codex", "skills"),
    },
    {
      label: "Cursor",
      settingsPath: "~/.cursor/skills",
      absolutePath: path.join(home, ".cursor", "skills"),
    },
  ];
  return candidates
    .filter(
      (candidate) => isDirectory(candidate.absolutePath) && !wired.has(candidate.absolutePath),
    )
    .map((candidate) => ({
      ...candidate,
      skillCount: listImmediateSkills(candidate.absolutePath).length,
    }));
}

function findSfPiPackageDuplicates(cwd: string): SfPiPackageDuplicate[] {
  const settingsPaths = [globalSettingsPath(), projectSettingsPath(cwd)];
  const duplicates: SfPiPackageDuplicate[] = [];
  for (const settingsPath of settingsPaths) {
    const settings = readJsonObject(settingsPath);
    const packages = Array.isArray(settings.packages) ? settings.packages : [];
    const matches = packages
      .map((pkg) => (typeof pkg === "string" ? pkg : readObject(pkg).source))
      .filter(
        (source): source is string => typeof source === "string" && looksLikeSfPiPackage(source),
      );
    if (matches.length > 1) duplicates.push({ settingsPath, entries: matches });
  }
  return duplicates;
}

function looksLikeSfPiPackage(source: string): boolean {
  const lower = source.toLowerCase();
  return lower.includes("salesforce/sf-pi") || lower.endsWith("/sf-pi") || lower === "sf-pi";
}

export function collectStartupRuntimeDiagnostics(): RuntimeDiagnostics {
  const cached = readCachedRuntimeDiagnostics();
  if (cached) {
    return {
      ...cached,
      // These two fields are process-local and always cheaper/more accurate
      // than whatever the previous session persisted.
      nodeVersion: process.version,
      nodePath: process.execPath,
    };
  }

  const piVersion = getInstalledPiVersion();
  return {
    piVersion,
    requiredPiVersion: MIN_PI_VERSION,
    nodeVersion: process.version,
    nodePath: process.execPath,
    allPiPaths: [],
    updateAdvice: [],
  };
}

let runtimeRefreshInFlight: Promise<RuntimeDiagnostics> | null = null;
let runtimeLastRefreshAt = 0;
const RUNTIME_REFRESH_DEDUPE_MS = 5 * 60 * 1000;

export function refreshRuntimeDiagnosticsCache(): Promise<RuntimeDiagnostics> {
  if (runtimeRefreshInFlight) return runtimeRefreshInFlight;
  if (runtimeLastRefreshAt && Date.now() - runtimeLastRefreshAt < RUNTIME_REFRESH_DEDUPE_MS) {
    const cached = readCachedRuntimeDiagnostics();
    if (cached) return Promise.resolve(cached);
  }
  runtimeRefreshInFlight = collectRuntimeDiagnosticsAsync()
    .then((runtime) => {
      writeCachedRuntimeDiagnostics(runtime);
      runtimeLastRefreshAt = Date.now();
      return runtime;
    })
    .finally(() => {
      runtimeRefreshInFlight = null;
    });
  return runtimeRefreshInFlight;
}

export async function collectRuntimeDiagnosticsAsync(): Promise<RuntimeDiagnostics> {
  const globalSettings = readJsonObject(globalSettingsPath());
  const npmCommand = readConfiguredNpmCommand(globalSettings) ?? ["npm"];
  const [piPath, npmPath, allPiPathsRaw, npmGlobalRoot, npmBeforeRaw, npmMinRaw, npmMinimumRaw] =
    await Promise.all([
      runCaptureAsync("which", ["pi"]),
      runCaptureAsync("which", ["npm"]),
      runCaptureAsync("which", ["-a", "pi"]),
      runConfiguredNpmCaptureAsync(npmCommand, ["root", "-g"]),
      runConfiguredNpmCaptureAsync(npmCommand, ["config", "get", "before"]),
      runConfiguredNpmCaptureAsync(npmCommand, ["config", "get", "min-release-age"]),
      runConfiguredNpmCaptureAsync(npmCommand, ["config", "get", "minimum-release-age"]),
    ]);
  const allPiPaths = allPiPathsRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const npmBefore = normalizeNpmConfigValue(npmBeforeRaw);
  const npmMinReleaseAge = normalizeNpmConfigValue(npmMinRaw);
  const npmMinimumReleaseAge = normalizeNpmConfigValue(npmMinimumRaw);
  const installedPiPackageVersion = npmGlobalRoot
    ? (readPackageVersion(
        path.join(npmGlobalRoot, "@earendil-works", "pi-coding-agent", "package.json"),
      ) ??
      readPackageVersion(
        path.join(npmGlobalRoot, "@mariozechner", "pi-coding-agent", "package.json"),
      ))
    : undefined;
  const [piVersionRaw, latestPiPackageVersion] = await Promise.all([
    runCaptureAsync("pi", ["--version"]),
    runConfiguredNpmCaptureAsync(npmCommand, [
      "view",
      "@earendil-works/pi-coding-agent",
      "version",
    ]),
  ]);
  const piVersion = piVersionRaw || getInstalledPiVersion();

  return {
    piVersion,
    requiredPiVersion: MIN_PI_VERSION,
    nodeVersion: process.version,
    nodePath: process.execPath,
    npmPath,
    piPath,
    allPiPaths,
    npmGlobalRoot,
    npmBefore,
    npmMinReleaseAge,
    npmMinimumReleaseAge,
    installedPiPackageVersion,
    latestPiPackageVersion,
    updateAdvice: buildRuntimeUpdateAdvice({
      piVersion,
      installedPiPackageVersion,
      allPiPaths,
      npmBefore,
      npmMinReleaseAge,
      npmMinimumReleaseAge,
    }),
  };
}

export function collectRuntimeDiagnostics(): RuntimeDiagnostics {
  const globalSettings = readJsonObject(globalSettingsPath());
  const npmCommand = readConfiguredNpmCommand(globalSettings) ?? ["npm"];
  const piPath = runCapture("which", ["pi"]);
  const npmPath = runCapture("which", ["npm"]);
  const allPiPaths = runCapture("which", ["-a", "pi"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const npmGlobalRoot = runConfiguredNpmCapture(npmCommand, ["root", "-g"]);
  const npmBefore = normalizeNpmConfigValue(
    runConfiguredNpmCapture(npmCommand, ["config", "get", "before"]),
  );
  const npmMinReleaseAge = normalizeNpmConfigValue(
    runConfiguredNpmCapture(npmCommand, ["config", "get", "min-release-age"]),
  );
  const npmMinimumReleaseAge = normalizeNpmConfigValue(
    runConfiguredNpmCapture(npmCommand, ["config", "get", "minimum-release-age"]),
  );
  // Pi 0.74 renamed the npm scope. Probe the new scope first; fall back to
  // the legacy `@mariozechner` install for users mid-migration so doctor can
  // still report a version + actionable advice instead of "unknown".
  const installedPiPackageVersion = npmGlobalRoot
    ? (readPackageVersion(
        path.join(npmGlobalRoot, "@earendil-works", "pi-coding-agent", "package.json"),
      ) ??
      readPackageVersion(
        path.join(npmGlobalRoot, "@mariozechner", "pi-coding-agent", "package.json"),
      ))
    : undefined;
  const piVersion = runCapture("pi", ["--version"]) || getInstalledPiVersion();
  const latestPiPackageVersion = runConfiguredNpmCapture(npmCommand, [
    "view",
    "@earendil-works/pi-coding-agent",
    "version",
  ]);

  return {
    piVersion,
    requiredPiVersion: MIN_PI_VERSION,
    nodeVersion: process.version,
    nodePath: process.execPath,
    npmPath,
    piPath,
    allPiPaths,
    npmGlobalRoot,
    npmBefore,
    npmMinReleaseAge,
    npmMinimumReleaseAge,
    installedPiPackageVersion,
    latestPiPackageVersion,
    updateAdvice: buildRuntimeUpdateAdvice({
      piVersion,
      installedPiPackageVersion,
      allPiPaths,
      npmBefore,
      npmMinReleaseAge,
      npmMinimumReleaseAge,
    }),
  };
}

function readPackageVersion(packageJsonPath: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

function runCapture(command: string, args: string[]): string | undefined {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
  } catch {
    return undefined;
  }
}

function runConfiguredNpmCapture(npmCommand: string[], args: string[]): string | undefined {
  const [command, ...prefixArgs] = npmCommand;
  return command ? runCapture(command, [...prefixArgs, ...args]) : undefined;
}

function runCaptureAsync(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        timeout: 5_000,
      },
      (error, stdout) => {
        if (error) {
          resolve("");
          return;
        }
        resolve(typeof stdout === "string" ? stdout.trim() : "");
      },
    );
  });
}

function runConfiguredNpmCaptureAsync(npmCommand: string[], args: string[]): Promise<string> {
  const [command, ...prefixArgs] = npmCommand;
  return command ? runCaptureAsync(command, [...prefixArgs, ...args]) : Promise.resolve("");
}

export function buildRuntimeUpdateAdvice(input: {
  piVersion?: string;
  installedPiPackageVersion?: string;
  allPiPaths: string[];
  npmBefore?: string;
  npmMinReleaseAge?: string;
  npmMinimumReleaseAge?: string;
}): string[] {
  if (
    input.piVersion &&
    (compareVersions(input.piVersion, MIN_PI_VERSION) < 0 ||
      compareVersions(input.piVersion, MAX_PI_VERSION_EXCLUSIVE) >= 0)
  ) {
    const hasReleaseAgePolicy = !!(
      input.npmBefore ||
      input.npmMinReleaseAge ||
      input.npmMinimumReleaseAge
    );
    const bypassFlags = input.npmBefore
      ? " --before=null --min-release-age=0"
      : hasReleaseAgePolicy
        ? " --min-release-age=0"
        : "";
    const policyParts = [
      input.npmBefore ? `before=${input.npmBefore}` : undefined,
      input.npmMinReleaseAge ? `min-release-age=${input.npmMinReleaseAge}` : undefined,
      input.npmMinimumReleaseAge ? `minimum-release-age=${input.npmMinimumReleaseAge}` : undefined,
    ].filter(Boolean);
    const lines = [
      `Detected pi ${input.piVersion}; sf-pi supports >=${MIN_PI_VERSION} <${MAX_PI_VERSION_EXCLUSIVE}.`,
      ...(hasReleaseAgePolicy
        ? [
            `npm release-age policy detected (${policyParts.join(", ")}); the exact-version fallback includes bounded visibility overrides.`,
          ]
        : []),
      `Use your Pi installation method to select ${RECOMMENDED_PI_VERSION}. npm fallback:`,
      `npm install -g --ignore-scripts @earendil-works/pi-coding-agent@${RECOMMENDED_PI_VERSION} --force${bypassFlags}`,
      "hash -r",
      "pi --version",
    ];
    if (input.allPiPaths.length > 1) {
      lines.splice(
        1,
        0,
        "which -a pi  # multiple pi executables found; ensure PATH uses the supported one",
      );
    }
    return lines;
  }

  if (!input.piVersion) {
    return [
      "Pi runtime version is unknown; no automatic update is recommended.",
      "Run `pi --version`, then use `/sf-pi doctor runtime` to inspect PATH and installation details.",
    ];
  }

  const lines = [
    `Detected pi ${input.piVersion} inside the audited >=${MIN_PI_VERSION} <${MAX_PI_VERSION_EXCLUSIVE} window.`,
    `No unbounded Pi update is recommended; keep ${RECOMMENDED_PI_VERSION} inside this window.`,
  ];
  if (input.allPiPaths.length > 1) {
    lines.unshift(
      "which -a pi  # multiple pi executables found; ensure PATH uses the supported one",
    );
  }
  if (input.installedPiPackageVersion && input.installedPiPackageVersion !== input.piVersion) {
    lines.unshift(
      `npm global package is ${input.installedPiPackageVersion}, but pi --version reports ${input.piVersion}; check shell PATH/shims.`,
    );
  }
  return lines;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((part) => Number(part) || 0);
  const pb = b.split(/[.-]/).map((part) => Number(part) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return readObject(parsed);
  } catch {
    return {};
  }
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolvePath(value: string, home: string): string | null {
  if (!value) return null;
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  if (value === "~") return home;
  if (path.isAbsolute(value)) return value;
  return path.resolve(home, value);
}

function isDirectory(absolute: string): boolean {
  try {
    return statSync(absolute).isDirectory();
  } catch {
    return false;
  }
}

function isTruthyEnv(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}
