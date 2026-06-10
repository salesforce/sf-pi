/* SPDX-License-Identifier: Apache-2.0 */
/**
 * forcedotcom/afv-library install / update / link / unlink.
 *
 * Why this module exists
 * ----------------------
 * The Salesforce community publishes a curated skill library at
 * `forcedotcom/afv-library`. Users who want those skills should not have
 * to clone manually and edit `settings.json` by hand. This module owns
 * that lifecycle:
 *
 *   install : git clone the repo into a managed dir + wire it into settings
 *   update  : git pull --ff-only on managed dirs only (sentinel-gated)
 *   link    : wire a user-owned checkout (e.g. ~/work/afv-library) into settings
 *   unlink  : remove a wired entry; --delete only valid on managed dirs
 *   status  : report every known managed/linked checkout
 *
 * Native settings, no shadow state
 * --------------------------------
 * The clone target is intentionally OUTSIDE pi's auto-discovery roots
 * (`~/.pi/agent/skills/` etc.) so that pi only loads what we explicitly
 * write into `settings.skills[]`. That keeps enable/disable a single
 * native knob: a path is in settings, or it isn't.
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

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

const REPO_URL = "https://github.com/forcedotcom/afv-library";
const REPO_DIR_NAME = "afv-library";
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
 * Global: `~/.pi/agent/sf-skills/afv-library/`
 * Project: `<cwd>/.pi/sf-skills/afv-library/`
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

/** Settings value (portable form) we write for the managed clone's skills/ dir. */
export function managedSettingsValue(scope: SkillSourceScope): string {
  // Global lives under ~/.pi/agent/, so the canonical value uses "~/" so the
  // settings file stays portable across machines. Project paths are
  // relative to cwd and pi resolves them per project settings.
  return scope === "project"
    ? `./.pi/sf-skills/${REPO_DIR_NAME}/${SKILLS_SUBDIR}`
    : `~/.pi/agent/sf-skills/${REPO_DIR_NAME}/${SKILLS_SUBDIR}`;
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
    const detection = detectSkillSources({ cwd, includeProject: scope === "project" });
    const settingsPath =
      scope === "project" ? detection.projectSettingsPath : detection.settingsPath;
    if (settingsPath) {
      const skills = readSkillsArray(settingsPath);
      wired = skills.some((value) => resolvesToSamePath(value, skillsPath, cwd));
    }
  }

  return { rootPath, skillsPath, settingsValue, scope, exists, managed, wired };
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
 * Ensure the afv-library clone exists (once, globally) and wire it into the
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

  const alreadyWired = isManagedWired(wireScope, options.cwd, content.skillsPath);
  if (!alreadyWired) {
    updateSkillSources({
      add: [settingsValue],
      remove: [],
      scope: wireScope,
      cwd: options.cwd,
    });
  }

  // Report state: global content clone, wired-status reflecting the wire scope.
  const next = inspectManagedClone("global");
  const clone: ManagedClone = {
    ...next,
    scope: wireScope,
    settingsValue,
    wired: isManagedWired(wireScope, options.cwd, content.skillsPath),
  };
  const wiredVerb = alreadyWired ? "still wired" : "now wired";
  return {
    ok: true,
    clone,
    message: content.exists
      ? `Already cloned at ${next.rootPath}; ${wiredVerb} in ${wireScope} settings.`
      : `Cloned afv-library into ${next.rootPath} and wired it in ${wireScope} settings.`,
  };
}

/** Is the managed skills dir wired in the given scope's settings? */
function isManagedWired(
  scope: SkillSourceScope,
  cwd: string | undefined,
  skillsPath: string,
): boolean {
  const detection = detectSkillSources({ cwd, includeProject: scope === "project" });
  const settingsPath = scope === "project" ? detection.projectSettingsPath : detection.settingsPath;
  if (!settingsPath) return false;
  return readSkillsArray(settingsPath).some((value) => resolvesToSamePath(value, skillsPath, cwd));
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
 * Fast-forward update on a managed clone. Refuses to touch a non-managed
 * checkout (no sentinel) — those are the user's working tree.
 */
export async function updateDefaults(options: UpdateOptions): Promise<UpdateResult> {
  const clone = inspectManagedClone(options.scope, options.cwd);
  if (!clone.exists) {
    return {
      ok: false,
      clone,
      message: "No managed afv-library clone found. Run install first.",
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
  const result = await runGit(["pull", "--ff-only"], {
    cwd: clone.rootPath,
    spawn: options.spawn,
  });
  return {
    ok: result.success,
    clone,
    message: result.success
      ? "Pulled latest afv-library."
      : `git pull failed: ${result.stderr || result.stdout || "unknown error"}`,
    output: `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`,
  };
}

// -------------------------------------------------------------------------------------------------
// Link / unlink
// -------------------------------------------------------------------------------------------------

export interface LinkOptions {
  /** Absolute or `~`-prefixed path to a user-owned afv-library checkout. */
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
      message: `Expected a 'skills/' subdir inside ${expanded}; this does not look like an afv-library checkout.`,
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

export function unlinkCheckout(options: UnlinkOptions): { ok: boolean; message: string } {
  const expanded = expandPath(options.target);
  updateSkillSources({
    add: [],
    remove: [options.target, expanded, `${expanded}/${SKILLS_SUBDIR}`],
    scope: options.scope,
    cwd: options.cwd,
  });

  if (options.deleteOnDisk) {
    const sentinel = path.join(expanded, SENTINEL_FILE);
    if (!existsSync(sentinel)) {
      return {
        ok: false,
        message: `Refusing to delete ${expanded}: missing ${SENTINEL_FILE}. Settings entry was still removed.`,
      };
    }
    try {
      rmSync(expanded, { recursive: true, force: true });
      return { ok: true, message: `Unlinked and deleted ${expanded}.` };
    } catch (err) {
      return {
        ok: false,
        message: `Settings entry removed, but rm failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return { ok: true, message: `Unlinked ${options.target} from ${options.scope} settings.` };
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

function resolvesToSamePath(settingsValue: string, target: string, cwd?: string): boolean {
  const expanded = settingsValue.startsWith("~/")
    ? path.join(process.env.HOME ?? "", settingsValue.slice(2))
    : settingsValue.startsWith("./") || !path.isAbsolute(settingsValue)
      ? path.resolve(cwd ?? process.env.HOME ?? "", settingsValue)
      : settingsValue;
  return path.normalize(expanded) === path.normalize(target);
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
