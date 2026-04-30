/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Skill state reconstruction for the SF Skills HUD.
 *
 * Source of truth:
 * - discovered skill commands from pi.getCommands()
 * - current branch entries from ctx.sessionManager.getBranch()
 * - current LLM context from buildSessionContext(...)
 *
 * Why derive instead of persisting:
 * - reload-safe
 * - compaction-safe
 * - branch-switch-safe
 * - no hidden extension state to reconcile
 */
import path from "node:path";
import {
  parseSkillBlock,
  type SessionContext,
  type SessionEntry,
  type SlashCommandInfo,
} from "@mariozechner/pi-coding-agent";

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

export type SkillEvidence = "explicit" | "read";

export type SkillUsage = {
  /** Stable skill identifier, e.g. sf-apex. */
  name: string;
  /** Slash command name if skill commands are enabled, e.g. skill:sf-apex. */
  commandName?: string;
  /** Resolved skill file path when known. */
  filePath?: string;
  /** How the skill was detected in the session. */
  evidence: SkillEvidence[];
  /** Higher means more recently observed in the scanned message list. */
  lastSeenIndex: number;
};

export type SkillsHudState = {
  live: SkillUsage[];
  earlier: SkillUsage[];
  hasAny: boolean;
  discoveredCount: number;
  usedCount: number;
};

type SkillDescriptor = {
  name: string;
  commandName?: string;
  filePath?: string;
};

type SkillInventory = {
  discoveredCount: number;
  byName: Map<string, SkillDescriptor>;
  byFilePath: Map<string, SkillDescriptor>;
};

type SessionMessage = SessionContext["messages"][number];

type MutableUsage = SkillUsage & {
  evidenceSet: Set<SkillEvidence>;
};

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

export function buildSkillsHudState(options: {
  branchEntries: SessionEntry[];
  sessionContext: SessionContext;
  commands: SlashCommandInfo[];
  cwd: string;
}): SkillsHudState {
  const inventory = buildSkillInventory(options.commands, options.cwd);
  const branchUsage = collectSkillsFromBranchEntries(options.branchEntries, inventory, options.cwd);
  const liveUsage = collectSkillsFromMessages(
    options.sessionContext.messages,
    inventory,
    options.cwd,
  );

  const live = sortUsages(liveUsage.values());
  const earlier = sortUsages(
    [...branchUsage.values()].filter((usage) => {
      return !liveUsage.has(usage.name);
    }),
  );

  return {
    live,
    earlier,
    hasAny: live.length > 0 || earlier.length > 0,
    discoveredCount: inventory.discoveredCount,
    usedCount: live.length + earlier.length,
  };
}

export function formatSkillsHudSummary(state: SkillsHudState): string[] {
  if (!state.hasAny) {
    return [
      "SF Skills HUD",
      "",
      "No skill usage detected on the current session branch yet.",
      state.discoveredCount > 0
        ? `${state.discoveredCount} skill command(s) are available for explicit invocation.`
        : "Skill commands are not currently discoverable via pi.getCommands().",
    ];
  }

  const lines = ["SF Skills HUD", ""];

  if (state.live.length > 0) {
    lines.push(`Live now: ${state.live.map((skill) => skill.name).join(", ")}`);
  }

  if (state.earlier.length > 0) {
    lines.push(`Earlier: ${state.earlier.map((skill) => skill.name).join(", ")}`);
  }

  lines.push("");
  lines.push(`Used skills: ${state.usedCount}`);
  lines.push(`Discovered skill commands: ${state.discoveredCount}`);

  return lines;
}

export function buildSkillInventory(commands: SlashCommandInfo[], cwd: string): SkillInventory {
  const byName = new Map<string, SkillDescriptor>();
  const byFilePath = new Map<string, SkillDescriptor>();

  for (const command of commands) {
    if (command.source !== "skill") {
      continue;
    }

    const name = deriveSkillNameFromCommand(command);
    const filePath = normalizePathForLookup(command.sourceInfo.path, cwd);
    const descriptor: SkillDescriptor = {
      name,
      commandName: command.name,
      filePath,
    };

    if (!byName.has(name)) {
      byName.set(name, descriptor);
    }

    if (filePath && !byFilePath.has(filePath)) {
      byFilePath.set(filePath, descriptor);
    }
  }

  return {
    discoveredCount: byName.size,
    byName,
    byFilePath,
  };
}

// -------------------------------------------------------------------------------------------------
// Branch/context scanning
// -------------------------------------------------------------------------------------------------

function collectSkillsFromBranchEntries(
  entries: SessionEntry[],
  inventory: SkillInventory,
  cwd: string,
): Map<string, SkillUsage> {
  const messages = entries
    .filter(
      (entry): entry is Extract<SessionEntry, { type: "message" }> => entry.type === "message",
    )
    .map((entry) => entry.message as SessionMessage);

  return collectSkillsFromMessages(messages, inventory, cwd);
}

function collectSkillsFromMessages(
  messages: readonly SessionMessage[],
  inventory: SkillInventory,
  cwd: string,
): Map<string, SkillUsage> {
  const usageByName = new Map<string, MutableUsage>();

  messages.forEach((message, messageIndex) => {
    const explicitSkill = extractExplicitSkillFromMessage(message, inventory);
    if (explicitSkill) {
      recordSkillUsage(usageByName, explicitSkill, "explicit", messageIndex);
    }

    for (const readSkill of extractReadSkillsFromMessage(message, inventory, cwd)) {
      recordSkillUsage(usageByName, readSkill, "read", messageIndex);
    }
  });

  const result = new Map<string, SkillUsage>();
  for (const [name, usage] of usageByName) {
    result.set(name, {
      name: usage.name,
      commandName: usage.commandName,
      filePath: usage.filePath,
      evidence: [...usage.evidenceSet].sort(),
      lastSeenIndex: usage.lastSeenIndex,
    });
  }

  return result;
}

function extractExplicitSkillFromMessage(
  message: SessionMessage,
  inventory: SkillInventory,
): SkillDescriptor | null {
  if ((message as { role?: string }).role !== "user") {
    return null;
  }

  const text = extractTextContent((message as { content?: unknown }).content);
  if (!text) {
    return null;
  }

  const skillBlock = parseSkillBlock(text);
  if (!skillBlock) {
    return null;
  }

  return resolveSkillDescriptor({ skillName: skillBlock.name }, inventory);
}

function extractReadSkillsFromMessage(
  message: SessionMessage,
  inventory: SkillInventory,
  cwd: string,
): SkillDescriptor[] {
  if ((message as { role?: string }).role !== "assistant") {
    return [];
  }

  const rawContent = (message as { content?: unknown }).content;
  const content = Array.isArray(rawContent)
    ? rawContent.filter((block): block is Record<string, unknown> => {
        return !!block && typeof block === "object";
      })
    : [];

  const descriptors: SkillDescriptor[] = [];

  for (const block of content) {
    if (block?.type !== "toolCall" || block.name !== "read") {
      continue;
    }

    const args =
      block.arguments && typeof block.arguments === "object"
        ? (block.arguments as Record<string, unknown>)
        : undefined;
    const rawPath =
      typeof args?.path === "string"
        ? args.path
        : typeof args?.filePath === "string"
          ? args.filePath
          : undefined;

    if (!rawPath) {
      continue;
    }

    const descriptor = resolveSkillDescriptor({ skillPath: rawPath }, inventory, cwd);
    if (descriptor) {
      descriptors.push(descriptor);
    }
  }

  return descriptors;
}

function recordSkillUsage(
  usageByName: Map<string, MutableUsage>,
  skill: SkillDescriptor,
  evidence: SkillEvidence,
  lastSeenIndex: number,
): void {
  const existing = usageByName.get(skill.name);
  if (existing) {
    existing.lastSeenIndex = lastSeenIndex;
    existing.commandName ??= skill.commandName;
    existing.filePath ??= skill.filePath;
    existing.evidenceSet.add(evidence);
    return;
  }

  usageByName.set(skill.name, {
    name: skill.name,
    commandName: skill.commandName,
    filePath: skill.filePath,
    evidence: [evidence],
    evidenceSet: new Set([evidence]),
    lastSeenIndex,
  });
}

function sortUsages(usages: Iterable<SkillUsage>): SkillUsage[] {
  return [...usages].sort((left, right) => {
    if (right.lastSeenIndex !== left.lastSeenIndex) {
      return right.lastSeenIndex - left.lastSeenIndex;
    }
    return left.name.localeCompare(right.name);
  });
}

// -------------------------------------------------------------------------------------------------
// Skill resolution helpers
// -------------------------------------------------------------------------------------------------

function resolveSkillDescriptor(
  input: { skillName?: string; skillPath?: string },
  inventory: SkillInventory,
  cwd?: string,
): SkillDescriptor | null {
  if (input.skillName) {
    return inventory.byName.get(input.skillName) ?? { name: input.skillName };
  }

  if (!input.skillPath || !cwd) {
    return null;
  }

  const normalizedPath = normalizePathForLookup(input.skillPath, cwd);
  if (!normalizedPath) {
    return null;
  }

  const knownSkill = inventory.byFilePath.get(normalizedPath);
  if (knownSkill) {
    return knownSkill;
  }

  const inferredName = inferSkillNameFromPath(normalizedPath);
  if (!inferredName) {
    return null;
  }

  return inventory.byName.get(inferredName) ?? { name: inferredName, filePath: normalizedPath };
}

function deriveSkillNameFromCommand(command: SlashCommandInfo): string {
  if (command.name.startsWith("skill:")) {
    return command.name.slice("skill:".length);
  }

  const fromPath = inferSkillNameFromPath(command.sourceInfo.path);
  if (fromPath) {
    return fromPath;
  }

  return command.name;
}

function inferSkillNameFromPath(rawPath: string | undefined): string | null {
  if (!rawPath) {
    return null;
  }

  const normalized = rawPath.replace(/\\/g, "/");
  const baseName = path.posix.basename(normalized);

  if (baseName.toLowerCase() === "skill.md") {
    return path.posix.basename(path.posix.dirname(normalized));
  }

  return null;
}

function normalizePathForLookup(rawPath: string | undefined, cwd: string): string | undefined {
  if (!rawPath) {
    return undefined;
  }

  const withoutAt = rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
  const resolved = path.isAbsolute(withoutAt) ? withoutAt : path.resolve(cwd, withoutAt);
  const normalized = path.normalize(resolved);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

// -------------------------------------------------------------------------------------------------
// Message helpers
// -------------------------------------------------------------------------------------------------

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((block): block is { type: string; text?: string } => {
      return (
        !!block &&
        typeof block === "object" &&
        "type" in block &&
        (block as { type: string }).type === "text"
      );
    })
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}
