/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SF DevBar color defaults and validation.
 *
 * These are the DevBar-owned true-color accents that previously lived as
 * hardcoded hex literals in the renderers. Semantic theme colors such as
 * error/success/warning remain owned by the active Pi theme.
 */

export interface DevbarColors {
  folderPath: string;
  modelName: string;
  orgWarning: string;
  sandboxTrial: string;
  contextEmptyFg: string;
  contextEmptyBg: string;
  gatewayRainbow: readonly string[];
  thinkingRainbow: readonly string[];
}

export type DevbarColorKey = keyof DevbarColors;

export type DevbarColorOverrides = Partial<{
  [K in DevbarColorKey]: DevbarColors[K];
}>;

export type DevbarColorKind = "color" | "palette";

export interface DevbarColorDescriptor {
  key: DevbarColorKey;
  label: string;
  description: string;
  kind: DevbarColorKind;
}

export const DEVBAR_COLOR_DESCRIPTORS: readonly DevbarColorDescriptor[] = [
  {
    key: "folderPath",
    label: "Folder path",
    description: "Top-bar working folder accent.",
    kind: "color",
  },
  {
    key: "modelName",
    label: "Model name",
    description: "Gateway model-name accent.",
    kind: "color",
  },
  {
    key: "orgWarning",
    label: "Org warning",
    description: "No-org and undetected-org footer warning accent.",
    kind: "color",
  },
  {
    key: "sandboxTrial",
    label: "Sandbox/trial",
    description: "Sandbox and trial org footer badge accent.",
    kind: "color",
  },
  {
    key: "contextEmptyFg",
    label: "Context empty fg",
    description: "Foreground color for empty context-window cells.",
    kind: "color",
  },
  {
    key: "contextEmptyBg",
    label: "Context empty bg",
    description: "Background color for empty context-window cells.",
    kind: "color",
  },
  {
    key: "gatewayRainbow",
    label: "Gateway rainbow",
    description: "Gradient palette for the SF LLM Gateway badge.",
    kind: "palette",
  },
  {
    key: "thinkingRainbow",
    label: "Thinking rainbow",
    description: "Gradient palette for high/xhigh thinking badges.",
    kind: "palette",
  },
];

export const DEFAULT_DEVBAR_COLORS: DevbarColors = {
  folderPath: "#00afaf",
  modelName: "#d787af",
  orgWarning: "#cc8866",
  sandboxTrial: "#82aacc",
  contextEmptyFg: "#3c3c4a",
  contextEmptyBg: "#28282e",
  gatewayRainbow: ["#b281d6", "#d787af", "#febc38", "#89d281", "#00afaf", "#178fb9", "#b281d6"],
  thinkingRainbow: [
    "#b281d6",
    "#d787af",
    "#febc38",
    "#e4c00f",
    "#89d281",
    "#00afaf",
    "#178fb9",
    "#b281d6",
  ],
};

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const PALETTE_KEYS = new Set<DevbarColorKey>(["gatewayRainbow", "thinkingRainbow"]);

export function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const match = HEX_COLOR_RE.exec(trimmed);
  if (!match) return undefined;
  const body = match[1];
  if (!body) return undefined;
  if (body.length === 3) {
    return `#${body
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`.toLowerCase();
  }
  return `#${body}`.toLowerCase();
}

export function normalizeDevbarColorOverrides(value: unknown): DevbarColorOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const overrides: DevbarColorOverrides = {};

  for (const descriptor of DEVBAR_COLOR_DESCRIPTORS) {
    const rawValue = raw[descriptor.key];
    if (rawValue === undefined) continue;

    if (descriptor.kind === "palette") {
      const palette = normalizeHexPalette(rawValue);
      if (palette) setOverride(overrides, descriptor.key, palette);
      continue;
    }

    const color = normalizeHexColor(rawValue);
    if (color) setOverride(overrides, descriptor.key, color);
  }

  return overrides;
}

export function resolveDevbarColors(
  globalOverrides: DevbarColorOverrides = {},
  projectOverrides: DevbarColorOverrides = {},
): DevbarColors {
  const global = normalizeDevbarColorOverrides(globalOverrides);
  const project = normalizeDevbarColorOverrides(projectOverrides);
  return cloneColors({ ...DEFAULT_DEVBAR_COLORS, ...global, ...project });
}

export function hasDevbarColorOverrides(overrides: DevbarColorOverrides | undefined): boolean {
  return Boolean(overrides && Object.keys(overrides).length > 0);
}

export function isPaletteColorKey(key: DevbarColorKey): boolean {
  return PALETTE_KEYS.has(key);
}

export function formatPalette(colors: readonly string[]): string {
  return colors.join(", ");
}

function setOverride(
  overrides: DevbarColorOverrides,
  key: DevbarColorKey,
  value: string | readonly string[],
): void {
  (overrides as Record<DevbarColorKey, string | readonly string[]>)[key] = value;
}

function normalizeHexPalette(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const colors: string[] = [];
  for (const item of value) {
    const color = normalizeHexColor(item);
    if (!color) return undefined;
    colors.push(color);
  }
  return colors;
}

function cloneColors(colors: DevbarColors): DevbarColors {
  return {
    ...colors,
    gatewayRainbow: [...colors.gatewayRainbow],
    thinkingRainbow: [...colors.thinkingRainbow],
  };
}
