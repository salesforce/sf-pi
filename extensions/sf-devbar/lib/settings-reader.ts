/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Lightweight reader for Pi's terminal.* settings (project + global scope).
 *
 * The devbar surfaces a small pill when `terminal.imageWidthCells` has been
 * nudged away from the default, so users can confirm their `/settings`
 * edits actually took effect without having to re-open the settings UI.
 *
 * Scope rules match Pi's resolution order (project > global). Missing or
 * unreadable files resolve to `undefined` rather than throwing, so the
 * devbar stays working even when settings get corrupted mid-session.
 */
import { existsSync, readFileSync } from "node:fs";
import { globalSettingsPath, projectSettingsPath } from "../../../lib/common/pi-paths.ts";

/** Pi's default inline image width in terminal cells (see pi docs/settings.md). */
export const DEFAULT_IMAGE_WIDTH_CELLS = 60;

/**
 * Resolved terminal-related devbar settings.
 *
 * `imageWidthCells` is `undefined` when the setting is absent, missing from
 * both scopes, or not a finite positive integer. The caller treats that as
 * "default" and hides the pill.
 */
export interface TerminalDevbarSettings {
  imageWidthCells?: number;
}

/**
 * Read terminal.* settings, letting project scope override global scope.
 *
 * We read JSON directly instead of calling pi's settings API because pi does
 * not expose a typed settings reader to extensions. Matching pi's project >
 * global precedence keeps the pill honest.
 */
export function readTerminalDevbarSettings(
  cwd: string,
  globalSettingsFile: string = globalSettingsPath(),
): TerminalDevbarSettings {
  // Project scope wins when present, so start there.
  const projectValue = extractImageWidth(readSettingsJson(projectSettingsPath(cwd)));
  if (typeof projectValue === "number") {
    return { imageWidthCells: projectValue };
  }
  const globalValue = extractImageWidth(readSettingsJson(globalSettingsFile));
  if (typeof globalValue === "number") {
    return { imageWidthCells: globalValue };
  }
  return {};
}

function readSettingsJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Extract the `terminal.imageWidthCells` value from a parsed settings object.
 *
 * Accepts:
 *   - `settings.terminal.imageWidthCells` (nested form used by pi docs)
 *   - `settings["terminal.imageWidthCells"]` (flat dotted-key form)
 *
 * Returns `undefined` for anything that isn't a positive finite integer.
 */
function extractImageWidth(settings: unknown): number | undefined {
  if (!settings || typeof settings !== "object") return undefined;
  const source = settings as Record<string, unknown>;

  // Flat "terminal.imageWidthCells" key form.
  const flat = source["terminal.imageWidthCells"];
  const flatParsed = toPositiveInt(flat);
  if (typeof flatParsed === "number") return flatParsed;

  // Nested { terminal: { imageWidthCells } } form.
  const nested = source.terminal;
  if (nested && typeof nested === "object") {
    const raw = (nested as Record<string, unknown>).imageWidthCells;
    return toPositiveInt(raw);
  }
  return undefined;
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value)) return undefined;
  if (value <= 0) return undefined;
  return value;
}

/**
 * Format a non-default image width as a compact pill, e.g. `img:120c`.
 * Returns an empty string when the value is absent or matches the default,
 * so callers can safely concatenate without further null checks.
 */
export function formatImageWidthPill(value: number | undefined): string {
  if (typeof value !== "number") return "";
  if (value === DEFAULT_IMAGE_WIDTH_CELLS) return "";
  return `img:${value}c`;
}
