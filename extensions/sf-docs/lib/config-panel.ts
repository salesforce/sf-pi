/* SPDX-License-Identifier: Apache-2.0 */
/** Manager Settings panel for SF Docs preferences. */
import { type Focusable, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import { detectTokenSource, maskToken, resolveConfiguredToken, resolveEndpoint } from "./auth.ts";
import {
  describePreferenceSource,
  readEffectiveDocsPreferences,
  writeDocsPreference,
  type SfDocsPreferenceKey,
} from "./preferences.ts";
import type { SfDocsPreferences } from "./types.ts";

interface SettingRow<K extends SfDocsPreferenceKey = SfDocsPreferenceKey> {
  key: K;
  label: string;
  description: string;
  values: Array<SfDocsPreferences[K]>;
}

const SETTING_ROWS: readonly SettingRow[] = [
  {
    key: "defaultCollection",
    label: "Default collection",
    description: "Docs collection used when sf_docs calls omit collection.",
    values: ["developer", "admin", "architect", "legacydeveloper", "mulesoft", "tableau"],
  },
  {
    key: "defaultVersion",
    label: "Default version",
    description: "Docs version used when sf_docs calls omit version.",
    values: ["current", "next"],
  },
  {
    key: "defaultLocale",
    label: "Default locale",
    description: "Docs locale used when sf_docs calls omit locale.",
    values: ["en-us", "ja-jp", "de-de", "fr-fr", "es-mx", "pt-br", "zh-cn"],
  },
  {
    key: "defaultFetchFormat",
    label: "Fetch format",
    description: "Preferred body format for fetched documents.",
    values: ["markdown", "text", "html"],
  },
  {
    key: "defaultPageSize",
    label: "Search page size",
    description: "Default number of search results returned to the agent.",
    values: [3, 5, 10, 20],
  },
  {
    key: "includeCitations",
    label: "Include citations",
    description: "Ask answer/explain actions to include citation arrays.",
    values: [true, false],
  },
  {
    key: "displayDensity",
    label: "Display density",
    description: "Controls human-visible SF Docs result card previews, not LLM evidence text.",
    values: ["compact", "balanced", "verbose"],
  },
  {
    key: "cacheCatalog",
    label: "Cache catalog",
    description: "Cache only the collection catalog; never cache docs bodies.",
    values: [true, false],
  },
];

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

class SfDocsConfigPanel implements Focusable {
  focused = false;
  private cursor = 0;
  private draft: SfDocsPreferences;
  private saved: SfDocsPreferences;
  private sourceSummary: string;
  private message = "";

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: "global" | "project",
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const effective = readEffectiveDocsPreferences(cwd);
    this.draft = { ...effective };
    this.saved = { ...this.draft };
    this.sourceSummary = `collection ${describePreferenceSource(effective, "defaultCollection")} · locale ${describePreferenceSource(effective, "defaultLocale")}`;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "up")) return this.move(-1);
    if (matchesKey(data, "down")) return this.move(1);
    if (matchesKey(data, "left")) return this.cycle(-1);
    if (matchesKey(data, "right") || matchesKey(data, "space")) return this.cycle(1);
    if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "s") this.save();
  }

  renderContent(width: number): string[] {
    const t = this.theme;
    const pad = (line = "") => padAnsi(line, width);
    const token = resolveConfiguredToken();
    const tokenSource = detectTokenSource();
    const endpoint = resolveEndpoint();
    const lines: string[] = [
      ` ${t.fg("accent", t.bold("📚 SF Docs Settings"))}`,
      ` ${t.fg("dim", "Configure non-secret defaults. Use Connect on the detail page for the token.")}`,
      "",
      ` ${tokenSource !== "none" ? t.fg("success", "● Connected") : t.fg("error", "● Not configured")}`,
      `   ${t.fg("muted", "Token source:")} ${t.fg("text", tokenSource)}`,
    ];
    if (token) lines.push(`   ${t.fg("muted", "Token:")} ${t.fg("dim", maskToken(token.token))}`);
    lines.push(
      `   ${t.fg("muted", "Endpoint:")} ${t.fg("dim", `${endpoint.endpoint} (${endpoint.source})`)}`,
    );
    if (endpoint.warning) lines.push(`   ${t.fg("warning", endpoint.warning)}`);
    lines.push("", ` ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`);
    lines.push(` ${t.fg("muted", "Current source:")} ${t.fg("dim", this.sourceSummary)}`);
    lines.push(
      ` ${t.fg("muted", "Mode:")} ${t.fg("text", this.isDirty() ? "unsaved changes" : "saved")}`,
      "",
    );

    for (let i = 0; i < SETTING_ROWS.length; i++) {
      const row = SETTING_ROWS[i];
      if (!row) continue;
      const selected = i === this.cursor;
      const cursor = selected ? t.fg("accent", "→") : " ";
      const label = selected ? t.fg("accent", row.label) : t.fg("text", row.label);
      lines.push(` ${cursor} ${label.padEnd(24)} ${t.fg("muted", String(this.draft[row.key]))}`);
      if (selected) lines.push(`    ${t.fg("dim", row.description)}`);
    }
    lines.push("");
    if (this.message) lines.push(` ${t.fg("success", this.message)}`);
    lines.push(` ${t.fg("dim", "↑/↓ move · ←/→ change · S/Enter save · Esc back")}`);
    return lines.map(pad);
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}

  private move(delta: -1 | 1): void {
    this.cursor = (this.cursor + delta + SETTING_ROWS.length) % SETTING_ROWS.length;
    this.message = "";
  }

  private cycle(delta: -1 | 1): void {
    const row = SETTING_ROWS[this.cursor];
    if (!row) return;
    const current = this.draft[row.key];
    const values = row.values;
    const currentIndex = Math.max(
      0,
      values.findIndex((value) => value === current),
    );
    const next = values[(currentIndex + delta + values.length) % values.length];
    if (next !== undefined) this.draft = { ...this.draft, [row.key]: next };
    this.message = "";
  }

  private save(): void {
    if (!this.isDirty()) {
      this.message = "No changes to save.";
      return;
    }
    let effective = readEffectiveDocsPreferences(this.cwd);
    for (const row of SETTING_ROWS) {
      if (this.draft[row.key] !== this.saved[row.key]) {
        effective = writeDocsPreference(this.cwd, this.scope, row.key, this.draft[row.key]);
      }
    }
    this.saved = { ...this.draft };
    this.sourceSummary = `collection ${describePreferenceSource(effective, "defaultCollection")} · locale ${describePreferenceSource(effective, "defaultLocale")}`;
    this.message = "Saved SF Docs settings.";
  }

  private isDirty(): boolean {
    return JSON.stringify(this.draft) !== JSON.stringify(this.saved);
  }
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new SfDocsConfigPanel(theme, cwd, scope, done);
};
