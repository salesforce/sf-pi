/* SPDX-License-Identifier: Apache-2.0 */
/** First-turn readiness warning for managed skills that declare MCP services. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { EntryRenderer, ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import type { HumanOnlyCommandOutput } from "../../../lib/common/human-only-command-output.ts";
import { resolveUiGlyphs } from "../../../lib/common/ui-glyphs.ts";
import { parseFrontmatter } from "./invocation/frontmatter.ts";

export const MCP_STATUS_EVENT = "pi-mcp-adapter/status/v1";
export const MCP_READINESS_ENTRY_TYPE = "sf-skills-mcp-readiness";

const COLLAPSED_SKILL_LIMIT = 3;

export interface ContextSkill {
  name: string;
  filePath: string;
  disableModelInvocation?: boolean;
}

export interface McpServiceRequirement {
  name: string;
  tools: string[];
  semver?: string;
}

export interface ManagedMcpSkill {
  name: string;
  filePath: string;
  services: McpServiceRequirement[];
}

export interface McpReadinessEntry extends HumanOnlyCommandOutput {
  adapterInstalled: boolean;
  missingServices: string[];
  skills: ManagedMcpSkill[];
}

export interface McpStatusSnapshot {
  version: number;
  servers: ReadonlyArray<{ name: string; disabled?: boolean }>;
}

export function parseDeclaredMcpServices(raw: string): McpServiceRequirement[] {
  const document = parseFrontmatter(raw);
  if (!document.hasFrontmatter) return [];

  const lines = document.frontmatterText.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*mcpTools\s*:\s*$/.test(line));
  if (start < 0) return [];

  const baseIndent = indentation(lines[start] ?? "");
  const relevant = lines.slice(start + 1).filter((line) => {
    const trimmed = line.trim();
    return !trimmed || trimmed.startsWith("#") || indentation(line) > baseIndent;
  });
  const serverIndent = relevant
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map(indentation)
    .reduce<number | undefined>(
      (smallest, value) => (smallest === undefined || value < smallest ? value : smallest),
      undefined,
    );
  if (serverIndent === undefined) return [];

  const services: McpServiceRequirement[] = [];
  let current: McpServiceRequirement | undefined;
  let toolsIndent: number | undefined;

  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = indentation(line);
    if (indent <= baseIndent) break;

    if (indent === serverIndent) {
      const name = yamlKey(trimmed);
      if (!name) continue;
      current = { name, tools: [] };
      services.push(current);
      toolsIndent = undefined;
      continue;
    }
    if (!current) continue;

    const toolsMatch = trimmed.match(/^tools\s*:\s*(.*)$/);
    if (toolsMatch) {
      current.tools = parseToolsValue(toolsMatch[1] ?? "");
      toolsIndent = toolsMatch[1]?.trim() ? undefined : indent;
      continue;
    }

    if (toolsIndent !== undefined && indent > toolsIndent) {
      const item = trimmed.match(/^-\s*(.+)$/)?.[1];
      if (item) {
        current.tools.push(yamlScalar(item));
        continue;
      }
    }
    toolsIndent = undefined;

    const semver = trimmed.match(/^semver\s*:\s*(.+)$/)?.[1];
    if (semver) current.semver = yamlScalar(semver);
  }

  return services;
}

export function parseDeclaredMcpServers(raw: string): string[] {
  return parseDeclaredMcpServices(raw).map((service) => service.name);
}

export function collectVisibleManagedMcpSkills(
  skills: readonly ContextSkill[],
  readSkill: (filePath: string) => string = (filePath) => readFileSync(filePath, "utf8"),
): ManagedMcpSkill[] {
  const out: ManagedMcpSkill[] = [];

  for (const skill of skills) {
    if (skill.disableModelInvocation || !isManagedEffectiveSkill(skill.filePath)) continue;
    try {
      const services = parseDeclaredMcpServices(readSkill(skill.filePath));
      if (services.length > 0) out.push({ name: skill.name, filePath: skill.filePath, services });
    } catch {
      // Readiness is advisory; an unreadable skill must not block the turn.
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function configuredMcpServerNames(snapshot: McpStatusSnapshot): Set<string> {
  return new Set(
    snapshot.servers
      .filter((server) => server.disabled !== true)
      .map((server) => server.name)
      .filter(Boolean),
  );
}

export function isMcpStatusSnapshot(value: unknown): value is McpStatusSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<McpStatusSnapshot>;
  return snapshot.version === 1 && Array.isArray(snapshot.servers);
}

export function buildMcpReadinessWarning(
  skills: readonly ManagedMcpSkill[],
  configuredServers: ReadonlySet<string>,
  adapterInstalled: boolean,
): McpReadinessEntry | undefined {
  if (skills.length === 0) return undefined;

  const affectedSkills = skills
    .map((skill) => ({
      ...skill,
      services: adapterInstalled
        ? skill.services.filter((service) => !configuredServers.has(service.name))
        : [...skill.services],
    }))
    .filter((skill) => skill.services.length > 0);
  if (affectedSkills.length === 0) return undefined;

  const missingServices = [
    ...new Set(affectedSkills.flatMap((skill) => skill.services.map((service) => service.name))),
  ].sort();
  const summary = readinessSummary(affectedSkills.length, adapterInstalled);

  return {
    title: "Salesforce Skill Readiness",
    body: [
      summary,
      `Missing: ${missingServices.join(", ")}`,
      adapterInstalled
        ? "/mcp setup · /sf-skills toggle"
        : "/sf-pi recommended · /sf-skills toggle",
    ].join("\n"),
    severity: "warning",
    adapterInstalled,
    missingServices,
    skills: affectedSkills,
  };
}

export function registerMcpReadinessRenderer(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<McpReadinessEntry>(
    MCP_READINESS_ENTRY_TYPE,
    createMcpReadinessRenderer(),
  );
}

export function createMcpReadinessRenderer(): EntryRenderer<McpReadinessEntry> {
  return (entry, options, theme) => {
    const data = entry.data;
    if (!data) return new Text(theme.fg("warning", "Salesforce Skill Readiness"), 0, 0);

    const glyphs = resolveUiGlyphs(process.cwd());
    const icons = readinessIcons(glyphs.mode);
    const lines = options.expanded
      ? renderExpanded(data, theme, icons, glyphs)
      : renderCollapsed(data, theme, icons, glyphs);
    const box = new Box(1, 0, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(lines.join("\n"), 0, 0));
    return box;
  };
}

function renderCollapsed(
  data: McpReadinessEntry,
  theme: Theme,
  icons: ReadinessIcons,
  glyphs: ReturnType<typeof resolveUiGlyphs>,
): string[] {
  const lines = [
    theme.fg("warning", theme.bold(`${glyphs.warning}  Salesforce Skill Readiness`)),
    "",
    theme.fg("text", readinessSummary(data.skills.length, data.adapterInstalled)),
    "",
  ];

  for (const skill of data.skills.slice(0, COLLAPSED_SKILL_LIMIT)) {
    lines.push(theme.fg("accent", `${icons.skill}  ${skill.name}`));
    for (const service of skill.services) {
      lines.push(
        `   ${icons.service} Service   ${theme.fg("text", service.name)}  ${theme.fg("error", `${glyphs.error} Not configured`)}`,
      );
      lines.push(`   ${icons.tools} Tools     ${theme.fg("text", toolList(service.tools))}`);
    }
    lines.push(`   ${icons.source} Source    ${theme.fg("dim", shortenHomePath(skill.filePath))}`);
    lines.push("");
  }
  if (data.skills.length > COLLAPSED_SKILL_LIMIT) {
    lines.push(theme.fg("dim", `… and ${data.skills.length - COLLAPSED_SKILL_LIMIT} more`));
    lines.push("");
  }

  lines.push(...renderActions(data, theme, icons));
  lines.push("");
  lines.push(theme.fg("dim", `No changes were made automatically. ${expandDetailsHint()}`));
  return lines;
}

function renderExpanded(
  data: McpReadinessEntry,
  theme: Theme,
  icons: ReadinessIcons,
  glyphs: ReturnType<typeof resolveUiGlyphs>,
): string[] {
  const lines = [
    theme.fg("warning", theme.bold(`${glyphs.warning}  Salesforce Skill Readiness — Details`)),
    "",
    theme.fg("text", readinessSummary(data.skills.length, data.adapterInstalled)),
    "",
    theme.fg("accent", theme.bold(`${icons.config} Declared MCP configuration`)),
  ];

  for (const skill of data.skills) {
    lines.push("");
    lines.push(theme.fg("accent", `${icons.skill} Skill      ${skill.name}`));
    lines.push(`   ${icons.source} Source     ${theme.fg("dim", shortenHomePath(skill.filePath))}`);
    for (const service of skill.services) {
      lines.push(`   ${icons.service} Service    ${theme.fg("text", service.name)}`);
      lines.push(`   ${icons.tools} Tools      ${theme.fg("text", toolList(service.tools))}`);
      if (service.semver) {
        lines.push(`   ${icons.version} Version    ${theme.fg("text", service.semver)}`);
      }
    }
  }

  lines.push("");
  lines.push(theme.fg("accent", theme.bold(`${icons.status} Current MCP status`)));
  for (const service of data.missingServices) {
    lines.push(
      `   ${icons.service} ${service}  ${theme.fg("error", `${glyphs.error} Not configured`)}`,
    );
  }
  lines.push("");
  lines.push(theme.fg("muted", divider(glyphs.mode)));
  lines.push("");

  if (data.adapterInstalled) {
    lines.push(theme.fg("accent", theme.bold(`${icons.setup} What /mcp setup does`)));
    lines.push("   Opens guided MCP setup. It can:");
    lines.push("   • show existing MCP configuration sources;");
    lines.push("   • import, add, or enable an MCP server;");
    lines.push("   • preview configuration changes before writing them.");
    lines.push("   MCP servers remain lazy and connect only when their tools are needed.");
  } else {
    lines.push(theme.fg("accent", theme.bold(`${icons.setup} What /sf-pi recommended does`)));
    lines.push("   Opens the recommended-package installer so you can review and install");
    lines.push("   an MCP adapter. After installation, use /mcp setup to configure servers.");
  }

  lines.push("");
  lines.push(theme.fg("muted", divider(glyphs.mode)));
  lines.push("");
  lines.push(theme.fg("accent", theme.bold(`${icons.toggle} What /sf-skills toggle does`)));
  lines.push("   Agent-invocable — advertises the skill to the model in every session.");
  lines.push("   Manual-only      — keeps it out of automatic context while preserving");
  lines.push("                      explicit /skill:name access.");
  lines.push("   Saving updates the managed effective tree and reloads Pi.");
  lines.push("");
  lines.push(...renderActions(data, theme, icons));
  lines.push("");
  lines.push(theme.fg("dim", "No changes were made automatically."));
  return lines;
}

function renderActions(data: McpReadinessEntry, theme: Theme, icons: ReadinessIcons): string[] {
  const skillLabel = data.skills.length === 1 ? "this skill" : "these skills";
  return data.adapterInstalled
    ? [
        `${icons.action} Configure the missing MCP service      ${theme.fg("accent", "/mcp setup")}`,
        `${icons.action} Keep ${skillLabel} out of automatic context ${theme.fg("accent", "/sf-skills toggle")}`,
      ]
    : [
        `${icons.action} Install the recommended MCP adapter     ${theme.fg("accent", "/sf-pi recommended")}`,
        `${icons.action} Keep ${skillLabel} out of automatic context ${theme.fg("accent", "/sf-skills toggle")}`,
      ];
}

interface ReadinessIcons {
  skill: string;
  service: string;
  tools: string;
  source: string;
  config: string;
  status: string;
  setup: string;
  toggle: string;
  version: string;
  action: string;
}

function readinessIcons(mode: "emoji" | "ascii"): ReadinessIcons {
  return mode === "ascii"
    ? {
        skill: "[skill]",
        service: "[mcp]",
        tools: "[tools]",
        source: "[file]",
        config: "[config]",
        status: "[status]",
        setup: "[setup]",
        toggle: "[toggle]",
        version: "[version]",
        action: ">",
      }
    : {
        skill: "🧩",
        service: "🔌",
        tools: "🛠",
        source: "📄",
        config: "⚙",
        status: "◆",
        setup: "🔧",
        toggle: "🎚",
        version: "◇",
        action: "→",
      };
}

function readinessSummary(skillCount: number, adapterInstalled: boolean): string {
  if (!adapterInstalled) {
    return `${countLabel(skillCount, "skill")} may fail or have reduced functionality because an MCP adapter is not installed.`;
  }
  if (skillCount === 1) {
    return "1 skill may fail or have reduced functionality because an MCP service it declares is not configured.";
  }
  return `${skillCount} skills may fail or have reduced functionality because declared MCP services are not configured.`;
}

function toolList(tools: readonly string[]): string {
  return tools.length > 0 ? tools.join(", ") : "(not declared)";
}

function shortenHomePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const home = homedir().replace(/\\/g, "/").replace(/\/$/, "");
  return normalized === home || normalized.startsWith(`${home}/`)
    ? `~${normalized.slice(home.length)}`
    : normalized;
}

function divider(mode: "emoji" | "ascii"): string {
  return (mode === "ascii" ? "-" : "━").repeat(60);
}

function expandDetailsHint(): string {
  try {
    return keyHint("app.tools.expand", "more details");
  } catch {
    return "[expand] more details";
  }
}

function yamlKey(value: string): string | undefined {
  const key = value.match(/^([^:#][^:]*):(?:\s|$)/)?.[1]?.trim();
  return key ? yamlScalar(key) : undefined;
}

function parseToolsValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => yamlScalar(item))
      .filter(Boolean);
  }
  return [yamlScalar(trimmed)].filter(Boolean);
}

function yamlScalar(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

function isManagedEffectiveSkill(filePath: string): boolean {
  return filePath.replace(/\\/g, "/").includes("/sf-skills/effective/skills/");
}

function indentation(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
