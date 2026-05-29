/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Skill Funnel view overlay.
 *
 * Five tabs — Catalog / Sources / Global / Project / Conflicts — rendered over
 * a single SkillCatalog snapshot. The component only stages intent
 * (FunnelAction[]); index.ts compiles each action through the Resolution
 * Policy into native settings.skills[] ops, then reloads. Pure folds + the
 * staging reducer live in model.ts.
 *
 * Layout matches the agreed ASCII spec: a narrowing funnel strip, a tab bar,
 * a scrolling body, a pending-changes status line, and a key-hint footer.
 */
import { type Focusable, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { CatalogConflict, CatalogSkill, CatalogSource } from "../catalog.ts";
import { jumpToEnd, jumpToStart, slice, step, viewportSize, type SliceResult } from "./viewport.ts";
import { fitColumns, renderColumns, type Cell, type ColumnSpec } from "./layout.ts";
import {
  conflictRows,
  describePending,
  FUNNEL_TABS,
  funnelCounts,
  skillGateRows,
  sourceRows,
  stageKey,
  tabCount,
} from "./model.ts";
import type { FunnelAction, FunnelResult, FunnelTab, FunnelViewProps } from "./types.ts";

type Scope = "global" | "project";

/** Flattened conflict row: a non-selectable header or a selectable copy. */
type ConflictNavRow =
  | { type: "header"; conflict: CatalogConflict }
  | { type: "copy"; conflict: CatalogConflict; copy: CatalogSkill };

// Cap the content width so the table stays scannable on ultrawide monitors
// while still expanding to show full paths on normal-to-wide terminals. Pi
// re-calls render(width) on resize, so columns reflow between these bounds.
const MIN_INNER = 84;
const MAX_INNER = 150;
const LAYOUT = { gap: 1, leftPad: 1, rightPad: 2 } as const;

// Per-tab column specs. weight>0 columns flex; the rest stay at `min`.
// Skill + Source carry the flex weight so wide terminals reveal full paths.
const COLUMNS: Record<FunnelTab, ColumnSpec[]> = {
  catalog: [
    { key: "cur", header: "", min: 1 },
    { key: "name", header: "Skill", min: 20, weight: 3 },
    { key: "source", header: "Source", min: 16, weight: 5 },
    { key: "funnel", header: "Funnel", min: 9 },
    { key: "flag", header: "Scope", min: 7 },
    { key: "used", header: "Used", min: 5, align: "right" },
  ],
  sources: [
    { key: "cur", header: "", min: 1 },
    { key: "label", header: "Source", min: 20, weight: 5 },
    { key: "kind", header: "Kind", min: 8 },
    { key: "gate", header: "Gate", min: 8 },
    { key: "skills", header: "Skills", min: 6, align: "right" },
    { key: "loaded", header: "Loaded", min: 6, align: "right" },
    { key: "scope", header: "Scope", min: 8 },
  ],
  global: skillGateColumns("Global"),
  project: skillGateColumns("Project"),
  conflicts: [],
};

function skillGateColumns(scopeLabel: string): ColumnSpec[] {
  return [
    { key: "cur", header: "", min: 1 },
    { key: "name", header: "Skill", min: 20, weight: 4 },
    { key: "source", header: "Source", min: 16, weight: 4 },
    { key: "box", header: scopeLabel, min: 6 },
    { key: "state", header: "State", min: 14, weight: 2 },
  ];
}

export class SkillFunnelViewComponent implements Focusable {
  focused = false;

  private tab: FunnelTab = "catalog";
  private cursor: Record<FunnelTab, number> = {
    catalog: 0,
    sources: 0,
    global: 0,
    project: 0,
    conflicts: 0,
  };
  private offset: Record<FunnelTab, number> = {
    catalog: 0,
    sources: 0,
    global: 0,
    project: 0,
    conflicts: 0,
  };

  private filterText = "";
  private filterFocused = false;
  private addText = "";
  private addFocused = false;
  private notice = "";
  private showLegend = false;

  private staged = new Map<string, FunnelAction>();
  private lastTerminalRows = 28;

  constructor(
    private readonly theme: Theme,
    private readonly props: FunnelViewProps,
    private readonly done: (result: FunnelResult) => void,
  ) {}

  // -----------------------------------------------------------------------------------------------
  // Input
  // -----------------------------------------------------------------------------------------------

  handleInput(data: string): void {
    if (this.filterFocused) return this.handleTextInput(data, "filter");
    if (this.addFocused) return this.handleTextInput(data, "add");

    this.notice = "";

    // The legend is a modal read: any key dismisses it.
    if (this.showLegend) {
      this.showLegend = false;
      return;
    }
    if (data === "?") {
      this.showLegend = true;
      return;
    }

    if (matchesKey(data, "escape") || data === "q") {
      this.done({ kind: "cancel" });
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      this.done({ kind: "apply", actions: [...this.staged.values()] });
      return;
    }
    if (matchesKey(data, "tab") || matchesKey(data, "right") || data === "l") {
      this.switchTab(+1);
      return;
    }
    if (matchesKey(data, "left") || data === "h") {
      this.switchTab(-1);
      return;
    }
    if (data >= "1" && data <= "5") {
      const tab = FUNNEL_TABS[Number(data) - 1];
      if (tab) this.tab = tab.id;
      return;
    }
    if (data === "/") {
      this.filterFocused = true;
      return;
    }
    if (data === "a" && this.tab === "sources") {
      this.addFocused = true;
      this.addText = "";
      return;
    }

    const view = this.viewportInfo();
    if (matchesKey(data, "up") || data === "k") return this.applyStep(-1, view);
    if (matchesKey(data, "down") || data === "j") return this.applyStep(+1, view);
    if (matchesKey(data, "pageUp")) return this.applyStep(-view.viewport, view);
    if (matchesKey(data, "pageDown")) return this.applyStep(+view.viewport, view);
    if (matchesKey(data, "home")) return this.jump(jumpToStart(view.total, view.viewport));
    if (matchesKey(data, "end")) return this.jump(jumpToEnd(view.total, view.viewport));

    if (data === "g" || data === "G" || matchesKey(data, "space")) {
      if (this.tab === "sources") this.toggleSourceGateAtCursor();
      else this.toggleSkillGateAtCursor("global");
      return;
    }
    if (data === "p" || data === "P") {
      if (this.tab !== "sources") this.toggleSkillGateAtCursor("project");
      return;
    }
    if (data === "w" || data === "W") {
      if (this.tab === "conflicts") this.pickWinnerAtCursor();
      return;
    }
    if (data === "r" || data === "R") {
      if (this.tab === "conflicts") this.resolveByFileAtCursor();
      return;
    }
    if (data === "c" || data === "C") {
      if (this.tab === "conflicts") {
        if (this.staged.size > 0) {
          this.notice = "apply or cancel pending changes before consolidating";
          return;
        }
        this.done({ kind: "consolidate" });
      }
      return;
    }
    if (data === "m") {
      this.rescopeAtCursor();
      return;
    }
    if (data === "M") {
      this.rescopeAllGlobal();
      return;
    }
  }

  /** `m`: move the cursor's skill (Global/Project tab) or whole source (Sources tab) to project. */
  private rescopeAtCursor(): void {
    if (this.staged.size > 0) {
      this.notice = "apply or cancel pending changes before moving to project";
      return;
    }
    if (this.tab === "sources") {
      const src = this.sourceRowsFiltered()[this.cursor.sources];
      if (!src) return;
      const paths = this.props.catalog.skills
        .filter((s) => s.sourceId === src.id && s.enabledGlobal)
        .map((s) => s.filePath);
      if (paths.length === 0) {
        this.notice = "no global-enabled skills under this source to move";
        return;
      }
      this.done({ kind: "rescope", skillPaths: paths, label: `source "${src.label}"` });
      return;
    }
    if (this.tab === "global" || this.tab === "project" || this.tab === "catalog") {
      const rows = this.tab === "catalog" ? this.catalogRowsFiltered() : this.skillRowsFiltered();
      const row = rows[this.cursor[this.tab]];
      if (!row) return;
      if (!row.enabledGlobal) {
        this.notice = "only globally-enabled skills can be moved to project";
        return;
      }
      this.done({ kind: "rescope", skillPaths: [row.filePath], label: row.name });
    }
  }

  /** `M`: move every global-enabled skill to the current project. */
  private rescopeAllGlobal(): void {
    if (this.staged.size > 0) {
      this.notice = "apply or cancel pending changes before moving to project";
      return;
    }
    const paths = this.props.catalog.skills.filter((s) => s.enabledGlobal).map((s) => s.filePath);
    if (paths.length === 0) {
      this.notice = "no global-enabled skills to move";
      return;
    }
    this.done({ kind: "rescope", skillPaths: paths, label: "all global skills" });
  }

  /**
   * Hand a conflict off to the interactive resolve flow (disable/move/delete).
   * The component can't open confirm dialogs, so it returns to index.ts. We
   * refuse if there are unsaved staged toggles so nothing is silently dropped.
   */
  private resolveByFileAtCursor(): void {
    const rows = this.conflictNavRows();
    const row = rows[this.cursor.conflicts];
    if (!row || row.type !== "copy") {
      this.notice = "move to a copy row, then r to keep it and resolve the others by file";
      return;
    }
    if (this.staged.size > 0) {
      this.notice = "apply or cancel pending changes before resolving by file";
      return;
    }
    this.done({ kind: "resolve", name: row.conflict.name, winnerPath: row.copy.filePath });
  }

  private handleTextInput(data: string, which: "filter" | "add"): void {
    const get = () => (which === "filter" ? this.filterText : this.addText);
    const set = (v: string) => {
      if (which === "filter") this.filterText = v;
      else this.addText = v;
    };
    if (matchesKey(data, "escape")) {
      set("");
      if (which === "filter") this.filterFocused = false;
      else this.addFocused = false;
      this.resetCursor();
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      if (which === "filter") {
        this.filterFocused = false;
      } else {
        const value = this.addText.trim();
        if (value) {
          this.stage({ kind: "add-source", value, scope: "global" });
          this.notice = `staged add source ${value}`;
        }
        this.addFocused = false;
        this.addText = "";
      }
      return;
    }
    if (matchesKey(data, "backspace")) {
      set(get().slice(0, -1));
      if (which === "filter") this.resetCursor();
      return;
    }
    if (data.length === 1 && data >= " " && data !== "\x7f") {
      set(get() + data);
      if (which === "filter") this.resetCursor();
    }
  }

  private switchTab(delta: number): void {
    const idx = FUNNEL_TABS.findIndex((t) => t.id === this.tab);
    this.tab = FUNNEL_TABS[(idx + delta + FUNNEL_TABS.length) % FUNNEL_TABS.length]?.id ?? this.tab;
  }

  private resetCursor(): void {
    this.cursor[this.tab] = 0;
    this.offset[this.tab] = 0;
  }

  private jump(r: SliceResult): void {
    this.cursor[this.tab] = r.cursor;
    this.offset[this.tab] = r.offset;
  }

  private applyStep(delta: number, view: ViewportInfo): void {
    const r = step(
      { cursor: this.cursor[this.tab], offset: this.offset[this.tab] },
      delta,
      view.total,
      view.viewport,
    );
    this.jump(r);
  }

  // -----------------------------------------------------------------------------------------------
  // Staging
  // -----------------------------------------------------------------------------------------------

  private stage(action: FunnelAction): void {
    const key = stageKey(action);
    if (this.staged.has(key)) this.staged.delete(key);
    else this.staged.set(key, action);
  }

  private toggleSkillGateAtCursor(scope: Scope): void {
    const rows = this.skillRowsFiltered();
    const row = rows[this.cursor[this.tab]];
    if (!row) return;
    const blocked = this.blockedReason(row, scope);
    if (blocked) {
      this.notice = blocked;
      return;
    }
    const enable = scope === "global" ? !row.enabledGlobal : !row.enabledProject;
    this.stage({ kind: "skill-gate", name: row.name, skillPath: row.filePath, scope, enable });
  }

  private toggleSourceGateAtCursor(): void {
    const rows = this.sourceRowsFiltered();
    const row = rows[this.cursor.sources];
    if (!row) return;
    if (row.autoDefault) {
      this.notice = "auto-discovered default — always seen, cannot turn off";
      return;
    }
    this.stage({
      kind: "source-gate",
      sourceId: row.id,
      value: row.id,
      scope: "global",
      seen: row.gate === "off",
    });
  }

  private pickWinnerAtCursor(): void {
    const rows = this.conflictNavRows();
    const row = rows[this.cursor.conflicts];
    if (!row || row.type !== "copy") {
      this.notice = "move to a copy row to pick a winner";
      return;
    }
    if (row.conflict.kind === "report-only") {
      this.notice = "report-only: a default root always wins — move the file to change it";
      return;
    }
    this.stage({ kind: "conflict-winner", name: row.conflict.name, winnerPath: row.copy.filePath });
  }

  /** Returns a hint string when a skill-gate toggle is blocked, else "". */
  private blockedReason(row: CatalogSkill, scope: Scope): string {
    if (scope === "project" && row.enabledGlobal && !row.enabledProject) {
      return "enabled globally — disable at global scope, or enable narrowly instead";
    }
    if (
      row.autoDefault &&
      (scope === "global" ? row.enabledGlobal : row.enabledProject) === false
    ) {
      // auto-default skills are loaded by default; enabling is a no-op, disabling impossible.
      return "auto-discovered default — always loaded, no settings toggle needed";
    }
    return "";
  }

  // -----------------------------------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------------------------------

  render(width: number): string[] {
    const innerWidth = Math.min(Math.max(MIN_INNER, width - 2), MAX_INNER);
    const view = this.viewportInfo();
    this.lastTerminalRows = view.terminalRows;
    const theme = this.theme;
    const row = (c = "") => boxRow(theme, innerWidth, c);
    const sep = () =>
      `${theme.fg("border", "├")}${theme.fg("border", "─".repeat(innerWidth))}${theme.fg("border", "┤")}`;

    const out: string[] = [];
    out.push(
      `${theme.fg("border", "╭")}${theme.fg("border", "─".repeat(innerWidth))}${theme.fg("border", "╮")}`,
    );
    out.push(row(""));
    out.push(row(this.renderFunnelStrip(theme)));
    out.push(row(""));
    out.push(row(this.renderTabStrip(theme, innerWidth)));
    out.push(row(this.renderCaption(theme)));
    out.push(sep());
    out.push(
      ...(this.showLegend
        ? this.renderLegend(theme, view, row)
        : this.renderBody(theme, innerWidth, view, row)),
    );
    out.push(sep());
    out.push(row(this.renderStatusLine(theme, view)));
    out.push(row(this.renderHints(theme)));
    out.push(
      `${theme.fg("border", "╰")}${theme.fg("border", "─".repeat(innerWidth))}${theme.fg("border", "╯")}`,
    );
    return out;
  }

  invalidate(): void {}

  private renderFunnelStrip(theme: Theme): string {
    const c = funnelCounts(this.props.catalog);
    const arrow = theme.fg("border", " ─► ");
    const seg = (label: string, n: number) =>
      `${theme.fg("muted", label)} ${theme.fg("accent", String(n))}`;
    const conf = c.conflicts > 0 ? theme.fg("warning", ` ✦${c.conflicts}`) : "";
    return (
      ` ${seg("Catalog", c.catalog)}${arrow}${seg("Seen", c.seen)}${arrow}` +
      `${seg("Global", c.global)}${arrow}${seg("Project", c.project)}${arrow}` +
      `${seg("Effective", c.effective)}${conf}`
    );
  }

  /** One-line, plain-language description of the current tab + its columns. */
  private renderCaption(theme: Theme): string {
    const text: Record<FunnelTab, string> = {
      catalog:
        "Every skill found everywhere. Funnel = where it lands · Scope = G/P/default · Used = invocations.",
      sources:
        "Source Gate — which roots Pi may load from. g toggles · a adds a path · m moves a source to project.",
      global:
        "Skill Gate (global) — wired for every project. g toggles · m moves a skill to project · M moves all.",
      project:
        "Skill Gate (project) — wired for THIS project only. p toggles · globally-on shows locked (m to move).",
      conflicts:
        "Same skill name from 2+ sources. w = rewire winner · r = resolve by file · c = consolidate global+project dupes.",
    };
    return ` ${theme.fg("dim", `${text[this.tab]}  ·  ? legend`)}`;
  }

  /** Full legend overlay (toggled with ?). Explains every funnel term once. */
  private renderLegend(theme: Theme, view: ViewportInfo, row: (c?: string) => string): string[] {
    const h = (s: string) => theme.fg("toolTitle", s);
    const k = (s: string) => theme.fg("accent", s);
    const d = (s: string) => theme.fg("dim", s);
    const lines = [
      "",
      `  ${h("The funnel")}  ${d("the catalog narrows left → right to what Pi actually loads")}`,
      `    ${k("Catalog")}    every skill found on disk, across every source`,
      `    ${k("Seen")}       copies whose Source Gate is open (a root Pi may load from)`,
      `    ${k("Global")}     skills enabled at global scope (every project)`,
      `    ${k("Project")}    skills enabled for the current project only`,
      `    ${k("Effective")}  what Pi loads right now, after conflicts are resolved`,
      "",
      `  ${h("Gates")}`,
      `    ${k("Source Gate")}  whole-root: is this source allowed to contribute skills at all`,
      `    ${k("Skill Gate")}   per-skill on/off, evaluated separately for global and project`,
      "",
      `  ${h("Funnel column")}`,
      `    ${theme.fg("success", "✓loaded")}   in context now`,
      `    ${theme.fg("success", "✦winner")}   won a name conflict`,
      `    ${theme.fg("warning", "✦shadow")}   lost a conflict / shadowed by another copy`,
      `    ${theme.fg("muted", "○gated")}    not loaded (source off or skill off)`,
      "",
      `  ${h("Scope flags")}   ${k("G")} global · ${k("P")} project · ${d("default")} auto-discovered · ${d("—")} not wired`,
      `  ${h("Move")}          ${k("m")} move skill/source global→project · ${k("M")} move all global → this project`,
      `  ${h("Conflicts")}     ${k("RESOLVABLE")} rewire (w) · ${theme.fg("warning", "REPORT-ONLY")} file action (r) · ${k("c")} consolidate global+project dupes`,
      "",
      d("  press any key to close"),
    ];
    const out = lines.map((l) => row(l));
    while (out.length < view.viewport + 2) out.push(row(""));
    return out;
  }

  private renderTabStrip(theme: Theme, innerWidth: number): string {
    // Compact form (no per-tab counts, keep the conflict badge) when the full
    // strip would overflow a narrow terminal.
    const build = (withCounts: boolean): string => {
      const parts = FUNNEL_TABS.map((t, i) => {
        const n = tabCount(this.props.catalog, t.id);
        const badge = t.id === "conflicts" && n > 0 ? ` ✦${n}` : withCounts ? ` (${n})` : "";
        const label = `${i + 1} ${t.label}${badge}`;
        return t.id === this.tab
          ? theme.fg("accent", theme.bold(`[ ${label} ]`))
          : theme.fg("muted", `  ${label}  `);
      });
      return ` ${parts.join(withCounts ? "  " : " ")}`;
    };
    const full = build(true);
    return visibleWidth(full) <= innerWidth - 1 ? full : build(false);
  }

  private renderBody(
    theme: Theme,
    innerWidth: number,
    view: ViewportInfo,
    row: (c?: string) => string,
  ): string[] {
    const out: string[] = [];
    const widths =
      this.tab === "conflicts" ? [] : fitColumns(innerWidth, COLUMNS[this.tab], LAYOUT);
    out.push(row(this.renderHeader(theme, innerWidth, widths)));
    out.push(row(theme.fg("border", `  ${"─".repeat(Math.max(0, innerWidth - 4))}`)));

    if (view.total === 0) {
      out.push(row(theme.fg("dim", "  Nothing here.")));
    } else if (this.tab === "sources") {
      const rows = this.sourceRowsFiltered();
      this.renderRange(view, (i) => {
        const r = rows[i];
        if (r) out.push(row(this.renderSourceRow(theme, innerWidth, widths, r, i, view)));
      });
    } else if (this.tab === "conflicts") {
      const rows = this.conflictNavRows();
      this.renderRange(view, (i) => {
        const r = rows[i];
        if (r) out.push(row(this.renderConflictRow(theme, innerWidth, r, i, view)));
      });
    } else {
      const rows = this.tab === "catalog" ? this.catalogRowsFiltered() : this.skillRowsFiltered();
      this.renderRange(view, (i) => {
        const r = rows[i];
        if (r) out.push(row(this.renderSkillRow(theme, innerWidth, widths, r, i, view)));
      });
    }
    while (out.length < view.viewport + 2) out.push(row(""));
    return out;
  }

  private renderRange(view: ViewportInfo, emit: (i: number) => void): void {
    for (let i = view.offset; i < view.end; i++) emit(i);
  }

  private renderHeader(theme: Theme, innerWidth: number, widths: number[]): string {
    if (this.tab === "conflicts") {
      return ` ${theme.fg("muted", "Conflicts — ● winner · ○ loser · w rewire winner · r resolve by file")}`;
    }
    const cells: Cell[] = COLUMNS[this.tab].map((s) => ({
      text: theme.fg("muted", s.header),
      align: s.align,
    }));
    return renderColumns(cells, widths, LAYOUT);
  }

  // ---- skill rows (catalog / global / project) ----
  private renderSkillRow(
    theme: Theme,
    innerWidth: number,
    widths: number[],
    r: CatalogSkill,
    index: number,
    view: ViewportInfo,
  ): string {
    const isCursor = index === view.cursor;
    const cur = isCursor ? theme.fg("accent", "▸") : "";
    const scope: Scope | null =
      this.tab === "global" ? "global" : this.tab === "project" ? "project" : null;
    const pending = this.pendingGlyph(r, scope);

    let cells: Cell[];
    if (scope) {
      const on = scope === "global" ? r.enabledGlobal : r.enabledProject;
      const box = pending ?? (on ? theme.fg("success", "[✓]") : theme.fg("muted", "[ ]"));
      cells = [
        { text: cur },
        { text: r.name },
        { text: theme.fg("dim", r.sourceLabel) },
        { text: box },
        { text: this.skillState(theme, r, scope) },
      ];
    } else {
      const used = r.usage ? String(r.usage.count) : theme.fg("dim", "·");
      cells = [
        { text: cur },
        { text: r.name },
        { text: theme.fg("dim", r.sourceLabel) },
        { text: this.funnelGlyph(theme, r) },
        { text: this.scopeFlag(theme, r) },
        { text: used, align: "right" },
      ];
    }
    return this.composeScrollRow(
      theme,
      innerWidth,
      renderColumns(cells, widths, LAYOUT),
      index,
      view,
      isCursor,
    );
  }

  private renderSourceRow(
    theme: Theme,
    innerWidth: number,
    widths: number[],
    r: CatalogSource,
    index: number,
    view: ViewportInfo,
  ): string {
    const isCursor = index === view.cursor;
    const cur = isCursor ? theme.fg("accent", "▸") : "";
    const stagedSeen = this.stagedSourceSeen(r);
    const seen = stagedSeen ?? r.gate === "seen";
    const gate = r.autoDefault
      ? theme.fg("success", "◉ on")
      : seen
        ? theme.fg("success", "◉ seen")
        : theme.fg("muted", "○ off");
    const cells: Cell[] = [
      { text: cur },
      { text: r.label },
      { text: theme.fg("muted", r.kind) },
      { text: gate },
      { text: String(r.counts.total), align: "right" },
      { text: String(r.counts.loaded), align: "right" },
      { text: r.autoDefault ? theme.fg("dim", "—") : theme.fg("muted", "global") },
    ];
    return this.composeScrollRow(
      theme,
      innerWidth,
      renderColumns(cells, widths, LAYOUT),
      index,
      view,
      isCursor,
    );
  }

  /** Pad the row body to the inner width and pin a scroll glyph in the right gutter. */
  private composeScrollRow(
    theme: Theme,
    innerWidth: number,
    body: string,
    index: number,
    view: ViewportInfo,
    isCursor: boolean,
  ): string {
    const target = Math.max(0, innerWidth - 2);
    const w = visibleWidth(body);
    const padded = w >= target ? truncateToWidth(body, target, "…") : body + " ".repeat(target - w);
    const line = `${padded} ${this.scrollGlyph(theme, view, index)}`;
    return isCursor ? theme.fg("accent", line) : line;
  }

  private scrollGlyph(theme: Theme, view: ViewportInfo, index: number): string {
    if (view.total <= view.viewport) return " ";
    if (index === view.offset && view.canScrollUp) return theme.fg("accent", "▲");
    if (index === view.end - 1 && view.canScrollDown) return theme.fg("accent", "▼");
    return theme.fg("border", "║");
  }

  private renderConflictRow(
    theme: Theme,
    innerWidth: number,
    r: ConflictNavRow,
    index: number,
    view: ViewportInfo,
  ): string {
    const isCursor = index === view.cursor;
    if (r.type === "header") {
      const tag =
        r.conflict.kind === "report-only"
          ? theme.fg("warning", "REPORT-ONLY ⚠")
          : theme.fg("accent", "RESOLVABLE");
      return ` ${theme.fg("toolTitle", trunc(r.conflict.name, 36))}   ${tag}`;
    }
    const cur = isCursor ? theme.fg("accent", "▸") : " ";
    const isWinner = r.copy.conflictRole === "winner";
    const stagedWinner = this.staged.get(`winner|${r.conflict.name}`);
    const willWin =
      stagedWinner &&
      stagedWinner.kind === "conflict-winner" &&
      stagedWinner.winnerPath === r.copy.filePath;
    const dot = willWin
      ? theme.fg("accent", "●")
      : isWinner
        ? theme.fg("success", "●")
        : theme.fg("muted", "○");
    const role = willWin
      ? theme.fg("accent", "→ winner (staged)")
      : isWinner
        ? theme.fg("success", "winner")
        : r.conflict.kind === "report-only"
          ? theme.fg("dim", "default wins · r to move/delete")
          : theme.fg("muted", "w rewire · r file");
    const cells = `${pad(cur, 2)}   ${dot} ${pad(trunc(r.copy.sourceLabel, 28), 28)} ${role}`;
    return tint(theme, isCursor, ` ${cells}`);
  }

  // ---- glyph helpers ----
  private funnelGlyph(theme: Theme, r: CatalogSkill): string {
    if (r.conflictRole === "winner") return theme.fg("success", "✦winner");
    if (r.conflictRole === "loser" || r.conflictRole === "report-only-loser")
      return theme.fg("warning", "✦shadow");
    if (r.effective === "loaded") return theme.fg("success", "✓loaded");
    if (r.effective === "shadowed") return theme.fg("warning", "✦shadow");
    return theme.fg("muted", "○gated");
  }

  private scopeFlag(theme: Theme, r: CatalogSkill): string {
    if (r.autoDefault) return theme.fg("muted", "default");
    if (!r.seen) return theme.fg("dim", "—");
    if (r.enabledGlobal && r.enabledProject) return theme.fg("success", "G+P");
    if (r.enabledGlobal) return theme.fg("success", "G");
    if (r.enabledProject) return theme.fg("success", "P");
    return theme.fg("dim", "—");
  }

  private skillState(theme: Theme, r: CatalogSkill, scope: Scope): string {
    if (r.autoDefault) return theme.fg("dim", "default · locked");
    if (scope === "project" && r.enabledGlobal && !r.enabledProject)
      return theme.fg("dim", "on globally · locked");
    if (r.effective === "loaded") return theme.fg("success", "loaded");
    if (r.effective === "shadowed") return theme.fg("warning", "shadowed");
    return theme.fg("muted", "off");
  }

  private pendingGlyph(r: CatalogSkill, scope: Scope | null): string | null {
    if (!scope) return null;
    const action = this.staged.get(`skill|${scope}|${r.filePath}`);
    if (!action || action.kind !== "skill-gate") return null;
    return action.enable ? this.theme.fg("accent", "[+]") : this.theme.fg("accent", "[-]");
  }

  private stagedSourceSeen(r: CatalogSource): boolean | null {
    const a = this.staged.get(`source|global|${r.id}`);
    if (!a || a.kind !== "source-gate") return null;
    return a.seen;
  }

  // ---- status + hints ----
  private renderStatusLine(theme: Theme, view: ViewportInfo): string {
    if (this.addFocused) {
      return ` ${theme.fg("muted", "Add custom path:")} ${theme.fg("accent", this.addText)}${theme.fg("accent", "█")}   ${theme.fg("dim", "enter stage · esc cancel")}`;
    }
    if (this.notice) return ` ${theme.fg("warning", this.notice)}`;
    const pending =
      this.staged.size > 0
        ? theme.fg("accent", describePending([...this.staged.values()]))
        : theme.fg("dim", "no pending changes");
    const filter = this.filterText
      ? `   ${theme.fg("muted", "filter:")} ${theme.fg("accent", this.filterText)}${this.filterFocused ? theme.fg("accent", "█") : ""}`
      : "";
    const pos =
      view.total > 0
        ? theme.fg("muted", `${view.offsetDisplay}–${view.endDisplay}/${view.total}`)
        : theme.fg("muted", "0");
    return ` ${pos}   pending: ${pending}${filter}`;
  }

  private renderHints(theme: Theme): string {
    const base = "↑↓ move · ←→ tab · g global";
    const extra =
      this.tab === "sources"
        ? " · a add path · m move source→project"
        : this.tab === "conflicts"
          ? " · w winner · r file · c consolidate"
          : " · p project · m move→project · M move all global";
    return ` ${theme.fg("dim", `${base}${extra} · / filter · ? legend · enter apply · esc close`)}`;
  }

  // -----------------------------------------------------------------------------------------------
  // Filtering + row sources
  // -----------------------------------------------------------------------------------------------

  private catalogRowsFiltered(): CatalogSkill[] {
    return filterSkills(this.props.catalog.skills, this.filterText);
  }
  private skillRowsFiltered(): CatalogSkill[] {
    return filterSkills(skillGateRows(this.props.catalog), this.filterText);
  }
  private sourceRowsFiltered(): CatalogSource[] {
    const f = this.filterText.trim().toLowerCase();
    const rows = sourceRows(this.props.catalog);
    return f ? rows.filter((s) => `${s.label} ${s.rootPath}`.toLowerCase().includes(f)) : rows;
  }
  private conflictNavRows(): ConflictNavRow[] {
    const out: ConflictNavRow[] = [];
    for (const conflict of conflictRows(this.props.catalog)) {
      out.push({ type: "header", conflict });
      for (const copy of conflict.copies) out.push({ type: "copy", conflict, copy });
    }
    return out;
  }

  // -----------------------------------------------------------------------------------------------
  // Viewport
  // -----------------------------------------------------------------------------------------------

  private viewportInfo(): ViewportInfo {
    const terminalRows = this.lastTerminalRows;
    const viewport = viewportSize(terminalRows);
    const total =
      this.tab === "sources"
        ? this.sourceRowsFiltered().length
        : this.tab === "conflicts"
          ? this.conflictNavRows().length
          : this.tab === "catalog"
            ? this.catalogRowsFiltered().length
            : this.skillRowsFiltered().length;
    const result = slice(
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
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

interface ViewportInfo extends SliceResult {
  viewport: number;
  total: number;
  terminalRows: number;
  offsetDisplay: number;
  endDisplay: number;
}

function filterSkills(skills: CatalogSkill[], filterText: string): CatalogSkill[] {
  const f = filterText.trim().toLowerCase();
  if (!f) return skills;
  return skills.filter((s) => `${s.name} ${s.sourceLabel}`.toLowerCase().includes(f));
}

function pad(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

function trunc(text: string, width: number): string {
  return truncateToWidth(text, width, "…");
}

function tint(theme: Theme, isCursor: boolean, line: string): string {
  return isCursor ? theme.fg("accent", line) : line;
}

function boxRow(theme: Theme, innerWidth: number, content: string): string {
  const padded = pad(truncateToWidth(content, innerWidth, ""), innerWidth);
  return `${theme.fg("border", "│")}${padded}${theme.fg("border", "│")}`;
}
