/* SPDX-License-Identifier: Apache-2.0 */
/**
 * forcedotcom/sf-skills install / update / link / unlink.
 *
 * Why this module exists
 * ----------------------
 * The Salesforce community publishes a curated skill library at
 * `forcedotcom/sf-skills`. Users who want those skills should not have
 * to clone manually and edit `settings.json` by hand. This module owns
 * that lifecycle:
 *
 *   install : git clone the repo into a managed dir + wire it into settings
 *   update  : fetch the upstream tip at depth 1 and reset the shared global
 *             clone to it (sentinel-gated; refuses hand-edited tracked files)
 *   link    : wire a user-owned checkout (e.g. ~/work/sf-skills) into settings
 *   unlink  : remove a wired entry; --delete only valid on managed dirs
 *   status  : report every known managed/linked checkout
 *
 * Native settings, stamped effective tree
 * ---------------------------------------
 * The clone target is intentionally OUTSIDE pi's auto-discovery roots
 * (`~/.pi/agent/skills/` etc.). Pi is wired to a sibling `effective/skills`
 * copy so `/sf-skills toggle` can stamp `disable-model-invocation` without
 * dirtying the git checkout used by `/sf-skills defaults update`.
 *
 * Sentinel file (.sf-skills-managed) marks dirs we own. Auto-update
 * never touches a checkout without one — we refuse to mutate a tree
 * the user might be editing.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn as realSpawn, type ChildProcess } from "node:child_process";
import { globalAgentPath, projectConfigPath } from "../../../lib/common/pi-paths.ts";
import {
  detectSkillSources,
  updateSkillSources,
  type SkillSourceScope,
} from "../../../lib/common/skill-sources/skill-sources.ts";
import {
  managedEffectiveSettingsValue,
  managedEffectiveSkillsPath,
  syncEffectiveSkills,
} from "./invocation/effective-tree.ts";

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

export const DEFAULT_LIBRARY_REPO_URL = "https://github.com/forcedotcom/sf-skills";
export const DEFAULT_LIBRARY_DIR_NAME = "forcedotcom";
export const LEGACY_LIBRARY_DIR_NAME = "afv-library";
const REPO_URL = DEFAULT_LIBRARY_REPO_URL;
const REPO_DIR_NAME = DEFAULT_LIBRARY_DIR_NAME;
const SKILLS_SUBDIR = "skills";
const SENTINEL_FILE = ".sf-skills-managed";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

export interface ManagedClone {
  /** Absolute path to the managed clone root (the repo dir, not its skills/ subdir). */
  rootPath: string;
  /** Absolute path to the skills/ subdir inside the clone. */
  skillsPath: string;
  /** Settings value we write/look up (kept as `~/...` or `./...` for portability). */
  settingsValue: string;
  /** Scope this clone is wired at. */
  scope: SkillSourceScope;
  /** Did we find this clone on disk? */
  exists: boolean;
  /** Did we find our sentinel? Auto-update is gated on this. */
  managed: boolean;
  /** Is this clone wired in the matching settings file? */
  wired: boolean;
}

export interface InstallResult {
  ok: boolean;
  clone: ManagedClone;
  message: string;
}

export interface UpdateResult {
  ok: boolean;
  clone: ManagedClone;
  message: string;
  /** Empty when we did not invoke git (e.g. clone missing). */
  output: string;
}

// -------------------------------------------------------------------------------------------------
// Path helpers
// -------------------------------------------------------------------------------------------------

/**
 * Resolve the managed clone path for a scope.
 *
 * Global: `~/.pi/agent/sf-skills/forcedotcom/`
 * Project: `<cwd>/.pi/sf-skills/forcedotcom/`
 *
 * Both live OUTSIDE pi's auto-discovery roots so wiring stays the
 * single source of truth.
 */
export function managedClonePath(scope: SkillSourceScope, cwd?: string): string {
  if (scope === "project") {
    if (!cwd) throw new Error("managedClonePath: cwd is required for scope='project'");
    return projectConfigPath(cwd, "sf-skills", REPO_DIR_NAME);
  }
  return globalAgentPath("sf-skills", REPO_DIR_NAME);
}

/** Settings value (portable form) we write for the managed effective skills dir. */
export function managedSettingsValue(scope: SkillSourceScope): string {
  void scope; // Kept in the public signature for callers that select wiring scope.
  return managedEffectiveSettingsValue();
}

// -------------------------------------------------------------------------------------------------
// Status
// -------------------------------------------------------------------------------------------------

/** Inspect a managed clone (existence, sentinel, wired status). Read-only. */
export function inspectManagedClone(scope: SkillSourceScope, cwd?: string): ManagedClone {
  const rootPath = managedClonePath(scope, cwd);
  const skillsPath = path.join(rootPath, SKILLS_SUBDIR);
  const settingsValue = managedSettingsValue(scope);

  const exists = isDirectory(rootPath);
  const managed = exists && existsSync(path.join(rootPath, SENTINEL_FILE));

  let wired = false;
  if (exists) {
    wired =
      isManagedWired(scope, cwd, managedEffectiveSkillsPath()) ||
      isManagedWired(scope, cwd, skillsPath);
  }

  return { rootPath, skillsPath, settingsValue, scope, exists, managed, wired };
}

export function legacyManagedClonePath(scope: SkillSourceScope, cwd?: string): string {
  if (scope === "project") {
    if (!cwd) throw new Error("legacyManagedClonePath: cwd is required for scope='project'");
    return projectConfigPath(cwd, "sf-skills", LEGACY_LIBRARY_DIR_NAME);
  }
  return globalAgentPath("sf-skills", LEGACY_LIBRARY_DIR_NAME);
}

export function legacyManagedSettingsValue(): string {
  return `~/.pi/agent/sf-skills/${LEGACY_LIBRARY_DIR_NAME}/${SKILLS_SUBDIR}`;
}

export interface LegacyDefaultLibraryDetection {
  clones: Array<{
    scope: SkillSourceScope;
    rootPath: string;
    exists: boolean;
    managed: boolean;
    wired: boolean;
    wiredEntries: string[];
  }>;
  present: boolean;
  wired: boolean;
}

/** Detect retired forcedotcom/afv-library clones or wiring. Cheap path/settings checks only. */
export function detectLegacyDefaultLibrary(cwd?: string): LegacyDefaultLibraryDetection {
  const clones: LegacyDefaultLibraryDetection["clones"] = [];
  for (const scope of ["global", "project"] as const) {
    if (scope === "project" && !cwd) continue;
    const rootPath = legacyManagedClonePath(scope, cwd);
    const exists = isDirectory(rootPath);
    const managed = exists && existsSync(path.join(rootPath, SENTINEL_FILE));
    const wiredEntries = legacySettingsEntries(scope, cwd);
    clones.push({
      scope,
      rootPath,
      exists,
      managed,
      wired: wiredEntries.length > 0,
      wiredEntries,
    });
  }
  return {
    clones,
    present: clones.some((clone) => clone.exists || clone.wired),
    wired: clones.some((clone) => clone.wired),
  };
}

export function formatLegacyDefaultLibraryWarning(
  detection: LegacyDefaultLibraryDetection = detectLegacyDefaultLibrary(),
  options: { sessionStart?: boolean } = {},
): string | undefined {
  const leftovers = detection.clones.filter((clone) => clone.exists || clone.wired);
  if (leftovers.length === 0) return undefined;
  if (options.sessionStart && !detection.wired) return undefined;

  const parts: string[] = [];
  const wired = leftovers.filter((clone) => clone.wired);
  if (wired.length > 0) {
    const installCommands = wired
      .map((clone) => `/sf-skills defaults install ${clone.scope}`)
      .join(" then ");
    parts.push(
      "Retired forcedotcom/afv-library is still wired.",
      "SF Pi now uses forcedotcom/sf-skills.",
      `Run ${installCommands} to switch and remove the retired wiring.`,
    );
  }

  const managedClones = leftovers.filter((clone) => clone.exists && clone.managed);
  if (managedClones.length > 0) {
    const unlinkCommands = managedClones
      .map(
        (clone) =>
          `/sf-skills defaults unlink ${legacyUnlinkTarget(clone.rootPath)} ${clone.scope} --delete`,
      )
      .join(" then ");
    parts.push(
      detection.wired
        ? `Then remove the old managed clone with ${unlinkCommands}.`
        : `A retired forcedotcom/afv-library clone is still on disk but not wired. Remove it with ${unlinkCommands}.`,
    );
  }

  const unmanagedClones = leftovers.filter((clone) => clone.exists && !clone.managed);
  if (unmanagedClones.length > 0) {
    const paths = unmanagedClones.map((clone) => clone.rootPath).join(", ");
    parts.push(
      `A retired checkout remains on disk without ${SENTINEL_FILE} and will not be deleted automatically: ${paths}.`,
    );
  }

  return parts.join(" ");
}

function legacyUnlinkTarget(rootPath: string): string {
  const home = process.env.HOME ?? "";
  const managed = path.join(home, ".pi", "agent", "sf-skills", LEGACY_LIBRARY_DIR_NAME);
  if (home && path.normalize(rootPath) === path.normalize(managed)) {
    return `~/.pi/agent/sf-skills/${LEGACY_LIBRARY_DIR_NAME}`;
  }
  return rootPath;
}

// -------------------------------------------------------------------------------------------------
// Install
// -------------------------------------------------------------------------------------------------

export interface InstallOptions {
  /**
   * Where to WIRE the skills (which `settings.skills[]` gets the entry).
   * Default is "project" (local-first). The CONTENT is always cloned once into
   * the global managed dir and shared — we never duplicate the 57-skill clone
   * per project. So "project" means "global clone, enabled in this project".
   */
  scope: SkillSourceScope;
  cwd?: string;
  /** Override for tests. */
  spawn?: SpawnFn;
  /** Override the repo URL (tests / forks). */
  repoUrl?: string;
}

/**
 * Ensure the forcedotcom/sf-skills clone exists (once, globally) and wire it into the
 * chosen scope's `settings.skills[]`. Content lives global + shared; wiring is
 * the scoping lever (local-first by default). Idempotent.
 */
export async function installDefaults(options: InstallOptions): Promise<InstallResult> {
  const wireScope = options.scope;
  // Content always lives in the GLOBAL managed dir — one clone, shared across
  // every project that wires it. Project wiring references this same path.
  const content = inspectManagedClone("global");
  const settingsValue = managedSettingsValue("global");
  const repoUrl = options.repoUrl ?? REPO_URL;

  if (!content.exists) {
    mkdirSync(path.dirname(content.rootPath), { recursive: true });
    const result = await runGit(["clone", "--depth", "1", repoUrl, content.rootPath], {
      cwd: path.dirname(content.rootPath),
      spawn: options.spawn,
    });
    if (!result.success) {
      return {
        ok: false,
        clone: content,
        message: `git clone failed: ${result.stderr || result.stdout || "unknown error"}`,
      };
    }
    writeFileSync(
      path.join(content.rootPath, SENTINEL_FILE),
      "Managed by sf-skills. Do not edit by hand — `/sf-skills defaults update` and `/sf-skills defaults unlink --delete` operate on this directory.\n",
      "utf8",
    );
  }

  const refreshed = inspectManagedClone("global");
  syncEffectiveSkills(refreshed.skillsPath);
  const alreadyWired = isManagedWired(wireScope, options.cwd, managedEffectiveSkillsPath());
  const legacyRemoved = unwireLegacyDefaultLibrary(wireScope, options.cwd);
  updateSkillSources({
    add: alreadyWired ? [] : [settingsValue],
    remove: [cloneSkillsSettingsValue()],
    scope: wireScope,
    cwd: options.cwd,
  });

  // Report state: global content clone, wired-status reflecting the wire scope.
  const next = inspectManagedClone("global");
  const clone: ManagedClone = {
    ...next,
    scope: wireScope,
    settingsValue,
    wired: isManagedWired(wireScope, options.cwd, managedEffectiveSkillsPath()),
  };
  const wiredVerb = alreadyWired ? "still wired" : "now wired";
  const installed = content.exists
    ? `Already cloned at ${next.rootPath}; ${wiredVerb} in ${wireScope} settings.`
    : `Cloned forcedotcom/sf-skills into ${next.rootPath} and wired it in ${wireScope} settings.`;
  const leftover = formatLegacyDefaultLibraryWarning(detectLegacyDefaultLibrary(options.cwd));
  const parts = [
    installed,
    legacyRemoved ? "Removed retired forcedotcom/afv-library wiring from this scope." : undefined,
    leftover,
  ].filter((part): part is string => Boolean(part));
  return {
    ok: true,
    clone,
    message: parts.join(" "),
  };
}

function cloneSkillsSettingsValue(): string {
  return `~/.pi/agent/sf-skills/${REPO_DIR_NAME}/${SKILLS_SUBDIR}`;
}

/** Point Pi at the stamped effective tree instead of the pristine clone. */
export function rewireCloneToEffective(cwd?: string): void {
  for (const scope of ["global", "project"] as const) {
    if (scope === "project" && !cwd) continue;
    updateSkillSources({
      add: [managedEffectiveSettingsValue()],
      remove: [cloneSkillsSettingsValue()],
      scope,
      cwd,
    });
  }
}

/** Is the managed effective skill tree wired in the given scope's settings? */
export function isEffectiveTreeWired(scope: SkillSourceScope, cwd?: string): boolean {
  if (scope === "project" && !cwd) return false;
  return isManagedWired(scope, cwd, managedEffectiveSkillsPath());
}

/** Is the managed skills dir wired in the given scope's settings? */
function isManagedWired(
  scope: SkillSourceScope,
  cwd: string | undefined,
  skillsPath: string,
): boolean {
  const settingsPath = skillSettingsPath(scope, cwd);
  if (!settingsPath) return false;
  return readSkillsArray(settingsPath).some((value) => resolvesToSamePath(value, skillsPath, cwd));
}

function skillSettingsPath(scope: SkillSourceScope, cwd?: string): string | undefined {
  const detection = detectSkillSources({ cwd, includeProject: scope === "project" });
  return scope === "project" ? detection.projectSettingsPath : detection.settingsPath;
}

function legacySettingsEntries(scope: SkillSourceScope, cwd?: string): string[] {
  const settingsPath = skillSettingsPath(scope, cwd);
  if (!settingsPath) return [];
  return readSkillsArray(settingsPath).filter((value) => {
    const resolved = resolveConfiguredPath(value, cwd);
    return path.normalize(resolved).split(path.sep).includes(LEGACY_LIBRARY_DIR_NAME);
  });
}

function unwireLegacyDefaultLibrary(scope: SkillSourceScope, cwd?: string): boolean {
  const toRemove = legacySettingsEntries(scope, cwd);
  if (toRemove.length === 0) return false;
  updateSkillSources({ add: [], remove: toRemove, scope, cwd });
  return true;
}

function legacyUpdateMissingMessage(cwd?: string): string {
  const warning = formatLegacyDefaultLibraryWarning(detectLegacyDefaultLibrary(cwd));
  return warning
    ? `${warning}`
    : "No managed forcedotcom/sf-skills clone found. Run /sf-skills defaults install first.";
}

// -------------------------------------------------------------------------------------------------
// Update
// -------------------------------------------------------------------------------------------------

export interface UpdateOptions {
  scope: SkillSourceScope;
  cwd?: string;
  spawn?: SpawnFn;
}

/**
 * Update the managed clone. Refuses to touch a non-managed checkout (no
 * sentinel) — those are the user's working tree.
 *
 * Like install, the content is always the one GLOBAL clone shared across
 * projects; `scope` only chooses which settings get the effective-tree wiring.
 */
export async function updateDefaults(options: UpdateOptions): Promise<UpdateResult> {
  const clone = inspectManagedClone("global");
  if (!clone.exists) {
    return {
      ok: false,
      clone,
      message: legacyUpdateMissingMessage(options.cwd),
      output: "",
    };
  }
  if (!clone.managed) {
    return {
      ok: false,
      clone,
      message: `Refusing to git-pull ${clone.rootPath}: missing ${SENTINEL_FILE} sentinel. This checkout is not managed by sf-skills.`,
      output: "",
    };
  }
  const result = await moveCloneToUpstream(clone.rootPath, options.spawn);
  if (result.success) {
    syncEffectiveSkills(clone.skillsPath);
    updateSkillSources({
      add: [managedEffectiveSettingsValue()],
      remove: [cloneSkillsSettingsValue()],
      scope: options.scope,
      cwd: options.cwd,
    });
  }
  return {
    ok: result.success,
    clone: { ...inspectManagedClone("global"), scope: options.scope },
    message: result.success
      ? "Updated forcedotcom/sf-skills to the latest upstream and restamped the effective skill tree."
      : (result.refusal ??
        `git update failed: ${result.stderr || result.stdout || "unknown error"}`),
    output: `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`,
  };
}

/**
 * Move a managed clone to the tip of its upstream branch.
 *
 * The clone is shallow (`clone --depth 1`) and hands-off: per-user changes
 * live in the effective tree. A fast-forward pull fails as soon as upstream
 * rewrites history, so fetch the branch tip at depth 1 and reset to it. Hand
 * edits to tracked files are never discarded silently: the update refuses and
 * names them. Untracked files, such as the sentinel, are left alone.
 */
async function moveCloneToUpstream(
  rootPath: string,
  spawn?: SpawnFn,
): Promise<SpawnResult & { refusal?: string }> {
  const status = await runGit(["status", "--porcelain", "--untracked-files=no"], {
    cwd: rootPath,
    spawn,
  });
  if (!status.success) return status;
  const edited = status.stdout
    .split(/\r?\n/u)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  if (edited.length > 0) {
    return {
      ...status,
      success: false,
      refusal:
        `Refusing to update ${rootPath}: it has local changes to ${edited.join(", ")}. ` +
        "The managed clone is replaced on update; per-user changes belong in the effective tree. " +
        "Revert the changes (git checkout -- .) and run the update again.",
    };
  }
  const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: rootPath, spawn });
  const name = branch.success && branch.stdout.trim() !== "HEAD" ? branch.stdout.trim() : "main";
  const fetched = await runGit(["fetch", "--depth", "1", "origin", name], { cwd: rootPath, spawn });
  if (!fetched.success) return fetched;
  const reset = await runGit(["reset", "--hard", "FETCH_HEAD"], { cwd: rootPath, spawn });
  return {
    ...reset,
    stdout: `${fetched.stdout}${reset.stdout}`,
    stderr: `${fetched.stderr}${reset.stderr}`,
  };
}

// -------------------------------------------------------------------------------------------------
// Link / unlink
// -------------------------------------------------------------------------------------------------

export interface LinkOptions {
  /** Absolute or `~`-prefixed path to a user-owned sf-skills checkout. */
  checkoutPath: string;
  scope: SkillSourceScope;
  cwd?: string;
}

/**
 * Wire a user-owned checkout into settings.skills[].
 *
 * The path is added verbatim — pi resolves it. We do a sanity check
 * that the path exists and contains a `skills/` subdir before writing.
 */
export function linkExistingCheckout(options: LinkOptions): { ok: boolean; message: string } {
  const expanded = expandPath(options.checkoutPath);
  if (!isDirectory(expanded)) {
    return { ok: false, message: `Path does not exist or is not a directory: ${expanded}` };
  }
  const skillsDir = path.join(expanded, SKILLS_SUBDIR);
  if (!isDirectory(skillsDir)) {
    return {
      ok: false,
      message: `Expected a 'skills/' subdir inside ${expanded}; this does not look like a Salesforce skills checkout.`,
    };
  }
  const settingsValue = portableLinkValue(options.checkoutPath, options.scope, options.cwd);
  updateSkillSources({
    add: [settingsValue],
    remove: [],
    scope: options.scope,
    cwd: options.cwd,
  });
  return { ok: true, message: `Linked ${expanded} into ${options.scope} settings.skills[].` };
}

export interface UnlinkOptions {
  /** A managed clone (when scope inferred) or a path the user passed in. */
  target: string;
  scope: SkillSourceScope;
  cwd?: string;
  /** Delete the directory on disk. Only honored on managed clones. */
  deleteOnDisk?: boolean;
}

export type UnlinkDiskOutcome =
  "not-requested" | "deleted" | "absent" | "retained-unmanaged" | "delete-failed";

export interface UnlinkResult {
  ok: boolean;
  message: string;
  settingsChanged: boolean;
  removedEntries: number;
  diskOutcome: UnlinkDiskOutcome;
}

export function unlinkCheckout(options: UnlinkOptions): UnlinkResult {
  const expanded = expandPath(options.target);
  const settingsPath = skillSettingsPath(options.scope, options.cwd);
  const matchingEntries = settingsPath
    ? readSkillsArray(settingsPath).filter((value) =>
        isSameOrDescendant(resolveConfiguredPath(value, options.cwd), expanded),
      )
    : [];

  if (matchingEntries.length > 0) {
    updateSkillSources({
      add: [],
      remove: matchingEntries,
      scope: options.scope,
      cwd: options.cwd,
    });
  }

  const removedEntries = matchingEntries.length;
  const settingsChanged = removedEntries > 0;
  const settingsOutcome = settingsChanged
    ? `Removed ${removedEntries} matching settings ${removedEntries === 1 ? "entry" : "entries"} from ${options.scope} settings.`
    : `No matching settings entry was present in ${options.scope} settings.`;

  if (!options.deleteOnDisk) {
    return {
      ok: true,
      message: settingsOutcome,
      settingsChanged,
      removedEntries,
      diskOutcome: "not-requested",
    };
  }

  if (!existsSync(expanded)) {
    return {
      ok: true,
      message: `${settingsOutcome} No directory existed at ${expanded}; nothing to delete.`,
      settingsChanged,
      removedEntries,
      diskOutcome: "absent",
    };
  }

  const sentinel = path.join(expanded, SENTINEL_FILE);
  if (!existsSync(sentinel)) {
    return {
      ok: false,
      message: `${settingsOutcome} Refusing to delete existing directory ${expanded}: missing ${SENTINEL_FILE}.`,
      settingsChanged,
      removedEntries,
      diskOutcome: "retained-unmanaged",
    };
  }

  try {
    rmSync(expanded, { recursive: true, force: true });
    return {
      ok: true,
      message: `${settingsOutcome} Deleted managed directory ${expanded}.`,
      settingsChanged,
      removedEntries,
      diskOutcome: "deleted",
    };
  } catch (err) {
    return {
      ok: false,
      message: `${settingsOutcome} Directory deletion failed: ${err instanceof Error ? err.message : String(err)}`,
      settingsChanged,
      removedEntries,
      diskOutcome: "delete-failed",
    };
  }
}

// -------------------------------------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------------------------------------

interface SpawnResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string },
) => Pick<ChildProcess, "stdout" | "stderr" | "on">;

function runGit(
  args: readonly string[],
  opts: { cwd: string; spawn?: SpawnFn },
): Promise<SpawnResult> {
  const spawn = opts.spawn ?? (realSpawn as unknown as SpawnFn);
  return new Promise((resolve) => {
    let child: ReturnType<SpawnFn>;
    try {
      child = spawn("git", args, { cwd: opts.cwd });
    } catch (err) {
      resolve({
        success: false,
        exitCode: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (err: Error) => {
      resolve({ success: false, exitCode: null, stdout, stderr: stderr || err.message });
    });
    child.on("close", (code: number | null) => {
      resolve({ success: code === 0, exitCode: code, stdout, stderr });
    });
  });
}

function readSkillsArray(settingsPath: string): string[] {
  if (!existsSync(settingsPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const skills = (parsed as Record<string, unknown>).skills;
    return Array.isArray(skills) ? skills.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function expandPath(value: string): string {
  if (value.startsWith("~/")) {
    return path.join(process.env.HOME ?? "", value.slice(2));
  }
  if (value === "~") return process.env.HOME ?? "";
  return path.resolve(value);
}

function isDirectory(absolute: string): boolean {
  try {
    return statSync(absolute).isDirectory();
  } catch {
    return false;
  }
}

function resolveConfiguredPath(settingsValue: string, cwd?: string): string {
  if (settingsValue.startsWith("~/")) {
    return path.join(process.env.HOME ?? "", settingsValue.slice(2));
  }
  if (settingsValue === "~") return process.env.HOME ?? "";
  if (settingsValue.startsWith("./") || !path.isAbsolute(settingsValue)) {
    return path.resolve(cwd ?? process.env.HOME ?? "", settingsValue);
  }
  return settingsValue;
}

function resolvesToSamePath(settingsValue: string, target: string, cwd?: string): boolean {
  return path.normalize(resolveConfiguredPath(settingsValue, cwd)) === path.normalize(target);
}

function isSameOrDescendant(candidate: string, root: string): boolean {
  const relative = path.relative(path.normalize(root), path.normalize(candidate));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function portableLinkValue(input: string, scope: SkillSourceScope, cwd?: string): string {
  // Preserve ~/... if the user typed it; otherwise use the absolute form
  // so the resolution is unambiguous in the settings file.
  if (input.startsWith("~/") || input === "~") return input;
  if (scope === "project" && cwd) {
    const abs = path.resolve(cwd, input);
    const rel = path.relative(cwd, abs);
    if (!rel.startsWith("..")) return `./${rel}`.replace(/\/+$/, "");
  }
  return path.resolve(input);
}
