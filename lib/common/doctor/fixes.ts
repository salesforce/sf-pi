/* SPDX-License-Identifier: Apache-2.0 */
/** Non-destructive sf-pi doctor repair helpers. */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { globalAgentPath, globalSettingsPath } from "../pi-paths.ts";
import { updateSkillSources } from "../skill-sources/skill-sources.ts";
import { runDoctorDiagnostics } from "./diagnostics.ts";
import type { DoctorFixOptions, DoctorFixResult, SkillCollision, SkillLocation } from "./types.ts";

export function applyDoctorFixes(options: DoctorFixOptions = {}): DoctorFixResult {
  const home = options.home ?? os.homedir();
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const report = runDoctorDiagnostics({ cwd, home });
  const result: DoctorFixResult = { changed: false, messages: [], quarantinedSkills: [] };

  if (options.fixStartup) {
    const changed = repairStartupSettings();
    if (changed) {
      result.changed = true;
      result.messages.push("Enabled quiet/header startup in global settings.");
    } else {
      result.messages.push("Startup settings already use quiet/header mode.");
    }
  }

  if (options.fixStaleSkillPaths && report.staleSkillPaths.length > 0) {
    updateSkillSources({
      add: [],
      remove: report.staleSkillPaths.map((entry) => entry.raw),
      home,
    });
    result.changed = true;
    result.messages.push(`Pruned ${report.staleSkillPaths.length} stale skills[] path(s).`);
  }

  if (options.fixSkillLinks && report.availableSkillRoots.length > 0) {
    updateSkillSources({
      add: report.availableSkillRoots.map((root) => root.settingsPath),
      remove: [],
      home,
    });
    result.changed = true;
    result.messages.push(
      `Linked ${report.availableSkillRoots.length} available external skill root(s).`,
    );
  }

  if (options.fixSkills && report.skillCollisions.length > 0) {
    const quarantine = quarantineDuplicateSalesforceSkills(report.skillCollisions, now);
    if (quarantine.moved.length > 0) {
      result.changed = true;
      result.quarantineDir = quarantine.dir;
      result.quarantinedSkills.push(...quarantine.moved);
      result.messages.push(
        `Moved ${quarantine.moved.length} duplicate Salesforce skill(s) to quarantine.`,
      );
    }
    if (quarantine.skippedNonSalesforce > 0) {
      result.messages.push(
        `Left ${quarantine.skippedNonSalesforce} non-Salesforce duplicate skill(s) untouched.`,
      );
    }
  }

  if (result.messages.length === 0) {
    result.messages.push("No doctor fixes were needed.");
  }
  return result;
}

export function repairStartupSettings(settingsFile: string = globalSettingsPath()): boolean {
  const settings = readJsonObject(settingsFile);
  const before = JSON.stringify(settings);
  const sfPi = readObject(settings.sfPi);
  const welcome = readObject(sfPi.welcome);

  settings.quietStartup = true;
  settings.sfPi = {
    ...sfPi,
    welcome: {
      ...welcome,
      mode: "header",
    },
  };

  if (JSON.stringify(settings) === before) return false;
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return true;
}

function quarantineDuplicateSalesforceSkills(
  collisions: SkillCollision[],
  now: Date,
): {
  dir: string;
  moved: Array<{ name: string; from: string; to: string }>;
  skippedNonSalesforce: number;
} {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const quarantineDir = globalAgentPath("skills-quarantine", stamp);
  const moved: Array<{ name: string; from: string; to: string }> = [];
  let skippedNonSalesforce = 0;

  for (const collision of collisions) {
    if (!collision.name.startsWith("sf-")) {
      skippedNonSalesforce += collision.duplicates.length;
      continue;
    }
    for (const duplicate of collision.duplicates) {
      if (!isSafeToQuarantine(duplicate)) continue;
      const source = skillMoveSource(duplicate);
      if (!source || !existsSync(source)) continue;
      const destination = uniqueDestination(path.join(quarantineDir, path.basename(source)));
      mkdirSync(path.dirname(destination), { recursive: true });
      renameSync(source, destination);
      moved.push({ name: collision.name, from: source, to: destination });
    }
  }

  if (moved.length > 0) {
    writeFileSync(
      path.join(quarantineDir, "manifest.json"),
      `${JSON.stringify(
        {
          createdAt: now.toISOString(),
          reason: "duplicate skill names",
          moved,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  return { dir: quarantineDir, moved, skippedNonSalesforce };
}

function isSafeToQuarantine(location: SkillLocation): boolean {
  // Only move duplicate files from pi-owned skill roots. External harness
  // folders are user-owned sources of truth; leave those untouched.
  return location.rootKind === "pi" || location.rootKind === "agents";
}

function skillMoveSource(location: SkillLocation): string | undefined {
  const parent = path.dirname(location.file);
  try {
    if (statSync(parent).isDirectory() && path.basename(location.file) === "SKILL.md")
      return parent;
    if (statSync(location.file).isFile()) return location.file;
  } catch {
    return undefined;
  }
  return undefined;
}

function uniqueDestination(base: string): string {
  if (!existsSync(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!existsSync(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
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
