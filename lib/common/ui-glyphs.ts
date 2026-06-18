/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Semantic UI glyphs for SF Pi command panels and popups.
 *
 * This sits on top of the shared glyph policy used by the DevBar: rich glyphs
 * on capable terminals, ASCII fallbacks when `SF_PI_ASCII_ICONS=1` or
 * `sfPi.asciiIcons` asks for them.
 */
import { resolveGlyphMode, type GlyphMode } from "./glyph-policy.ts";

export interface UiGlyphs {
  mode: GlyphMode;
  status: string;
  actions: string;
  selected: string;
  setup: string;
  controls: string;
  diagnostics: string;
  discovery: string;
  troubleshooting: string;
  utilities: string;
  reference: string;
  scope: string;
  links: string;
  feedback: string;
  browser: string;
  evidence: string;
  automation: string;
  safety: string;
  data: string;
  agent: string;
  lifecycle: string;
  settings: string;
  codeAnalyzer: string;
  success: string;
  info: string;
  warning: string;
  error: string;
  loading: string;
  selectedRow: string;
}

const RICH: Omit<UiGlyphs, "mode"> = {
  status: "◆",
  actions: "▸",
  selected: "◆",
  setup: "⚙",
  controls: "◉",
  diagnostics: "🩺",
  discovery: "🔎",
  troubleshooting: "🛠",
  utilities: "◧",
  reference: "?",
  scope: "◈",
  links: "🔗",
  feedback: "✎",
  browser: "🌐",
  evidence: "📸",
  automation: "◉",
  safety: "🛡",
  data: "🔎",
  agent: "🤖",
  lifecycle: "◇",
  settings: "⚙",
  codeAnalyzer: "🧪",
  success: "✓",
  info: "ⓘ",
  warning: "⚠",
  error: "✗",
  loading: "◐",
  selectedRow: "→",
};

const ASCII: Omit<UiGlyphs, "mode"> = {
  status: "*",
  actions: ">",
  selected: ">",
  setup: "*",
  controls: "o",
  diagnostics: "!",
  discovery: "?",
  troubleshooting: "!",
  utilities: "+",
  reference: "?",
  scope: "#",
  links: "@",
  feedback: "+",
  browser: "@",
  evidence: "#",
  automation: "o",
  safety: "!",
  data: "?",
  agent: "a",
  lifecycle: "-",
  settings: "*",
  codeAnalyzer: "ca",
  success: "+",
  info: "i",
  warning: "!",
  error: "x",
  loading: "~",
  selectedRow: ">",
};

export function resolveUiGlyphs(cwd: string): UiGlyphs {
  const mode = resolveGlyphMode({ cwd });
  return { mode, ...(mode === "ascii" ? ASCII : RICH) };
}

export function iconForCommandGroup(group: string, glyphs: UiGlyphs): string {
  const normalized = group.trim().toLowerCase();
  if (normalized.includes("scope")) return glyphs.scope;
  if (normalized.includes("lifecycle")) return glyphs.lifecycle;
  if (normalized.includes("setting")) return glyphs.settings;
  if (normalized.includes("automation")) return glyphs.automation;
  if (normalized.includes("apexguru") || normalized.includes("agent")) return glyphs.agent;
  if (normalized.includes("browser")) return glyphs.browser;
  if (normalized.includes("evidence") || normalized.includes("screenshot")) return glyphs.evidence;
  if (
    normalized.includes("safety") ||
    normalized.includes("guardrail") ||
    normalized.includes("approval") ||
    normalized.includes("rule")
  )
    return glyphs.safety;
  if (
    normalized.includes("data") ||
    normalized.includes("query") ||
    normalized.includes("explorer")
  )
    return glyphs.data;
  if (normalized.includes("setup")) return glyphs.setup;
  if (normalized.includes("control")) return glyphs.controls;
  if (normalized.includes("troubleshoot")) return glyphs.troubleshooting;
  if (normalized.includes("diagnostic")) return glyphs.diagnostics;
  if (normalized.includes("discovery")) return glyphs.discovery;
  if (normalized.includes("utilit")) return glyphs.utilities;
  if (normalized.includes("reference")) return glyphs.reference;
  if (normalized.includes("feedback") || normalized.includes("create issue"))
    return glyphs.feedback;
  if (normalized.includes("link")) return glyphs.links;
  if (normalized.includes("status")) return glyphs.status;
  return glyphs.actions;
}

const EXTENSION_RICH_ICONS: Record<string, string> = {
  "sf-devbar": "📊",
  "sf-feedback": "✎",
  "sf-herdr": "🐑",
  "sf-data-explorer": "🔎",
  "sf-guardrail": "🛡",
  "sf-code-analyzer": "🧪",
  "sf-browser": "🌐",
  "sf-agentscript": "🤖",
  "sf-data360": "◈",
  "sf-slack": "💬",
  "sf-llm-gateway-internal": "🔗",
  "sf-skills": "📚",
  "sf-welcome": "✨",
  "sf-lsp": "◌",
  "sf-ohana-spinner": "◐",
  "sf-brain": "π",
  "sf-pi-manager": "📦",
};

const EXTENSION_ASCII_ICONS: Record<string, string> = {
  "sf-devbar": "db",
  "sf-feedback": "fb",
  "sf-herdr": "hd",
  "sf-data-explorer": "dx",
  "sf-guardrail": "gr",
  "sf-code-analyzer": "ca",
  "sf-browser": "br",
  "sf-agentscript": "as",
  "sf-data360": "d3",
  "sf-slack": "sl",
  "sf-llm-gateway-internal": "gw",
  "sf-skills": "sk",
  "sf-welcome": "hi",
  "sf-lsp": "ls",
  "sf-ohana-spinner": "sp",
  "sf-brain": "bn",
  "sf-pi-manager": "pi",
};

export function iconForExtension(extensionId: string, glyphs: UiGlyphs): string {
  const icons = glyphs.mode === "ascii" ? EXTENSION_ASCII_ICONS : EXTENSION_RICH_ICONS;
  return icons[extensionId] ?? glyphs.actions;
}

export function iconForSeverity(
  severity: "info" | "warning" | "error" | "success",
  glyphs: UiGlyphs,
): string {
  if (severity === "success") return glyphs.success;
  if (severity === "warning") return glyphs.warning;
  if (severity === "error") return glyphs.error;
  return glyphs.info;
}
