/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Redesigned /sf-skills datatable overlay.
 *
 * Goals (from the screenshots-driven redesign):
 *
 *   1. Fixed adaptive height: every tab renders the same number of
 *      rows so switching tabs no longer makes the box jump.
 *   2. Scrolling viewport with ▲ / ▼ indicators, cursor stays
 *      visible (jumpToStart / jumpToEnd / pgup / pgdn supported).
 *   3. Friendly labels: "Claude Code" / "Global" instead of path-tails
 *      and single-letter codes.
 *   4. Three-line contextual footer that names the selected skill,
 *      shows its full path, and tells the user what space/g/p would
 *      do *on this row* — no more cryptic "g global · p project".
 *   5. Live filter via `/` so the table is usable with 30+ skills.
 *
 * The render pipeline is intentionally split into small helpers
 * (renderTabStrip / renderStatusBar / renderActiveBody / etc.) so
 * each tab's body stays under 80 LOC.
 */
import { type Focusable, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ActiveRow, DiscoverRow, WiredScope } from "../table-data.ts";
import { friendlyWiredLabel } from "../source-labels.ts";
import { jumpToEnd, jumpToStart, slice, step, viewportSize, type SliceResult } from "./viewport.ts";
import type {
  InstallCandidateAction,
  TableOverlayProps,
  TableResult,
  TabId,
  ToggleAction,
} from "./types.ts";

export type { TableResult, ToggleAction, InstallCandidateAction, TabId } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "active", label: "Active" },
  { id: "discover", label: "Discover" },
  { id: "stats", label: "Stats" },
];

// Fixed column widths for the Active tab. The 'source' column is
// flexible and absorbs whatever inner-width is left over so the table
// fills the box (no dead space between the data and the scroll gutter).
const ACTIVE_COL_WIDTHS = {
  cursor: 2,
  glyph: 2,
  name: 32,
  klass: 5,
  wired: 9,
  used: 6,
} as const;
const ACTIVE_FIXED_TOTAL =
  ACTIVE_COL_WIDTHS.cursor +
  ACTIVE_COL_WIDTHS.glyph +
  ACTIVE_COL_WIDTHS.name +
  ACTIVE_COL_WIDTHS.klass +
  ACTIVE_COL_WIDTHS.wired +
  ACTIVE_COL_WIDTHS.used;
// 6 separator spaces between 7 cells + 1 leading + 2 trailing for scroll gutter.
const ACTIVE_NON_DATA_PAD = 6 + 1 + 2;

// Discover columns. 'origin' is the flex column.
const DISCOVER_COL_WIDTHS = {
  cursor: 2,
  glyph: 2,
  name: 30,
  status: 18,
} as const;
const DISCOVER_FIXED_TOTAL =
  DISCOVER_COL_WIDTHS.cursor +
  DISCOVER_COL_WIDTHS.glyph +
  DISCOVER_COL_WIDTHS.name +
  DISCOVER_COL_WIDTHS.status;
const DISCOVER_NON_DATA_PAD = 5 + 1 + 2;

function activeSourceWidth(innerWidth: number): number {
  return Math.max(18, innerWidth - ACTIVE_FIXED_TOTAL - ACTIVE_NON_DATA_PAD);
}

function discoverOriginWidth(innerWidth: number): number {
  return Math.max(18, innerWidth - DISCOVER_FIXED_TOTAL - DISCOVER_NON_DATA_PAD);
}

// -------------------------------------------------------------------------------------------------
// Component
// -------------------------------------------------------------------------------------------------

export class SkillsTableOverlayComponent implements Focusable {
  focused = false;

  private tab: TabId = "active";
  private cursor: Record<TabId, number> = { active: 0, discover: 0, stats: 0 };
  private offset: Record<TabId, number> = { active: 0, discover: 0, stats: 0 };
  private filterText = "";
  private filterFocused = false;

  private toggles = new Map<string, ToggleAction>();
  private candidates = new Map<string, InstallCandidateAction>();

  /** Cached terminal rows for viewportSize; updated each render. */
  private lastTerminalRows = 28;

  constructor(
    private readonly theme: Theme,
    private readonly props: TableOverlayProps,
    private readonly done: (result: TableResult | undefined) => void,
  ) {}

  // -----------------------------------------------------------------------------------------------
  // Input
  // -----------------------------------------------------------------------------------------------

  handleInput(data: string): void {
    // Filter mode owns most keys until the user dismisses it.
    if (this.filterFocused) {
      this.handleFilterInput(data);
      return;
    }

    if (matchesKey(data, "escape") || data === "q" || data === "Q") {
      this.done({ kind: "cancel" });
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      this.done({
        kind: "apply",
        toggles: [...this.toggles.values()],
        addCandidates: [...this.candidates.values()],
      });
      return;
    }
    if (matchesKey(data, "tab")) {
      this.tab = nextTab(this.tab, +1);
      return;
    }
    if (data === "1") {
      this.tab = "active";
      return;
    }
    if (data === "2") {
      this.tab = "discover";
      return;
    }
    if (data === "3") {
      this.tab = "stats";
      return;
    }
    if (data === "/") {
      this.filterFocused = true;
      return;
    }

    const view = this.viewportInfo();
    if (matchesKey(data, "up") || data === "k") {
      this.applyStep(-1, view);
      return;
    }
    if (matchesKey(data, "down") || data === "j") {
      this.applyStep(+1, view);
      return;
    }
    if (matchesKey(data, "pageUp")) {
      this.applyStep(-view.viewport, view);
      return;
    }
    if (matchesKey(data, "pageDown")) {
      this.applyStep(+view.viewport, view);
      return;
    }
    if (matchesKey(data, "home")) {
      const r = jumpToStart(view.total, view.viewport);
      this.cursor[this.tab] = r.cursor;
      this.offset[this.tab] = r.offset;
      return;
    }
    if (matchesKey(data, "end")) {
      const r = jumpToEnd(view.total, view.viewport);
      this.cursor[this.tab] = r.cursor;
      this.offset[this.tab] = r.offset;
      return;
    }
    if (data === "g" || data === "G" || matchesKey(data, "space")) {
      this.toggleAtCursor("global");
      return;
    }
    if (data === "p" || data === "P") {
      this.toggleAtCursor("project");
      return;
    }
  }

  private handleFilterInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.filterText = "";
      this.filterFocused = false;
      this.cursor[this.tab] = 0;
      this.offset[this.tab] = 0;
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      this.filterFocused = false;
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.filterText = this.filterText.slice(0, -1);
      this.cursor[this.tab] = 0;
      this.offset[this.tab] = 0;
      return;
    }
    // Single-character add (printable ASCII only — keeps the filter sane).
    if (data.length === 1 && data >= " " && data !== "\x7f") {
      this.filterText += data;
      this.cursor[this.tab] = 0;
      this.offset[this.tab] = 0;
    }
  }

  private applyStep(delta: number, view: ViewportInfo): void {
    const r = step(
      { cursor: this.cursor[this.tab], offset: this.offset[this.tab] },
      delta,
      view.total,
      view.viewport,
    );
    this.cursor[this.tab] = r.cursor;
    this.offset[this.tab] = r.offset;
  }

  // -----------------------------------------------------------------------------------------------
  // Toggle bookkeeping
  // -----------------------------------------------------------------------------------------------

  private toggleAtCursor(scope: "global" | "project"): void {
    if (this.tab === "active") {
      const rows = this.activeRowsFiltered();
      const r = rows[this.cursor.active];
      if (!r || r.readOnly) return;
      this.toggleActiveRow(r, scope);
      return;
    }
    if (this.tab === "discover") {
      const rows = this.discoverRowsFiltered();
      const r = rows[this.cursor.discover];
      if (!r) return;
      if (r.discover === "active") {
        if (r.readOnly) return;
        this.toggleActiveRow(r, scope);
        return;
      }
      this.toggleCandidate(r);
    }
  }

  private toggleActiveRow(r: ActiveRow, scope: "global" | "project"): void {
    const key = `${r.name}|${scope}`;
    const existing = this.toggles.get(key);
    if (existing) {
      this.toggles.delete(key);
      return;
    }
    const currentlyEnabled = wiredAt(r.wired, scope);
    this.toggles.set(key, {
      name: r.name,
      skillPath: r.skillPath,
      scope,
      enable: !currentlyEnabled,
    });
  }

  private toggleCandidate(r: Extract<DiscoverRow, { discover: "candidate" }>): void {
    const key = `${r.absolutePath}|${r.scope}`;
    if (this.candidates.has(key)) {
      this.candidates.delete(key);
      return;
    }
    this.candidates.set(key, { settingsValue: r.settingsValue, scope: r.scope });
  }

  // -----------------------------------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------------------------------

  render(width: number): string[] {
    const innerWidth = Math.max(86, width - 2);
    const view = this.viewportInfo();
    this.lastTerminalRows = view.terminalRows;

    const out: string[] = [];
    const theme = this.theme;
    const row = (content = "") => boxRow(theme, innerWidth, content);
    const sep = () =>
      `${theme.fg("border", "├")}${theme.fg("border", "─".repeat(innerWidth))}${theme.fg("border", "┤")}`;

    out.push(
      `${theme.fg("border", "╭")}${theme.fg("border", "─".repeat(innerWidth))}${theme.fg("border", "╮")}`,
    );
    out.push(row(""));
    out.push(row(this.renderTabStrip(theme)));
    out.push(row(""));
    out.push(sep());

    out.push(row(this.renderStatusBar(theme, view)));
    out.push(sep());

    out.push(...this.renderBody(theme, innerWidth, view, row));

    out.push(sep());
    out.push(...this.renderFooter(theme, view).map(row));

    out.push(
      `${theme.fg("border", "╰")}${theme.fg("border", "─".repeat(innerWidth))}${theme.fg("border", "╯")}`,
    );
    return out;
  }

  invalidate(): void {}

  // -----------------------------------------------------------------------------------------------
  // Tabs / status bar
  // -----------------------------------------------------------------------------------------------

  private renderTabStrip(theme: Theme): string {
    const parts: string[] = [];
    for (let i = 0; i < TABS.length; i++) {
      const t = TABS[i];
      if (!t) continue;
      const count = this.tabCount(t.id);
      const label = `${i + 1} ${t.label}${count !== null ? ` (${count})` : ""}`;
      parts.push(
        t.id === this.tab
          ? theme.fg("accent", theme.bold(`[ ${label} ]`))
          : theme.fg("muted", `  ${label}  `),
      );
    }
    return ` ${parts.join("   ")}`;
  }

  private tabCount(id: TabId): number | null {
    if (id === "active") return this.activeRowsFiltered().length;
    if (id === "discover") return this.discoverRowsFiltered().length;
    return null;
  }

  private renderStatusBar(theme: Theme, view: ViewportInfo): string {
    const left =
      view.total > 0
        ? `Showing ${view.offsetDisplay}–${view.endDisplay} of ${view.total}`
        : "No rows";
    const filterPart = this.renderFilterDisplay(theme);
    const hint = theme.fg(
      "dim",
      this.filterFocused
        ? "filter: type · enter accept · esc clear"
        : "↑/↓ navigate · space/g/p toggle · / filter",
    );
    return ` ${theme.fg("muted", left)}     ${filterPart}     ${hint}`;
  }

  private renderFilterDisplay(theme: Theme): string {
    const label = theme.fg("muted", "Filter:");
    const text = this.filterText
      ? theme.fg("accent", this.filterText)
      : theme.fg("dim", "________");
    const cursor = this.filterFocused ? theme.fg("accent", "█") : "";
    return `${label} ${text}${cursor}`;
  }

  // -----------------------------------------------------------------------------------------------
  // Body dispatcher (always returns exactly viewportRows + 2 lines: header + sep)
  // -----------------------------------------------------------------------------------------------

  private renderBody(
    theme: Theme,
    innerWidth: number,
    view: ViewportInfo,
    row: (content?: string) => string,
  ): string[] {
    const out: string[] = [];
    if (this.tab === "active") {
      out.push(row(this.renderActiveHeader(theme, innerWidth)));
      out.push(row(theme.fg("border", `  ${"─".repeat(innerWidth - 4)}`)));
      out.push(...this.renderActiveBody(theme, innerWidth, view, row));
    } else if (this.tab === "discover") {
      out.push(row(this.renderDiscoverHeader(theme, innerWidth)));
      out.push(row(theme.fg("border", `  ${"─".repeat(innerWidth - 4)}`)));
      out.push(...this.renderDiscoverBody(theme, innerWidth, view, row));
    } else {
      out.push(...this.renderStatsBody(theme, view, row));
    }
    // Pad to the viewport's row count so the box never shrinks between
    // tabs. We've already emitted `viewport` body lines + 2 header lines
    // for active/discover, or `viewport+2` total lines for stats.
    while (out.length < view.viewport + 2) out.push(row(""));
    return out;
  }

  // -----------------------------------------------------------------------------------------------
  // Active tab
  // -----------------------------------------------------------------------------------------------

  private renderActiveHeader(theme: Theme, innerWidth: number): string {
    const sourceWidth = activeSourceWidth(innerWidth);
    const cells = [
      pad("", ACTIVE_COL_WIDTHS.cursor),
      pad("", ACTIVE_COL_WIDTHS.glyph),
      pad("Skill", ACTIVE_COL_WIDTHS.name),
      pad("Class", ACTIVE_COL_WIDTHS.klass),
      pad("Where it's loaded", sourceWidth),
      pad("Wired", ACTIVE_COL_WIDTHS.wired),
      padRight("Used", ACTIVE_COL_WIDTHS.used),
    ];
    return rightAnchor(innerWidth, ` ${theme.fg("muted", cells.join(" "))}`, " ");
  }

  private renderActiveBody(
    theme: Theme,
    innerWidth: number,
    view: ViewportInfo,
    row: (content?: string) => string,
  ): string[] {
    const rows = this.activeRowsFiltered();
    if (rows.length === 0) {
      return [row(theme.fg("dim", "  No skills match this filter."))];
    }
    const out: string[] = [];
    for (let i = view.offset; i < view.end; i++) {
      const r = rows[i];
      if (!r) continue;
      const isCursor = i === view.cursor;
      out.push(row(this.renderActiveRow(theme, innerWidth, r, isCursor, view, i)));
    }
    return out;
  }

  private renderActiveRow(
    theme: Theme,
    innerWidth: number,
    r: ActiveRow,
    isCursor: boolean,
    view: ViewportInfo,
    index: number,
  ): string {
    const sourceWidth = activeSourceWidth(innerWidth);
    const cursorGlyph = isCursor ? theme.fg("accent", "▸") : " ";
    const onGlyph = this.activeOnGlyph(theme, r);
    const klassColor = r.klass === "salesforce" ? "success" : "muted";
    const klass = theme.fg(klassColor, r.klass === "salesforce" ? "SF " : "Ext");
    const wiredText = r.wiredLabel ?? friendlyWiredLabel(r.wired);
    const wiredColor = r.wired === "none" ? "muted" : "success";
    const cells = [
      pad(cursorGlyph, ACTIVE_COL_WIDTHS.cursor),
      pad(onGlyph, ACTIVE_COL_WIDTHS.glyph),
      pad(truncateToWidth(r.name, ACTIVE_COL_WIDTHS.name, "…"), ACTIVE_COL_WIDTHS.name),
      pad(klass, ACTIVE_COL_WIDTHS.klass),
      pad(truncateToWidth(r.sourceLabel, sourceWidth, "…"), sourceWidth),
      pad(theme.fg(wiredColor, wiredText), ACTIVE_COL_WIDTHS.wired),
      padRight(String(r.usageCount), ACTIVE_COL_WIDTHS.used),
    ];
    const data = ` ${cells.join(" ")}`;
    const scrollGlyph = this.scrollGlyph(theme, view, index);
    const line = rightAnchor(innerWidth, data, scrollGlyph);
    if (isCursor) return theme.fg("accent", line);
    return line;
  }

  private activeOnGlyph(theme: Theme, r: ActiveRow): string {
    if (r.readOnly) return theme.fg("dim", "·");
    const pending = this.pendingForRow(r);
    if (pending === "enable") return theme.fg("accent", "●");
    if (pending === "disable") return theme.fg("muted", "○");
    return r.wired === "none" ? theme.fg("muted", "○") : theme.fg("success", "●");
  }

  // -----------------------------------------------------------------------------------------------
  // Discover tab
  // -----------------------------------------------------------------------------------------------

  private renderDiscoverHeader(theme: Theme, innerWidth: number): string {
    const originWidth = discoverOriginWidth(innerWidth);
    const cells = [
      pad("", DISCOVER_COL_WIDTHS.cursor),
      pad("", DISCOVER_COL_WIDTHS.glyph),
      pad("Skill / Source", DISCOVER_COL_WIDTHS.name),
      pad("Origin", originWidth),
      pad("Status", DISCOVER_COL_WIDTHS.status),
    ];
    return rightAnchor(innerWidth, ` ${theme.fg("muted", cells.join(" "))}`, " ");
  }

  private renderDiscoverBody(
    theme: Theme,
    innerWidth: number,
    view: ViewportInfo,
    row: (content?: string) => string,
  ): string[] {
    const rows = this.discoverRowsFiltered();
    if (rows.length === 0) {
      return [row(theme.fg("dim", "  Nothing to discover."))];
    }
    const out: string[] = [];
    for (let i = view.offset; i < view.end; i++) {
      const r = rows[i];
      if (!r) continue;
      const isCursor = i === view.cursor;
      out.push(row(this.renderDiscoverRow(theme, innerWidth, r, isCursor, view, i)));
    }
    return out;
  }

  private renderDiscoverRow(
    theme: Theme,
    innerWidth: number,
    r: DiscoverRow,
    isCursor: boolean,
    view: ViewportInfo,
    index: number,
  ): string {
    const originWidth = discoverOriginWidth(innerWidth);
    const cursorGlyph = isCursor ? theme.fg("accent", "▸") : " ";
    if (r.discover === "active") {
      const on = this.activeOnGlyph(theme, r);
      const cells = [
        pad(cursorGlyph, DISCOVER_COL_WIDTHS.cursor),
        pad(on, DISCOVER_COL_WIDTHS.glyph),
        pad(truncateToWidth(r.name, DISCOVER_COL_WIDTHS.name, "…"), DISCOVER_COL_WIDTHS.name),
        pad(truncateToWidth(r.sourceLabel, originWidth, "…"), originWidth),
        pad(
          theme.fg("success", `Active (${friendlyWiredLabel(r.wired)})`),
          DISCOVER_COL_WIDTHS.status,
        ),
      ];
      const data = ` ${cells.join(" ")}`;
      const line = rightAnchor(innerWidth, data, this.scrollGlyph(theme, view, index));
      return isCursor ? theme.fg("accent", line) : line;
    }
    const key = `${r.absolutePath}|${r.scope}`;
    const pending = this.candidates.has(key);
    const on = pending ? theme.fg("accent", "●") : theme.fg("muted", "○");
    const status = pending
      ? theme.fg("accent", "wire pending")
      : theme.fg("muted", `${r.skillCount} skill${r.skillCount === 1 ? "" : "s"}, off`);
    const cells = [
      pad(cursorGlyph, DISCOVER_COL_WIDTHS.cursor),
      pad(on, DISCOVER_COL_WIDTHS.glyph),
      pad(truncateToWidth(r.label, DISCOVER_COL_WIDTHS.name, "…"), DISCOVER_COL_WIDTHS.name),
      pad(truncateToWidth(r.absolutePath, originWidth, "…"), originWidth),
      pad(status, DISCOVER_COL_WIDTHS.status),
    ];
    const data = ` ${cells.join(" ")}`;
    const line = rightAnchor(innerWidth, data, this.scrollGlyph(theme, view, index));
    return isCursor ? theme.fg("accent", line) : line;
  }

  // -----------------------------------------------------------------------------------------------
  // Stats tab
  // -----------------------------------------------------------------------------------------------

  private renderStatsBody(
    theme: Theme,
    view: ViewportInfo,
    row: (content?: string) => string,
  ): string[] {
    const top = [...this.props.active]
      .filter((r) => r.usageCount > 0)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10);

    if (top.length === 0) {
      // Pad the empty state to the viewport so the box stays the same
      // height as the other tabs.
      const lines: string[] = [
        row(""),
        row(theme.fg("muted", "  No usage recorded yet.")),
        row(""),
        row(theme.fg("dim", "  sf-skills bumps a per-skill counter every time you type:")),
        row(""),
        row(theme.fg("accent", "      /skill:sf-apex     /skill:sf-soql     /skill:sf-flow")),
        row(""),
        row(theme.fg("dim", "  Counters live at:")),
        row(theme.fg("dim", "    Global   ~/.pi/agent/sf-pi/sf-skills/usage.json")),
        row(
          theme.fg("dim", "    Project  <project>/.pi/sf-skills-usage.json (only when in a repo)"),
        ),
      ];
      while (lines.length < view.viewport + 2) lines.push(row(""));
      return lines;
    }

    const out: string[] = [
      row(theme.fg("muted", "  Top usage    Showing global + project (merged)")),
      row(theme.fg("border", `  ${"─".repeat(70)}`)),
    ];
    const totalSF = top
      .filter((r) => r.klass === "salesforce")
      .reduce((s, r) => s + r.usageCount, 0);
    const totalExt = top
      .filter((r) => r.klass === "external")
      .reduce((s, r) => s + r.usageCount, 0);
    top.forEach((r, i) => {
      const klassColor = r.klass === "salesforce" ? "success" : "muted";
      const klass = theme.fg(klassColor, r.klass === "salesforce" ? "SF " : "Ext");
      out.push(
        row(
          `  ${theme.fg("muted", padRight(String(i + 1), 3))} ${pad(
            truncateToWidth(r.name, 28, "…"),
            28,
          )} ${klass}  ${theme.fg("accent", padRight(String(r.usageCount), 6))} ${theme.fg(
            "dim",
            r.lastUsedAt ?? "",
          )}`,
        ),
      );
    });
    while (out.length < view.viewport) out.push(row(""));
    out.push(row(""));
    out.push(
      row(
        `  ${theme.fg("muted", "Salesforce skills")}  ${theme.fg("success", String(totalSF))}      ${theme.fg(
          "muted",
          "External skills",
        )}  ${theme.fg("success", String(totalExt))}`,
      ),
    );
    return out;
  }

  // -----------------------------------------------------------------------------------------------
  // Footer (Selected / Source / Action / key hints)
  // -----------------------------------------------------------------------------------------------

  private renderFooter(theme: Theme, view: ViewportInfo): string[] {
    const sel = this.selectedRow();
    const name = sel ? sel.name : theme.fg("muted", "—");
    const sourcePath = sel ? sel.path : theme.fg("muted", "—");
    const action = this.actionHint(sel);
    void view;

    return [
      ` ${theme.fg("muted", "Selected")}   ${name}`,
      ` ${theme.fg("muted", "Source  ")}   ${theme.fg("dim", sourcePath)}`,
      ` ${theme.fg("muted", "Action  ")}   ${action}`,
      "",
      ` ${theme.fg("dim", "enter apply changes  ·  esc cancel  ·  / filter  ·  1/2/3 jump tab  ·  pgup/pgdn page")}`,
    ];
  }

  private selectedRow(): { name: string; path: string; row: ActiveRow | DiscoverRow } | null {
    if (this.tab === "active") {
      const r = this.activeRowsFiltered()[this.cursor.active];
      if (!r) return null;
      return { name: r.name, path: r.skillPath, row: r };
    }
    if (this.tab === "discover") {
      const r = this.discoverRowsFiltered()[this.cursor.discover];
      if (!r) return null;
      if (r.discover === "active") {
        return { name: r.name, path: r.skillPath, row: r };
      }
      return { name: r.label, path: r.absolutePath, row: r };
    }
    return null;
  }

  private actionHint(sel: ReturnType<SkillsTableOverlayComponent["selectedRow"]>): string {
    const theme = this.theme;
    if (!sel) return theme.fg("dim", "—");
    const r = sel.row;
    // Discover candidate.
    if ("discover" in r && r.discover === "candidate") {
      const verb = this.candidates.has(`${r.absolutePath}|${r.scope}`) ? "unwire" : "wire";
      return `${theme.fg("accent", "space")} → ${verb} as ${r.scope} source`;
    }
    // Active row (or "discover === active" — shape is same).
    const active = r as ActiveRow;
    if (active.readOnly) {
      return theme.fg(
        "dim",
        "auto-discovered or bundled — toggle the source root via /sf-pi skills, or move the dir",
      );
    }
    return [actionFor(theme, active, "global"), actionFor(theme, active, "project")].join(
      `   ${theme.fg("muted", "·")}   `,
    );
  }

  // -----------------------------------------------------------------------------------------------
  // Filtering
  // -----------------------------------------------------------------------------------------------

  private activeRowsFiltered(): ActiveRow[] {
    const f = this.filterText.trim().toLowerCase();
    if (!f) return this.props.active;
    return this.props.active.filter((r) => matchesFilter(r.name, r.sourceLabel, f));
  }

  private discoverRowsFiltered(): DiscoverRow[] {
    const f = this.filterText.trim().toLowerCase();
    if (!f) return this.props.discover;
    return this.props.discover.filter((r) =>
      r.discover === "active"
        ? matchesFilter(r.name, r.sourceLabel, f)
        : matchesFilter(r.label, r.absolutePath, f),
    );
  }

  // -----------------------------------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------------------------------

  private pendingForRow(r: ActiveRow): "enable" | "disable" | null {
    for (const t of this.toggles.values()) {
      if (t.name === r.name) return t.enable ? "enable" : "disable";
    }
    return null;
  }

  private viewportInfo(): ViewportInfo {
    const terminalRows = this.lastTerminalRows;
    const viewport = viewportSize(terminalRows);
    const total =
      this.tab === "active"
        ? this.activeRowsFiltered().length
        : this.tab === "discover"
          ? this.discoverRowsFiltered().length
          : 0;
    const result: SliceResult = slice(
      { cursor: this.cursor[this.tab], offset: this.offset[this.tab] },
      total,
      viewport,
    );
    return {
      ...result,
      viewport,
      total,
      terminalRows,
      offsetDisplay: total === 0 ? 0 : result.offset + 1,
      endDisplay: result.end,
    };
  }

  private scrollGlyph(theme: Theme, view: ViewportInfo, index: number): string {
    if (view.total <= view.viewport) return "  ";
    if (index === view.offset && view.canScrollUp) return theme.fg("accent", "▲");
    if (index === view.end - 1 && view.canScrollDown) return theme.fg("accent", "▼");
    return theme.fg("border", "║");
  }
}

// -------------------------------------------------------------------------------------------------
// Module-level helpers
// -------------------------------------------------------------------------------------------------

interface ViewportInfo extends SliceResult {
  viewport: number;
  total: number;
  terminalRows: number;
  /** 1-based first-visible row for the status bar. */
  offsetDisplay: number;
  /** 1-based last-visible row for the status bar. */
  endDisplay: number;
}

function nextTab(current: TabId, delta: number): TabId {
  const idx = TABS.findIndex((t) => t.id === current);
  const next = (idx + delta + TABS.length) % TABS.length;
  return TABS[next]?.id ?? current;
}

function wiredAt(wired: WiredScope, scope: "global" | "project"): boolean {
  if (wired === "both") return true;
  return wired === scope;
}

function pad(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

function padRight(text: string, width: number): string {
  return `${" ".repeat(Math.max(0, width - visibleWidth(text)))}${text}`;
}

function boxRow(theme: Theme, innerWidth: number, content: string): string {
  const padded = pad(truncateToWidth(content, innerWidth, ""), innerWidth);
  return `${theme.fg("border", "│")}${padded}${theme.fg("border", "│")}`;
}

/**
 * Anchor a single character (the scroll glyph or a placeholder space) to
 * the right edge of the row. Reserves 2 columns at the right (" " + glyph)
 * and pads the data area with spaces so the glyph always lands at
 * `innerWidth - 1`. Without this, boxRow's trailing-space padding pushes
 * the glyph into the middle of the row, leaving an obvious dead-space
 * gap between the data and the scroll indicator.
 */
function rightAnchor(innerWidth: number, data: string, rightChar: string): string {
  const reserve = 2; // " " + 1-char glyph
  const dataWidth = visibleWidth(data);
  const target = Math.max(0, innerWidth - reserve);
  if (dataWidth >= target) {
    return `${truncateToWidth(data, target, "…")} ${rightChar}`;
  }
  return `${data}${" ".repeat(target - dataWidth)} ${rightChar}`;
}

function matchesFilter(a: string, b: string, query: string): boolean {
  if (!query) return true;
  return a.toLowerCase().includes(query) || b.toLowerCase().includes(query);
}

function actionFor(theme: Theme, r: ActiveRow, scope: "global" | "project"): string {
  const key = scope === "global" ? "g" : "p";
  const wired = wiredAt(r.wired, scope);
  if (wired) {
    return `${theme.fg("accent", key)} → disable in ${scope}`;
  }
  // Cross-scope coverage check (cheap, no I/O — derived from wired field):
  // if the OTHER scope already has it, enabling here would duplicate.
  const otherScope = scope === "global" ? "project" : "global";
  if (wiredAt(r.wired, otherScope)) {
    return `${theme.fg("dim", key)} → already covered by ${otherScope} (no-op)`;
  }
  return `${theme.fg("accent", key)} → enable in ${scope}`;
}
