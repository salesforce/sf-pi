/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read-only sf-pi doctor diagnostics.
 *
 * Keep this module side-effect free. Command handlers and startup code use it
 * to decide what to display; repair code lives in fixes.ts.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { getInstalledPiVersion, MIN_PI_VERSION } from "../pi-compat.ts";
import { globalAgentPath, globalSettingsPath, projectSettingsPath } from "../pi-paths.ts";
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

const MIN_NODE_MAJOR = 20;

interface SkillRootCandidate {
  root: string;
  label: string;
  kind: SkillRootKind;
  settingsValue?: string;
}

export function runDoctorDiagnostics(options: { cwd?: string; home?: string } = {}): DoctorReport {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? os.homedir();
  const globalSettings = readJsonObject(globalSettingsPath());
  const projectSettings = readJsonObject(projectSettingsPath(cwd));
  const effectiveSettings = { ...globalSettings, ...projectSettings };
  const sfPiSettings = readObject(effectiveSettings.sfPi);
  const welcomeSettings = readObject(sfPiSettings.welcome);
  const welcomeMode = typeof welcomeSettings.mode === "string" ? welcomeSettings.mode : undefined;

  const skillLocations = discoverSkillLocations({ cwd, home, settings: effectiveSettings });
  const skillCollisions = findSkillCollisions(skillLocations);
  const staleSkillPaths = findStaleSkillPaths(effectiveSettings, home);
  const availableSkillRoots = findAvailableSkillRoots(effectiveSettings, home);
  const sfPiPackageDuplicates = findSfPiPackageDuplicates(cwd);
  const runtime = collectRuntimeDiagnostics();
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
      detail: `Detected pi ${piVersion}. sf-pi targets pi ${MIN_PI_VERSION} or newer.`,
      fix: "Update pi with `npm install -g @mariozechner/pi-coding-agent@latest` or `pi update --self`.",
    });
  }

  const nodeMajor = Number(/^v?(\d+)/.exec(nodeVersion)?.[1] ?? "0");
  if (nodeMajor < MIN_NODE_MAJOR) {
    issues.push({
      id: "node-version-old",
      severity: "error",
      title: `Node.js is older than ${MIN_NODE_MAJOR}`,
      detail: `Detected ${nodeVersion}. sf-pi requires Node.js ${MIN_NODE_MAJOR} or newer.`,
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

export function collectRuntimeDiagnostics(): RuntimeDiagnostics {
  const piPath = runCapture("which", ["pi"]);
  const npmPath = runCapture("which", ["npm"]);
  const allPiPaths = runCapture("which", ["-a", "pi"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const npmGlobalRoot = runCapture("npm", ["root", "-g"]);
  const npmMinReleaseAge = normalizeNpmConfigValue(
    runCapture("npm", ["config", "get", "min-release-age"]),
  );
  const installedPiPackageVersion = npmGlobalRoot
    ? readPackageVersion(
        path.join(npmGlobalRoot, "@mariozechner", "pi-coding-agent", "package.json"),
      )
    : undefined;
  const piVersion = runCapture("pi", ["--version"]) || getInstalledPiVersion();
  const latestPiPackageVersion = runCapture("npm", [
    "view",
    "@mariozechner/pi-coding-agent",
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
    npmMinReleaseAge,
    installedPiPackageVersion,
    latestPiPackageVersion,
    updateAdvice: buildRuntimeUpdateAdvice({
      piVersion,
      installedPiPackageVersion,
      allPiPaths,
      npmMinReleaseAge,
    }),
  };
}

function normalizeNpmConfigValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return undefined;
  return trimmed;
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

export function buildRuntimeUpdateAdvice(input: {
  piVersion?: string;
  installedPiPackageVersion?: string;
  allPiPaths: string[];
  npmMinReleaseAge?: string;
}): string[] {
  const installCommand = input.npmMinReleaseAge
    ? "npm install -g @mariozechner/pi-coding-agent@latest --force --min-release-age=0"
    : "npm install -g @mariozechner/pi-coding-agent@latest --force";
  const lines = [
    "nvm use <node-version-if-applicable>",
    "npm uninstall -g @mariozechner/pi-coding-agent",
    installCommand,
    "hash -r",
    "pi --version",
  ];

  if (input.npmMinReleaseAge) {
    lines.unshift(
      `npm min-release-age is ${input.npmMinReleaseAge}; use --min-release-age=0 to bypass delayed visibility of newly published pi releases.`,
    );
  }
  if (input.allPiPaths.length > 1) {
    lines.unshift("which -a pi  # multiple pi executables found; ensure PATH uses the updated one");
  }
  if (input.piVersion && compareVersions(input.piVersion, MIN_PI_VERSION) < 0) {
    lines.unshift(`Detected pi ${input.piVersion}; sf-pi requires ${MIN_PI_VERSION} or newer.`);
  }
  if (
    input.installedPiPackageVersion &&
    input.piVersion &&
    input.installedPiPackageVersion !== input.piVersion
  ) {
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
