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
      if (this.editingKey === descriptor.key) {
        lines.push(`    ${t.fg("muted", "Edit:")} ${t.fg("accent", this.draftText || " ")}`);
      }
    }

    lines.push("");
    if (this.lastError) lines.push(` ${t.fg("warning", this.lastError)}`);
    if (this.lastMessage) lines.push(` ${t.fg("success", this.lastMessage)}`);
    lines.push(
      ` ${t.fg("dim", "↑/↓ select · Enter edit · Backspace clear field · r reset scope · s save · Esc back")}`,
    );
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
    const current =
      this.draftOverrides[descriptor.key] ?? this.effectiveColors().colors[descriptor.key];
    this.draftText = Array.isArray(current) ? formatPalette(current) : String(current);
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
      this.done(undefined);
      return;
    }
    writeScopedDevbarColorOverrides(this.cwd, this.scope, this.draftOverrides);
    this.savedOverrides = cloneOverrides(this.draftOverrides);
    this.done({ needsReload: true });
  }

  private currentDescriptor(): DevbarColorDescriptor {
    const selected = DEVBAR_COLOR_DESCRIPTORS[this.cursor];
    if (selected) return selected;
    const first = DEVBAR_COLOR_DESCRIPTORS[0];
    if (!first) throw new Error("DevBar color descriptors are empty");
    return first;
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

export function normalizeTextInput(data: string): string {
  if (!data) return "";
  const withoutPasteMarkers = data.replace(/\x1b\[200~/g, "").replace(/\x1b\[201~/g, "");
  if (/^\x1b\[[0-9;]*[A-Za-z~]$/.test(withoutPasteMarkers)) return "";
  if (/^\[[0-9;]*[A-Za-z~]$/.test(withoutPasteMarkers)) return "";
  return withoutPasteMarkers.replace(/[\r\n]/g, "");
}

type PanelKey = "escape" | "up" | "down" | "enter" | "return" | "backspace" | "delete";

function isKey(data: string, key: PanelKey): boolean {
  return data === key || matchesKey(data, key);
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
