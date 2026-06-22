/* SPDX-License-Identifier: Apache-2.0 */
/** Config panel for SF DevBar color preferences. */
import { type Focusable, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  DEVBAR_COLOR_DESCRIPTORS,
  DEFAULT_DEVBAR_COLORS,
  formatPalette,
  isPaletteColorKey,
  normalizeDevbarColorOverrides,
  normalizeHexColor,
  type DevbarColorDescriptor,
  type DevbarColorKey,
  type DevbarColorOverrides,
  type DevbarColors,
} from "./colors.ts";
import {
  readScopedDevbarSettings,
  settingsPathForScope,
  writeScopedDevbarColorOverrides,
  type DevbarColorSource,
  type DevbarSettingsScope,
} from "./settings.ts";

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

function hexFg(hex: string, text: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

export function parseDevbarColorInput(
  descriptor: DevbarColorDescriptor,
  input: string,
): string | string[] | undefined {
  if (descriptor.kind === "color") return normalizeHexColor(input);
  return parsePaletteInput(input);
}

export function parsePaletteInput(input: string): string[] | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  let raw: unknown;
  if (trimmed.startsWith("[")) {
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  } else {
    raw = trimmed
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  const normalized = normalizeDevbarColorOverrides({ gatewayRainbow: raw }).gatewayRainbow;
  return Array.isArray(normalized) ? [...normalized] : undefined;
}

class SfDevbarConfigPanel implements Focusable {
  focused = false;

  private cursor = 0;
  private editingKey: DevbarColorKey | null = null;
  private draftText = "";
  private draftOverrides: DevbarColorOverrides;
  private savedOverrides: DevbarColorOverrides;
  private inheritedGlobalOverrides: DevbarColorOverrides;
  private lastError = "";
  private lastMessage = "";

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: DevbarSettingsScope,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const scoped = readScopedDevbarSettings(cwd, scope);
    this.savedOverrides = { ...scoped.colors };
    this.draftOverrides = cloneOverrides(scoped.colors);
    this.inheritedGlobalOverrides =
      scope === "project" ? readScopedDevbarSettings(cwd, "global").colors : {};
  }

  handleInput(data: string): void {
    if (this.editingKey) {
      this.handleEditInput(data);
      return;
    }

    if (isKey(data, "escape") || data === "q") {
      this.done(undefined);
      return;
    }
    if (isKey(data, "up")) {
      this.cursor =
        (this.cursor + DEVBAR_COLOR_DESCRIPTORS.length - 1) % DEVBAR_COLOR_DESCRIPTORS.length;
      return;
    }
    if (isKey(data, "down")) {
      this.cursor = (this.cursor + 1) % DEVBAR_COLOR_DESCRIPTORS.length;
      return;
    }
    if (isKey(data, "enter") || isKey(data, "return")) {
      this.startEditing(this.currentDescriptor());
      return;
    }
    if (isKey(data, "backspace") || isKey(data, "delete")) {
      this.clearCurrentField();
      return;
    }
    if (data === "r") {
      this.draftOverrides = {};
      this.lastError = "";
      this.lastMessage = "Reset this scope. Press s to save.";
      return;
    }
    if (data === "s") {
      this.save();
    }
  }

  renderContent(width: number): string[] {
    if (this.editingKey) return this.renderEditContent(width);
    return this.renderListContent(width);
  }

  private renderListContent(width: number): string[] {
    const t = this.theme;
    const pad = (content = "") => padAnsi(truncateToWidth(content, width, ""), width);
    const effective = this.effectiveColors();
    const lines: string[] = [
      ` ${t.fg("accent", themeBold(t, "SF Pi › SF DevBar › Settings"))}`,
      "",
      ` ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`,
      ` ${t.fg("muted", "Settings:")} ${t.fg("dim", settingsPathForScope(this.cwd, this.scope))}`,
      ` ${t.fg("muted", "Mode:")} ${t.fg("text", this.isDirty() ? "unsaved changes" : "saved")}`,
      "",
    ];

    for (const [i, descriptor] of DEVBAR_COLOR_DESCRIPTORS.entries()) {
      lines.push(this.renderRow(descriptor, effective, i === this.cursor, width));
    }

    lines.push("");
    if (this.lastError) lines.push(` ${t.fg("warning", this.lastError)}`);
    if (this.lastMessage) lines.push(` ${t.fg("success", this.lastMessage)}`);
    lines.push(
      ` ${t.fg("dim", "↑/↓ select · Enter edit · Backspace clear field · r reset scope · s save · Esc cancel/back")}`,
    );
    return lines.map(pad);
  }

  private renderEditContent(width: number): string[] {
    const t = this.theme;
    const pad = (content = "") => padAnsi(truncateToWidth(content, width, ""), width);
    const descriptor = this.editingDescriptor();
    if (!descriptor) return this.renderListContent(width);

    const effective = this.effectiveColors();
    const current = effective.colors[descriptor.key];
    const currentText = Array.isArray(current) ? formatPalette(current) : String(current);
    const draft = this.renderDraftText(width);
    const lines: string[] = [
      ` ${t.fg("accent", themeBold(t, `SF Pi › SF DevBar › Settings › Edit ${descriptor.label}`))}`,
      "",
      ` ${t.fg("muted", "Field:")}  ${t.fg("text", descriptor.label)}`,
      ` ${t.fg("muted", "Type:")}   ${t.fg("text", descriptor.kind === "palette" ? "Palette" : "Color")}`,
      ` ${t.fg("muted", "Source:")} ${t.fg("text", effective.sources[descriptor.key])}`,
      "",
      ` ${t.fg("muted", "Current effective value:")}`,
      `   ${t.fg("dim", currentText)}`,
      "",
      ` ${t.fg("muted", "Draft:")}`,
      `   ${t.fg("accent", draft)}`,
      "",
      ` ${t.fg("muted", "Accepted formats:")}`,
      `   ${t.fg("dim", "#RGB or #RRGGBB")}`,
    ];

    if (descriptor.kind === "palette") {
      lines.push(`   ${t.fg("dim", "#b281d6, #5fafff, #82d8ff")}`);
      lines.push(`   ${t.fg("dim", '["#b281d6", "#5fafff", "#82d8ff"]')}`);
    }

    lines.push("");
    if (this.lastError) lines.push(` ${t.fg("warning", this.lastError)}`);
    lines.push(` ${t.fg("dim", "Enter accept · Esc cancel edit · Backspace delete")}`);
    // Keep the edit panel height stable enough to overwrite old draft rows even
    // when terminal input arrives faster than the host repaint cycle.
    while (lines.length < 24) lines.push("");
    return lines.map(pad);
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}

  private handleEditInput(data: string): void {
    if (isKey(data, "escape")) {
      this.editingKey = null;
      this.draftText = "";
      this.lastError = "";
      return;
    }
    if (isKey(data, "backspace")) {
      this.draftText = this.draftText.slice(0, -1);
      return;
    }
    if (isKey(data, "enter") || isKey(data, "return")) {
      this.commitEdit();
      return;
    }
    const text = normalizeTextInput(data);
    if (text) this.draftText += text;
  }

  private startEditing(descriptor: DevbarColorDescriptor): void {
    this.editingKey = descriptor.key;
    this.lastError = "";
    this.lastMessage = "";
    const scopedDraft = this.draftOverrides[descriptor.key];
    this.draftText = scopedDraft === undefined ? "" : formatColorValue(scopedDraft);
  }

  private renderDraftText(width: number): string {
    const cursor = this.theme.fg("accent", "█");
    const maxDraftWidth = Math.max(8, Math.min(72, width - 8));
    const visibleDraft = truncateToWidth(this.draftText, maxDraftWidth, "…");
    return this.theme.fg("accent", `${visibleDraft}${cursor}`);
  }

  private commitEdit(): void {
    const key = this.editingKey;
    if (!key) return;
    const descriptor = DEVBAR_COLOR_DESCRIPTORS.find((item) => item.key === key);
    if (!descriptor) return;

    const parsed = parseDevbarColorInput(descriptor, this.draftText);
    if (!parsed) {
      this.lastError =
        descriptor.kind === "palette"
          ? "Invalid palette. Enter comma-separated #RGB/#RRGGBB values or a JSON string array."
          : "Invalid color. Use #RGB or #RRGGBB.";
      return;
    }

    this.draftOverrides = { ...this.draftOverrides, [key]: parsed };
    this.editingKey = null;
    this.draftText = "";
    this.lastError = "";
    this.lastMessage = "Buffered change. Press s to save.";
  }

  private clearCurrentField(): void {
    const descriptor = this.currentDescriptor();
    if (this.draftOverrides[descriptor.key] === undefined) {
      this.lastMessage = "No scoped override to clear.";
      this.lastError = "";
      return;
    }
    const next = { ...this.draftOverrides };
    delete next[descriptor.key];
    this.draftOverrides = next;
    this.lastError = "";
    this.lastMessage = "Cleared field override. Press s to save.";
  }

  private save(): void {
    if (!this.isDirty()) {
      this.lastMessage = "No changes to save.";
      this.lastError = "";
      return;
    }
    writeScopedDevbarColorOverrides(this.cwd, this.scope, this.draftOverrides);
    this.savedOverrides = cloneOverrides(this.draftOverrides);
    this.lastError = "";
    this.lastMessage = "Saved DevBar color settings.";
  }

  private currentDescriptor(): DevbarColorDescriptor {
    const selected = DEVBAR_COLOR_DESCRIPTORS[this.cursor];
    if (selected) return selected;
    const first = DEVBAR_COLOR_DESCRIPTORS[0];
    if (!first) throw new Error("DevBar color descriptors are empty");
    return first;
  }

  private editingDescriptor(): DevbarColorDescriptor | undefined {
    const key = this.editingKey;
    return key ? DEVBAR_COLOR_DESCRIPTORS.find((item) => item.key === key) : undefined;
  }

  private effectiveColors(): {
    colors: DevbarColors;
    sources: Record<DevbarColorKey, DevbarColorSource>;
  } {
    const global = this.scope === "global" ? this.draftOverrides : this.inheritedGlobalOverrides;
    const project = this.scope === "project" ? this.draftOverrides : {};
    const colors = { ...DEFAULT_DEVBAR_COLORS, ...global, ...project } as DevbarColors;
    const sources = {} as Record<DevbarColorKey, DevbarColorSource>;
    for (const descriptor of DEVBAR_COLOR_DESCRIPTORS) {
      const key = descriptor.key;
      if (project[key] !== undefined) sources[key] = "project";
      else if (global[key] !== undefined) sources[key] = "global";
      else sources[key] = "default";
    }
    return { colors, sources };
  }

  private renderRow(
    descriptor: DevbarColorDescriptor,
    effective: { colors: DevbarColors; sources: Record<DevbarColorKey, DevbarColorSource> },
    selected: boolean,
    width: number,
  ): string {
    const t = this.theme;
    const value = effective.colors[descriptor.key];
    const source = effective.sources[descriptor.key];
    const cursor = selected ? t.fg("accent", "→") : " ";
    const label = selected
      ? t.fg("accent", descriptor.label.padEnd(18))
      : t.fg("muted", descriptor.label.padEnd(18));
    const summary = Array.isArray(value) ? `${value.length} colors` : value;
    const swatch = isPaletteColorKey(descriptor.key)
      ? (value as readonly string[])
          .slice(0, 6)
          .map((hex) => hexFg(hex, "██"))
          .join(" ")
      : hexFg(value as string, "██");
    return truncateToWidth(
      ` ${cursor} ${label} ${swatch} ${t.fg("text", String(summary).padEnd(18))} ${t.fg(source === this.scope ? "accent" : "dim", source)}`,
      width,
      "…",
    );
  }

  private isDirty(): boolean {
    return JSON.stringify(this.savedOverrides) !== JSON.stringify(this.draftOverrides);
  }
}

const ESC = "\u001b";
const BRACKETED_PASTE_START = `${ESC}[200~`;
const BRACKETED_PASTE_END = `${ESC}[201~`;

export function normalizeTextInput(data: string): string {
  if (!data) return "";
  const withoutPasteMarkers = data
    .split(BRACKETED_PASTE_START)
    .join("")
    .split(BRACKETED_PASTE_END)
    .join("");
  if (isTerminalEscapeSequence(withoutPasteMarkers)) return "";
  return stripTerminalControls(withoutPasteMarkers).split("\r").join("").split("\n").join("");
}

function stripTerminalControls(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 27 && value[i + 1] === "[") {
      i += 2;
      while (i < value.length && !isCsiFinal(value.charCodeAt(i))) i++;
      continue;
    }
    if (isControlCode(code)) continue;
    out += value[i] ?? "";
  }
  return out;
}

function isControlCode(code: number): boolean {
  return code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13);
}

function isCsiFinal(code: number): boolean {
  return (code >= 64 && code <= 90) || (code >= 97 && code <= 126);
}

function isTerminalEscapeSequence(value: string): boolean {
  const csi = value.startsWith(`${ESC}[`)
    ? value.slice(2)
    : value.startsWith("[")
      ? value.slice(1)
      : null;
  if (!csi) return false;
  if (csi.length === 0) return false;
  const finalChar = csi[csi.length - 1];
  if (!finalChar) return false;
  const finalCode = finalChar.charCodeAt(0);
  if (
    !(
      (finalCode >= 65 && finalCode <= 90) ||
      (finalCode >= 97 && finalCode <= 122) ||
      finalChar === "~"
    )
  )
    return false;
  return [...csi.slice(0, -1)].every((char) => {
    const code = char.charCodeAt(0);
    return (code >= 48 && code <= 57) || char === ";";
  });
}

type PanelKey = "escape" | "up" | "down" | "enter" | "return" | "backspace" | "delete";

function isKey(data: string, key: PanelKey): boolean {
  return data === key || matchesKey(data, key);
}

function formatColorValue(value: string | readonly string[]): string {
  return typeof value === "string" ? value : formatPalette(value);
}

function cloneOverrides(overrides: DevbarColorOverrides): DevbarColorOverrides {
  return JSON.parse(JSON.stringify(overrides)) as DevbarColorOverrides;
}

function themeBold(theme: Theme, text: string): string {
  return typeof theme.bold === "function" ? theme.bold(text) : text;
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new SfDevbarConfigPanel(theme, cwd, scope, done);
};
