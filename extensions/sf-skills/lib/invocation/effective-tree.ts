/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Global effective tree for managed Salesforce skills.
 *
 * The git clone stays pristine. Pi loads a sibling `effective/skills`
 * copy whose SKILL.md files may carry disable-model-invocation stamps.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { globalAgentPath } from "../../../../lib/common/pi-paths.ts";
import {
  applyInvocationMode,
  classifyInvocationMode,
  parseFrontmatter,
  hasDisableModelInvocation,
} from "./frontmatter.ts";
import { readGlobalInvocationPolicy, resolveInvocationMode } from "./policy.ts";
import type { SkillInvocationMode, SkillInvocationPolicy } from "./types.ts";

const SKILLS_SUBDIR = "skills";

export function managedEffectiveRoot(): string {
  return globalAgentPath("sf-skills", "effective");
}

export function managedEffectiveSkillsPath(): string {
  return path.join(managedEffectiveRoot(), SKILLS_SUBDIR);
}

export function managedEffectiveSettingsValue(): string {
  return "~/.pi/agent/sf-skills/effective/skills";
}

export interface EffectiveSkillRecord {
  name: string;
  relativeDir: string;
  cloneFile: string;
  effectiveFile: string;
  description: string;
  authorDisabled: boolean;
  currentMode: SkillInvocationMode;
  desiredMode: SkillInvocationMode;
}

export interface SyncEffectiveResult {
  copied: number;
  stamped: number;
  skills: EffectiveSkillRecord[];
}

export function listManagedSkillFiles(
  skillsRoot: string,
): Array<{ name: string; relativeDir: string; filePath: string }> {
  if (!existsSync(skillsRoot)) return [];
  const out: Array<{ name: string; relativeDir: string; filePath: string }> = [];
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const filePath = path.join(skillsRoot, entry.name, "SKILL.md");
    if (!existsSync(filePath) || !statSync(filePath).isFile()) continue;
    out.push({ name: skillNameFromFile(filePath, entry.name), relativeDir: entry.name, filePath });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function syncEffectiveSkills(
  cloneSkillsPath: string,
  policy = readGlobalInvocationPolicy(),
): SyncEffectiveResult {
  const effectiveSkillsPath = managedEffectiveSkillsPath();
  mkdirSync(path.dirname(effectiveSkillsPath), { recursive: true });
  if (existsSync(effectiveSkillsPath))
    rmSync(effectiveSkillsPath, { recursive: true, force: true });
  if (existsSync(cloneSkillsPath)) {
    cpSync(cloneSkillsPath, effectiveSkillsPath, { recursive: true });
  } else {
    mkdirSync(effectiveSkillsPath, { recursive: true });
  }

  const cloneFiles = listManagedSkillFiles(cloneSkillsPath);
  let stamped = 0;
  const skills: EffectiveSkillRecord[] = [];
  for (const clone of cloneFiles) {
    const effectiveFile = path.join(effectiveSkillsPath, clone.relativeDir, "SKILL.md");
    const cloneRaw = readFileSync(clone.filePath, "utf8");
    const authorDisabled = hasDisableModelInvocation(parseFrontmatter(cloneRaw));
    const desiredMode = resolveInvocationMode({
      name: clone.name,
      authorDisabled,
      policy,
    });
    let currentRaw: string | undefined;
    try {
      currentRaw = readFileSync(effectiveFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const baseRaw = currentRaw ?? cloneRaw;
    const next = applyInvocationMode(baseRaw, desiredMode);
    if (currentRaw === undefined || next !== currentRaw) {
      mkdirSync(path.dirname(effectiveFile), { recursive: true });
      writeFileSync(effectiveFile, next, "utf8");
      stamped += 1;
    }
    skills.push({
      name: clone.name,
      relativeDir: clone.relativeDir,
      cloneFile: clone.filePath,
      effectiveFile,
      description: readDescription(cloneRaw),
      authorDisabled,
      currentMode: classifyInvocationMode(next),
      desiredMode,
    });
  }
  return { copied: cloneFiles.length, stamped, skills };
}

export function restampEffectiveSkills(
  cloneSkillsPath: string,
  policy: SkillInvocationPolicy = readGlobalInvocationPolicy(),
): SyncEffectiveResult {
  return syncEffectiveSkills(cloneSkillsPath, policy);
}

function skillNameFromFile(filePath: string, fallback: string): string {
  try {
    const raw = readFileSync(filePath, "utf8");
    const match = raw.match(/^name:\s*(.+)$/m);
    return match?.[1]?.trim().replace(/^["']|["']$/g, "") || fallback;
  } catch {
    return fallback;
  }
}

function readDescription(raw: string): string {
  const block = raw.match(/^description:\s*[>|][-+]?\n((?:[ \t].*\n)+)/m);
  if (block?.[1]) {
    return block[1]
      .split("\n")
      .map((line) => line.replace(/^[ \t]{2}/, ""))
      .join("\n")
      .trim();
  }
  const line = raw.match(/^description:\s*(.+)$/m);
  return line?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
}
