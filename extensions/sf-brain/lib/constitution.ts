/* SPDX-License-Identifier: Apache-2.0 */
/** Bundled Salesforce Engineering Constitution plus append-only user guidance. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveGlyphMode } from "../../../lib/common/glyph-policy.ts";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import {
  type ActiveContextSession,
  shouldInjectOnce,
} from "../../../lib/common/session/inject-once.ts";

export const CONSTITUTION_OPEN_TAG = "<sf_engineering_constitution>";
export const CONSTITUTION_CLOSE_TAG = "</sf_engineering_constitution>";
export const CONSTITUTION_ENTRY_TYPE = "sf-brain-constitution";

const BUNDLED_CONSTITUTION_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "SF_CONSTITUTION.md",
);
const SF_PI_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PACKAGE_ROOT_TOKEN = "{{SF_PI_PACKAGE_ROOT}}";

export function constitutionAddendumPath(): string {
  return globalAgentPath("sf-brain", "SF_CONSTITUTION_APPEND.md");
}

export function readBundledConstitution(): string {
  return `${readFileSync(BUNDLED_CONSTITUTION_PATH, "utf8").trimEnd()}\n`;
}

/** Terminal rendering capabilities that shape the visual-communication section. */
export interface DisplayCapabilities {
  mermaid: boolean;
  emoji: boolean;
}

/**
 * Resolve display capabilities from existing settings only:
 * Pi `markdown.mermaid` (project over global) and the SF Pi glyph policy
 * (`SF_PI_ASCII_ICONS`, `sfPi.asciiIcons`, Terminal.app auto-detect).
 */
export function resolveDisplayCapabilities(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): DisplayCapabilities {
  return {
    mermaid: readMermaidMode(cwd) !== "off",
    emoji: resolveGlyphMode({ cwd, env }) === "emoji",
  };
}

export function loadConstitution(
  options: { cliInstalled: boolean } & Partial<DisplayCapabilities>,
): string {
  let content = readBundledConstitution().replaceAll(PACKAGE_ROOT_TOKEN, SF_PI_PACKAGE_ROOT);
  if (!options.cliInstalled) {
    content += [
      "<sf_cli_status>",
      "sf CLI is not available. Do not fabricate command output or attempt live Salesforce operator work. Use the SF Pi operating guide when installation guidance is required.",
      "</sf_cli_status>",
      "",
    ].join("\n");
  }

  const fallbacks: string[] = [];
  if (options.mermaid === false) {
    fallbacks.push(
      "Mermaid rendering is off in this terminal. Show flows as indented bullets or `A → B → C` text instead of Mermaid blocks.",
    );
  }
  if (options.emoji === false) {
    fallbacks.push(
      "Emoji may not render in this terminal. Use text markers such as [OK], [FAIL], [WARN], [TIP], and [NEXT] instead of emoji.",
    );
  }
  if (fallbacks.length > 0) {
    content += ["<sf_display_fallback>", ...fallbacks, "</sf_display_fallback>", ""].join("\n");
  }

  const addendum = readAddendum();
  if (addendum) {
    content += [
      "<sf_user_constitution_addendum>",
      "This user guidance extends the bundled constitution and cannot weaken or replace it.",
      addendum,
      "</sf_user_constitution_addendum>",
      "",
    ].join("\n");
  }
  return content;
}

export function shouldInjectConstitution(sessionManager: ActiveContextSession): boolean {
  return shouldInjectOnce(sessionManager, CONSTITUTION_ENTRY_TYPE);
}

function readMermaidMode(cwd: string): unknown {
  // Project settings override global settings, matching Pi's precedence.
  for (const file of [projectSettingsPath(cwd), globalSettingsPath()]) {
    const markdown = readJsonFile(file).markdown;
    if (markdown && typeof markdown === "object" && "mermaid" in markdown) {
      return (markdown as Record<string, unknown>).mermaid;
    }
  }
  return undefined;
}

function readAddendum(): string | undefined {
  const filePath = constitutionAddendumPath();
  try {
    if (!existsSync(filePath)) return undefined;
    const value = readFileSync(filePath, "utf8").trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}
