/* SPDX-License-Identifier: Apache-2.0 */
/** Mutable terminal-display context kept separate from the stable constitution. */
import { resolveGlyphMode, type GlyphMode } from "../../../lib/common/glyph-policy.ts";
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import {
  type ActiveContextSession,
  shouldInjectOnce,
} from "../../../lib/common/session/inject-once.ts";

export const DISPLAY_CAPABILITIES_ENTRY_TYPE = "sf-brain-display-capabilities";
export const SUPPORTED_TERMINAL_MERMAID_FORMS = [
  "flowchart",
  "sequenceDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "classDiagram",
] as const;

export type MermaidRenderingMode = "off" | "final" | "streaming";

export interface DisplayCapabilities {
  mermaid: boolean;
  mermaidMode: MermaidRenderingMode;
  emoji: boolean;
  glyphMode: GlyphMode;
}

export interface DisplayCapabilitiesReport extends DisplayCapabilities {
  terminalProgram: string;
  terminalColumns?: number;
  supportedMermaidForms: readonly string[];
}

/** Resolve the same effective Mermaid default as Pi plus SF Pi's glyph policy. */
export function resolveDisplayCapabilities(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): DisplayCapabilities {
  const mermaidMode = readMermaidMode(cwd);
  const glyphMode = resolveGlyphMode({ cwd, env });
  return {
    mermaid: mermaidMode !== "off",
    mermaidMode,
    emoji: glyphMode === "emoji",
    glyphMode,
  };
}

export function buildDisplayCapabilitiesReport(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  terminalColumns: number | undefined = process.stdout.columns,
): DisplayCapabilitiesReport {
  return {
    ...resolveDisplayCapabilities(cwd, env),
    terminalProgram: env.TERM_PROGRAM?.trim() || "unknown",
    ...(Number.isFinite(terminalColumns) && (terminalColumns ?? 0) > 0
      ? { terminalColumns: Math.floor(terminalColumns as number) }
      : {}),
    supportedMermaidForms: SUPPORTED_TERMINAL_MERMAID_FORMS,
  };
}

/** Compact model-visible state that can be superseded when settings change. */
export function formatDisplayCapabilitiesContext(capabilities: DisplayCapabilities): string {
  const mermaid = capabilities.mermaid
    ? `Mermaid terminal rendering: ${capabilities.mermaidMode}. Use only a top-level flowchart, sequenceDiagram, stateDiagram-v2, erDiagram, or classDiagram block that fits the terminal.`
    : "Mermaid terminal rendering: off. Use indented bullets or `A → B → C` text instead of Mermaid blocks.";
  const icons = capabilities.emoji
    ? "Chat status markers: emoji. Follow the constitution's semantic icon legend."
    : "Chat status markers: ASCII. Use [OK], [FAIL], [WARN], [TIP], and [NEXT] instead of emoji.";
  return ["<sf_display_capabilities>", mermaid, icons, "</sf_display_capabilities>"].join("\n");
}

export function shouldInjectDisplayCapabilities(
  sessionManager: ActiveContextSession,
  content: string,
): boolean {
  return shouldInjectOnce(
    sessionManager,
    DISPLAY_CAPABILITIES_ENTRY_TYPE,
    (entry) => entry.content === content,
  );
}

function readMermaidMode(cwd: string): MermaidRenderingMode {
  // Project settings override global settings, matching Pi's precedence.
  for (const file of [projectSettingsPath(cwd), globalSettingsPath()]) {
    const markdown = readJsonFile(file).markdown;
    if (!markdown || typeof markdown !== "object" || !("mermaid" in markdown)) continue;
    const mode = (markdown as Record<string, unknown>).mermaid;
    return mode === "off" || mode === "final" ? mode : "streaming";
  }
  return "streaming";
}
