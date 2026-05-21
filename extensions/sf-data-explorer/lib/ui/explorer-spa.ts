/* SPDX-License-Identifier: Apache-2.0 */
import { Key, matchesKey, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { ExplorerMode, ExplorerStrategy, QueryBuildState, RunResult } from "../types.ts";
import { cacheStatus } from "../cache.ts";
import { saveResult, type ExportFormat } from "../export.ts";
import {
  formatValue,
  fit,
  isBackspaceKey,
  pad,
  stripAnsi,
  type ThemeLike,
  wrapPlain,
} from "../text.ts";
import { transportLabel, type SfDataExplorerTransportInfo } from "../transport.ts";

type FocusPane = "objects" | "fields" | "query";

export type ExplorerSpaResult =
  | { kind: "copyToEditor"; text: string; label: string }
  | { kind: "switchMode"; mode: ExplorerMode }
  | undefined;

export interface ExplorerSpaArgs<TObject, TField> {
  org: string;
  cwd: string;
  theme: ThemeLike;
  strategy: ExplorerStrategy<TObject, TField>;
  transportInfo?: SfDataExplorerTransportInfo;
  setEditorText: (text: string) => void;
  editText?: (title: string, text: string) => Promise<string | undefined>;
  select?: (title: string, items: string[]) => Promise<string | undefined>;
  notify: (message: string, level?: "info" | "warning" | "error") => void;
  done: (result?: ExplorerSpaResult) => void;
  requestRender: () => void;
}

export class ExplorerSpa<TObject, TField> implements Component {
  private objects: TObject[];
  private objectCacheLine: string;
  private objectCursor = 0;
  private objectScrollTop = 0;
  private objectQuery = "";
  private selectedObject: TObject | undefined;

  private fields: TField[] = [];
  private selectedFields = new Set<string>();
  private fieldCursor = 0;
  private fieldScrollTop = 0;
  private fieldQuery = "";

  private focus: FocusPane = "objects";
  private layoutMode: "columns" | "accordion" = "columns";
  private searchMode = false;
  private loading = false;
  private confirmQuit = false;
  private status: string;
  private whereClause = "";
  private limit: number;
  private editing: "where" | "limit" | null = null;
  private editBuffer = "";
  private queryText = "";
  private queryDirty = false;
  private queryEditing = false;
  private queryEditBuffer = "";
  private queryEditCursor = 0;

  private helpOpen = false;
  private saveMenuOpen = false;
  private saveMenuCursor = 0;
  private switchMenuOpen = false;
  private switchMenuCursor = 0;

  private result: RunResult | undefined;
  private error: string | undefined;
  private resultCursor = 0;
  private resultScrollTop = 0;
  private detailMode = false;
  private detailScrollTop = 0;

  private readonly pageSize = 18;
  private readonly resultPageSize = 10;
  private paneWeights: [number, number, number] = [0.3, 0.32, 0.38];
  private expanded = false;

  constructor(private readonly args: ExplorerSpaArgs<TObject, TField>) {
    this.objects = args.strategy.initialObjects();
    this.objectCacheLine = args.strategy.initialCacheLine();
    this.status = this.objectCacheLine;
    this.limit = args.strategy.defaultLimit;
    this.queryText = args.strategy.buildQuery(this.previewState());
  }

  handleInput(data: string): void {
    if (this.helpOpen) return this.handleHelpInput(data);
    if (this.saveMenuOpen) return void this.handleSaveMenuInput(data);
    if (this.switchMenuOpen) return this.handleSwitchMenuInput(data);
    if (this.queryEditing) return this.handleQueryEditInput(data);
    if (this.editing) return this.handleEditInput(data);
    if (this.detailMode) return this.handleDetailInput(data);
    if (this.searchMode) return this.handleSearchInput(data);
    if (this.confirmQuit) {
      if (
        matchesKey(data, Key.enter) ||
        matchesKey(data, Key.escape) ||
        data === "q" ||
        data.toLowerCase() === "y"
      )
        return this.args.done();
      this.confirmQuit = false;
      this.status = "Quit cancelled.";
      this.args.requestRender();
      return;
    }

    if (matchesKey(data, Key.ctrl("c"))) return this.args.done();
    if (data === "q") return this.askQuit();
    if (matchesKey(data, Key.escape)) {
      if (this.error || this.result) {
        this.error = undefined;
        this.result = undefined;
        this.args.requestRender();
        return;
      }
      return this.askQuit();
    }
    if (matchesKey(data, Key.left)) return this.moveFocus(-1);
    if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) return this.moveFocus(1);
    if (matchesKey(data, Key.up)) return this.move(-1);
    if (matchesKey(data, Key.down)) return this.move(1);
    if (matchesKey(data, Key.home)) return this.jump(false);
    if (matchesKey(data, Key.end)) return this.jump(true);
    if (data === "?") return this.openHelp();
    if (data === "t") return this.openSwitchMenu();
    if (data === "/") {
      this.searchMode = true;
      this.args.requestRender();
      return;
    }
    if (data === "c") return this.copyQuery();
    if (data === "r") return void this.runQuery();
    if (data === "f") return void this.forceReloadCurrent();
    if (data === "m" && this.args.strategy.alternateCatalog)
      return void this.toggleAlternateCatalog();
    if (data === "w") return this.enterEdit("where");
    if (data === "l" || data === "L") return this.enterEdit("limit");
    if (data === "e") return void this.editFullQuery();
    if (data === "b") return this.rebuildQuery(true);
    if (data === "s" || data === "S") return void this.saveLatestResult();
    if (data === "z") return this.toggleExpansion();
    if (data === "v") return this.toggleLayout();
    if (data === "[" || data === "<") return this.resizePane(-0.05);
    if (data === "]" || data === ">") return this.resizePane(0.05);
    if (this.focus === "objects" && (matchesKey(data, Key.enter) || data === " "))
      return void this.selectObject(false);
    if (this.focus === "fields") {
      if (matchesKey(data, Key.enter) || data === " ") return this.toggleField();
      if (data === "a") return this.selectVisibleFields(true);
      if (data === "n") return this.selectVisibleFields(false);
      if (data === "i") return this.invertVisibleFields();
    }
    if (this.focus === "query" && (matchesKey(data, Key.enter) || data === " "))
      return this.openDetail();
  }

  render(width: number): string[] {
    const w = Math.max(90, width);
    const t = this.args.theme;
    const title = this.args.strategy.title(this.args.org);
    const pill = this.args.transportInfo
      ? t.fg("borderAccent", `[${transportLabel(this.args.transportInfo)}]`)
      : "";
    const ruleWidth = Math.max(0, w - visibleWidth(title) - (pill ? visibleWidth(pill) + 1 : 0));
    const lines = [
      `${t.fg("accent", t.bold(title))}${t.fg("border", "─".repeat(ruleWidth))}${pill ? ` ${pill}` : ""}`,
    ];

    if (this.helpOpen) lines.push(...this.renderHelp(w));
    else if (this.saveMenuOpen) lines.push(...this.renderSaveMenu(w));
    else if (this.switchMenuOpen) lines.push(...this.renderSwitchMenu(w));
    else if (this.layoutMode === "accordion") lines.push(...this.renderAccordion(w));
    else lines.push(...this.renderColumns(w));

    lines.push(t.fg("border", "─".repeat(w)));
    const filter = this.searchMode ? ` · filtering ${this.focus}: /${this.currentQuery()}` : "";
    const alt = this.args.strategy.alternateCatalog
      ? ` · m ${this.args.strategy.alternateCatalog.label}`
      : "";
    lines.push(
      fit(
        t.fg(
          "dim",
          `? help · t switch · ←→ pane · ↑↓ move · / filter${filter}${alt} · enter select/detail · w ${this.args.strategy.whereLabel} · l ${this.args.strategy.limitLabel} · e edit query · b rebuild · r run · c copy · s save · f refresh · q close`,
        ),
        w,
      ),
    );
    if (this.queryEditing)
      lines.push(
        fit(
          t.fg(
            "accent",
            "Editing query: enter save · esc cancel · arrows/home/end move · paste supported",
          ),
          w,
        ),
      );
    else if (this.editing) {
      const prompt =
        this.editing === "where" ? this.args.strategy.whereLabel : this.args.strategy.limitLabel;
      lines.push(
        fit(
          t.fg(
            "accent",
            `${t.bold(`${prompt}> `)}${this.editBuffer}█   (enter commit · esc cancel)`,
          ),
          w,
        ),
      );
    } else if (this.confirmQuit)
      lines.push(
        fit(
          t.fg("warning", "Quit Explorer? Press Enter/Esc/q/y to quit, any other key to stay."),
          w,
        ),
      );
    else
      lines.push(
        fit(
          this.loading ? t.fg("warning", `Loading… ${this.status}`) : t.fg("dim", this.status),
          w,
        ),
      );
    return lines.map((line) => fit(line, w));
  }

  invalidate(): void {}

  private renderColumns(w: number): string[] {
    const t = this.args.theme;
    const sepW = 3;
    const usable = Math.max(0, w - sepW * 2);
    const objectW = Math.max(0, Math.floor(usable * this.paneWeights[0]));
    const fieldW = Math.max(0, Math.floor(usable * this.paneWeights[1]));
    const queryW = Math.max(0, usable - objectW - fieldW);
    const leftSep = t.fg(
      this.focus === "objects" || this.focus === "fields" ? "accent" : "border",
      " │ ",
    );
    const rightSep = t.fg(
      this.focus === "fields" || this.focus === "query" ? "accent" : "border",
      " │ ",
    );
    const objectPane = this.renderObjects(objectW);
    const fieldPane = this.renderFields(fieldW);
    const queryPane = this.renderQueryPane(queryW);
    const rows = Math.max(objectPane.length, fieldPane.length, queryPane.length);
    const lines: string[] = [];
    for (let i = 0; i < rows; i += 1)
      lines.push(
        fit(
          pad(objectPane[i] ?? "", objectW) +
            leftSep +
            pad(fieldPane[i] ?? "", fieldW) +
            rightSep +
            fit(queryPane[i] ?? "", queryW),
          w,
        ),
      );
    return lines;
  }

  private renderAccordion(width: number): string[] {
    const t = this.args.theme;
    const lines: string[] = [];
    const panes: Array<{ id: FocusPane; label: string; renderer: (w: number) => string[] }> = [
      { id: "objects", label: "Objects", renderer: (w) => this.renderObjects(w) },
      { id: "fields", label: "Fields", renderer: (w) => this.renderFields(w) },
      { id: "query", label: "Query / Result", renderer: (w) => this.renderQueryPane(w) },
    ];
    for (const pane of panes) {
      if (this.focus === pane.id) lines.push(...pane.renderer(width));
      else lines.push(t.fg("muted", `[ ${pane.label} ]`));
    }
    return lines;
  }

  private paneHeader(label: string, focused: boolean, width: number): string[] {
    const t = this.args.theme;
    const marker = focused ? t.fg("accent", "▌") : " ";
    const title = focused ? t.fg("accent", t.bold(label)) : t.fg("muted", t.bold(label));
    const ruleChar = focused ? "━" : "─";
    return [
      fit(`${marker} ${title}`, width),
      t.fg(focused ? "accent" : "border", ruleChar.repeat(Math.max(0, width))),
    ];
  }

  private renderObjects(width: number): string[] {
    const t = this.args.theme;
    const filtered = this.filteredObjects();
    this.ensureObjectVisible(filtered.length);
    const lines = this.paneHeader(
      `${this.args.strategy.objectKindLabel()} (${filtered.length}/${this.objects.length})`,
      this.focus === "objects",
      width,
    );
    lines.push(
      fit(
        t.fg(
          this.objectCacheLine.startsWith("Serving") ? "success" : "warning",
          this.objectCacheLine,
        ),
        width,
      ),
    );
    if (this.objectQuery || (this.searchMode && this.focus === "objects"))
      lines.push(fit(t.fg("accent", `/${this.objectQuery}`), width));
    const end = Math.min(filtered.length, this.objectScrollTop + this.pageSize);
    if (this.objectScrollTop > 0) lines.push(t.fg("dim", `↑ ${this.objectScrollTop} more`));
    for (let i = this.objectScrollTop; i < end; i += 1) {
      const obj = filtered[i];
      if (!obj) continue;
      const selected = i === this.objectCursor;
      const active =
        this.selectedObject &&
        this.args.strategy.objectName(obj) === this.args.strategy.objectName(this.selectedObject);
      if (this.args.strategy.objectRow)
        lines.push(...this.args.strategy.objectRow(obj, selected, !!active, width, t));
      else {
        const prefix = selected ? t.fg("accent", "› ") : active ? t.fg("success", "◆ ") : "  ";
        lines.push(
          fit(
            `${prefix}${selected ? t.fg("accent", this.args.strategy.objectDisplayName(obj)) : this.args.strategy.objectDisplayName(obj)}`,
            width,
          ),
        );
        lines.push(fit(`    ${t.fg("muted", this.args.strategy.objectSubtitle(obj))}`, width));
      }
    }
    if (end < filtered.length) lines.push(t.fg("dim", `↓ ${filtered.length - end} more`));
    if (!filtered.length && !this.loading) lines.push(t.fg("warning", "No objects match."));
    return lines.map((line) => fit(line, width));
  }

  private renderFields(width: number): string[] {
    const t = this.args.theme;
    const filtered = this.filteredFields();
    this.ensureFieldVisible(filtered.length);
    const lines = this.paneHeader(
      `Fields (${this.selectedFields.size}/${this.fields.length})`,
      this.focus === "fields",
      width,
    );
    if (!this.selectedObject) {
      lines.push(t.fg("muted", "Select an object and press enter."));
      return lines;
    }
    if (this.fieldQuery || (this.searchMode && this.focus === "fields"))
      lines.push(fit(t.fg("accent", `/${this.fieldQuery}`), width));
    const end = Math.min(filtered.length, this.fieldScrollTop + this.pageSize);
    if (this.fieldScrollTop > 0) lines.push(t.fg("dim", `↑ ${this.fieldScrollTop} more`));
    for (let i = this.fieldScrollTop; i < end; i += 1) {
      const field = filtered[i];
      if (!field) continue;
      const name = this.args.strategy.fieldName(field);
      const selected = i === this.fieldCursor;
      const checked = this.selectedFields.has(name) ? t.fg("success", "[x]") : t.fg("dim", "[ ]");
      const prefix = selected ? t.fg("accent", "› ") : "  ";
      lines.push(
        fit(
          `${prefix}${checked} ${selected ? t.fg("accent", name) : name} ${t.fg("muted", this.args.strategy.fieldTypeLabel(field))}`,
          width,
        ),
      );
    }
    if (end < filtered.length) lines.push(t.fg("dim", `↓ ${filtered.length - end} more`));
    if (!filtered.length && !this.loading) lines.push(t.fg("warning", "No fields match."));
    return lines.map((line) => fit(line, width));
  }

  private renderQueryPane(width: number): string[] {
    const t = this.args.theme;
    const lines = this.paneHeader("Query / Result", this.focus === "query", width);
    if (this.detailMode && this.result) {
      lines.push(...this.renderRecordDetail(width));
      return lines.map((line) => fit(line, width));
    }
    if (this.queryEditing) {
      lines.push(...this.renderQueryEditor(width));
      return lines.map((line) => fit(line, width));
    }
    lines.push(t.fg("accent", t.bold(`Query ${this.queryDirty ? "(edited)" : "(generated)"}`)));
    for (const line of this.queryText.split("\n").slice(0, 12))
      lines.push(fit(t.fg("toolOutput", line), width));
    if (this.queryText.split("\n").length > 12)
      lines.push(t.fg("dim", "… query truncated; press e to edit/view"));
    lines.push(
      fit(
        t.fg(
          "muted",
          `w: ${this.args.strategy.whereLabel} · l: ${this.args.strategy.limitLabel} (${this.limit}) · e: edit full query · b: rebuild`,
        ),
        width,
      ),
    );
    if (this.error) {
      lines.push("", t.fg("error", "Error"));
      lines.push(...wrapPlain(this.error, width, 8));
    } else if (this.result) {
      lines.push("");
      lines.push(...this.renderResultTable(this.result, width));
    } else {
      lines.push(
        "",
        t.fg("dim", "Press r to run. Press c to copy. Press S after running to save."),
      );
    }
    return lines.map((line) => fit(line, width));
  }

  private renderResultTable(result: RunResult, width: number): string[] {
    const t = this.args.theme;
    const cols = result.columns;
    const usable = Math.max(0, width - 2);
    const maxCols = Math.max(1, Math.min(cols.length || 1, Math.floor(usable / 13)));
    const visibleCols = cols.slice(0, maxCols);
    const colW = Math.max(
      8,
      Math.floor(
        (usable - Math.max(0, visibleCols.length - 1) * 3) / Math.max(1, visibleCols.length),
      ),
    );
    const sep = t.fg("border", " │ ");
    this.ensureResultVisible(result.rows.length);
    const lines = [
      t.fg("success", `Returned ${result.totalReturned} row(s)`) +
        (result.rows.length ? t.fg("dim", " · ↑↓ row · enter detail") : ""),
    ];
    if (!visibleCols.length) {
      lines.push(t.fg("muted", "No rows returned."));
      return lines;
    }
    lines.push("  " + visibleCols.map((c) => t.fg("accent", pad(c, colW))).join(sep));
    lines.push(
      "  " +
        t.fg(
          "border",
          "─".repeat(
            Math.min(usable, visibleCols.length * colW + Math.max(0, visibleCols.length - 1) * 3),
          ),
        ),
    );
    const end = Math.min(result.rows.length, this.resultScrollTop + this.resultPageSize);
    if (this.resultScrollTop > 0) lines.push(t.fg("dim", `↑ ${this.resultScrollTop} more`));
    for (let i = this.resultScrollTop; i < end; i += 1) {
      const row = result.rows[i];
      if (!row) continue;
      const selected = i === this.resultCursor && this.focus === "query";
      const prefix = selected ? t.fg("accent", "› ") : "  ";
      lines.push(prefix + visibleCols.map((c) => pad(formatValue(row[c]), colW)).join(sep));
    }
    if (end < result.rows.length) lines.push(t.fg("dim", `↓ ${result.rows.length - end} more`));
    if (cols.length > maxCols)
      lines.push(
        t.fg("dim", `… ${cols.length - maxCols} more columns hidden (open detail to see all)`),
      );
    return lines;
  }

  private renderRecordDetail(width: number): string[] {
    const t = this.args.theme;
    const result = this.result;
    if (!result) return [];
    const row = result.rows[this.resultCursor] ?? {};
    const names = Array.from(new Set([...result.columns, ...Object.keys(row)]));
    const lines: string[] = [];
    lines.push(t.fg("accent", t.bold(`Record ${this.resultCursor + 1} of ${result.rows.length}`)));
    lines.push(t.fg("dim", "↑↓ scroll · ←→ prev/next record · c copy JSON · esc back"));
    lines.push(t.fg("border", "─".repeat(width)));
    const labelW = Math.max(
      8,
      Math.min(
        34,
        names.reduce((acc, n) => Math.max(acc, visibleWidth(n)), 0),
      ),
    );
    const valueW = Math.max(8, width - labelW - 2);
    const fieldLines: string[] = [];
    for (const name of names) {
      const pieces = wrapPlain(formatValue(row[name]), valueW, 20);
      fieldLines.push(`${t.fg("muted", pad(name, labelW))}  ${fit(pieces[0] ?? "", valueW)}`);
      for (let i = 1; i < pieces.length; i += 1)
        fieldLines.push(`${pad("", labelW)}  ${fit(pieces[i] ?? "", valueW)}`);
    }
    if (this.detailScrollTop > 0) lines.push(t.fg("dim", `↑ ${this.detailScrollTop} hidden`));
    lines.push(...fieldLines.slice(this.detailScrollTop, this.detailScrollTop + 28));
    return lines;
  }

  private openHelp(): void {
    this.helpOpen = true;
    this.searchMode = false;
    this.confirmQuit = false;
    this.args.requestRender();
  }

  private handleHelpInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q" || data === "?") {
      this.helpOpen = false;
      this.args.requestRender();
    }
  }

  private renderHelp(width: number): string[] {
    const t = this.args.theme;
    const lines = [
      t.fg("accent", t.bold("SF Data Explorer shortcuts")),
      t.fg("dim", "esc/q/? closes help"),
      t.fg("border", "─".repeat(width)),
      `${t.fg("accent", "Navigation")}: ←→ panes · ↑↓ move · enter select/detail · / filter · q close`,
      `${t.fg("accent", "Fields")}: space/enter toggle · a all visible · n none visible · i invert visible`,
      `${t.fg("accent", "Query")}: w ${this.args.strategy.whereLabel} / search term · l ${this.args.strategy.limitLabel} · e edit query · b rebuild`,
      `${t.fg("accent", "Run/results")}: r run · enter on result opens detail · detail: ←→ prev/next · detail c copy row JSON`,
      `${t.fg("accent", "Output")}: c close + copy query to Pi editor · s save JSON/CSV · save destination .sf-data-explorer/exports/`,
      `${t.fg("accent", "Explorer")}: t switch SOQL/SOSL/Data 360 SQL · f refresh · z focus pane · v columns/accordion`,
      "",
      t.fg(
        "muted",
        "Compatibility aliases: uppercase L also edits limit; uppercase S also opens save.",
      ),
    ];
    return lines.map((line) => fit(line, width));
  }

  private openSwitchMenu(): void {
    const modes: ExplorerMode[] = ["soql", "sosl", "sql"];
    this.switchMenuCursor = Math.max(0, modes.indexOf(this.args.strategy.mode));
    this.switchMenuOpen = true;
    this.searchMode = false;
    this.confirmQuit = false;
    this.args.requestRender();
  }

  private handleSwitchMenuInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q") {
      this.switchMenuOpen = false;
      this.args.requestRender();
      return;
    }
    const opts = this.switchOptions();
    if (matchesKey(data, Key.up)) this.switchMenuCursor = Math.max(0, this.switchMenuCursor - 1);
    else if (matchesKey(data, Key.down))
      this.switchMenuCursor = Math.min(opts.length - 1, this.switchMenuCursor + 1);
    else if (matchesKey(data, Key.enter)) {
      const picked = opts[this.switchMenuCursor];
      if (!picked) return;
      if (picked.mode === this.args.strategy.mode) {
        this.switchMenuOpen = false;
        this.args.requestRender();
      } else {
        this.args.done({ kind: "switchMode", mode: picked.mode });
      }
      return;
    }
    this.args.requestRender();
  }

  private switchOptions(): Array<{ mode: ExplorerMode; label: string }> {
    return [
      { mode: "soql", label: "SOQL Explorer" },
      { mode: "sosl", label: "SOSL Explorer" },
      { mode: "sql", label: "Data 360 SQL Explorer" },
    ];
  }

  private renderSwitchMenu(width: number): string[] {
    const t = this.args.theme;
    const lines = [
      t.fg("accent", t.bold("Switch explorer")),
      t.fg("dim", "↑↓ move · enter switch · esc/q back"),
      t.fg("border", "─".repeat(width)),
    ];
    const opts = this.switchOptions();
    for (let i = 0; i < opts.length; i += 1) {
      const opt = opts[i];
      if (!opt) continue;
      const selected = i === this.switchMenuCursor;
      const current = opt.mode === this.args.strategy.mode ? " current" : "";
      const label = `${opt.label}${current}`;
      lines.push(
        `${selected ? t.fg("accent", "› ") : "  "}${selected ? t.fg("accent", label) : label}`,
      );
    }
    return lines.map((line) => fit(line, width));
  }

  private previewState(): QueryBuildState<TObject> {
    return {
      selectedObject: this.selectedObject,
      selectedFieldNames: this.selectedFieldNames(),
      whereClause: this.whereClause,
      limit: this.limit,
    };
  }

  private rebuildQuery(notify: boolean): void {
    this.queryText = this.args.strategy.buildQuery(this.previewState());
    this.queryDirty = false;
    this.result = undefined;
    this.error = undefined;
    if (notify) this.status = "Rebuilt query from current selections.";
    this.args.requestRender();
  }

  private maybeRegenerateQuery(): void {
    if (this.queryDirty) {
      this.status = "Query is manually edited; press b to rebuild from selections.";
      this.args.requestRender();
      return;
    }
    this.rebuildQuery(false);
  }

  private editFullQuery(): void {
    // Do not call ctx.ui.editor while a custom TUI is mounted: Pi swaps focus
    // back to the chat editor and some clients do not restore the custom UI.
    // Keep query editing inside this component instead.
    this.queryEditing = true;
    this.queryEditBuffer = this.queryText;
    this.queryEditCursor = this.queryEditBuffer.length;
    this.searchMode = false;
    this.confirmQuit = false;
    this.status = "Editing query in-place.";
    this.args.requestRender();
  }

  private handleQueryEditInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.queryEditing = false;
      this.queryEditBuffer = "";
      this.queryEditCursor = 0;
      this.status = "Query edit cancelled.";
      this.args.requestRender();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.queryText = this.queryEditBuffer.trim();
      this.queryDirty = true;
      this.queryEditing = false;
      this.queryEditBuffer = "";
      this.queryEditCursor = 0;
      this.result = undefined;
      this.error = undefined;
      this.status = "Query edited. Press r to run, b to rebuild from selections.";
      this.args.requestRender();
      return;
    }
    if (matchesKey(data, Key.left)) this.queryEditCursor = Math.max(0, this.queryEditCursor - 1);
    else if (matchesKey(data, Key.right))
      this.queryEditCursor = Math.min(this.queryEditBuffer.length, this.queryEditCursor + 1);
    else if (matchesKey(data, Key.up)) this.moveQueryEditCursorVertical(-1);
    else if (matchesKey(data, Key.down)) this.moveQueryEditCursorVertical(1);
    else if (matchesKey(data, Key.home)) this.queryEditCursor = this.queryLineBounds().start;
    else if (matchesKey(data, Key.end)) this.queryEditCursor = this.queryLineBounds().end;
    else if (matchesKey(data, Key.delete)) {
      if (this.queryEditCursor < this.queryEditBuffer.length) {
        this.queryEditBuffer =
          this.queryEditBuffer.slice(0, this.queryEditCursor) +
          this.queryEditBuffer.slice(this.queryEditCursor + 1);
      }
    } else if (isBackspaceKey(data)) {
      if (this.queryEditCursor > 0) {
        this.queryEditBuffer =
          this.queryEditBuffer.slice(0, this.queryEditCursor - 1) +
          this.queryEditBuffer.slice(this.queryEditCursor);
        this.queryEditCursor -= 1;
      }
    } else if (data.length > 0 && !data.startsWith("\u001b")) {
      const printable = data.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
      if (printable) {
        this.queryEditBuffer =
          this.queryEditBuffer.slice(0, this.queryEditCursor) +
          printable +
          this.queryEditBuffer.slice(this.queryEditCursor);
        this.queryEditCursor += printable.length;
      }
    }
    this.args.requestRender();
  }

  private moveQueryEditCursorVertical(delta: -1 | 1): void {
    const { start, end, column } = this.queryLineBounds();
    if (delta < 0) {
      if (start === 0) return;
      const prevEnd = start - 1;
      const prevStart = this.queryEditBuffer.lastIndexOf("\n", Math.max(0, prevEnd - 1)) + 1;
      this.queryEditCursor = prevStart + Math.min(column, prevEnd - prevStart);
      return;
    }
    if (end >= this.queryEditBuffer.length) return;
    const nextStart = end + 1;
    const nextBreak = this.queryEditBuffer.indexOf("\n", nextStart);
    const nextEnd = nextBreak >= 0 ? nextBreak : this.queryEditBuffer.length;
    this.queryEditCursor = nextStart + Math.min(column, nextEnd - nextStart);
  }

  private queryLineBounds(): { start: number; end: number; column: number } {
    const start = this.queryEditBuffer.lastIndexOf("\n", Math.max(0, this.queryEditCursor - 1)) + 1;
    const nextBreak = this.queryEditBuffer.indexOf("\n", this.queryEditCursor);
    const end = nextBreak >= 0 ? nextBreak : this.queryEditBuffer.length;
    return { start, end, column: this.queryEditCursor - start };
  }

  private renderQueryEditor(width: number): string[] {
    const t = this.args.theme;
    const before = this.queryEditBuffer.slice(0, this.queryEditCursor);
    const after = this.queryEditBuffer.slice(this.queryEditCursor);
    const withCursor = `${before}${t.fg("accent", "▌")}${after}`;
    const lines = [
      t.fg("accent", t.bold("Edit query in-place")),
      t.fg("dim", "enter save · esc cancel · arrows/home/end move · backspace/delete edit"),
    ];
    const rawLines = withCursor.split("\n");
    const cursorLine = before.split("\n").length - 1;
    const maxVisible = 18;
    const start = Math.max(
      0,
      Math.min(Math.max(0, rawLines.length - maxVisible), cursorLine - Math.floor(maxVisible / 2)),
    );
    const end = Math.min(rawLines.length, start + maxVisible);
    if (start > 0) lines.push(t.fg("dim", `… ${start} line(s) above`));
    for (const line of rawLines.slice(start, end)) lines.push(fit(t.fg("toolOutput", line), width));
    if (end < rawLines.length) lines.push(t.fg("dim", `… ${rawLines.length - end} line(s) below`));
    return lines;
  }

  private copyQuery(): void {
    // Close first, then let the command handler set the Pi editor text.
    // Some Pi clients do not visibly update the global editor while a custom
    // full-screen component is mounted, which made "copied" look like a no-op.
    this.args.done({ kind: "copyToEditor", text: this.queryText, label: "query" });
  }

  private async runQuery(): Promise<void> {
    const validation = this.args.strategy.validateQuery(this.queryText);
    if (!validation.ok) {
      this.error = validation.error ?? "Query validation failed.";
      this.status = this.error;
      this.args.notify(this.error, "error");
      this.args.requestRender();
      return;
    }
    if (validation.warnings?.length) {
      this.status = validation.warnings.join(" ");
      this.args.notify(this.status, "warning");
    }
    this.loading = true;
    this.error = undefined;
    this.result = undefined;
    this.detailMode = false;
    this.resultCursor = 0;
    this.resultScrollTop = 0;
    this.status = "Running query…";
    this.args.requestRender();
    try {
      this.result = await this.args.strategy.runQuery(this.queryText);
      this.status = `Returned ${this.result.totalReturned} row(s).`;
      this.focus = "query";
    } catch (error) {
      this.error = extractError(error);
      this.status = `Query failed: ${this.error}`;
    } finally {
      this.loading = false;
      this.args.requestRender();
    }
  }

  private saveLatestResult(): void {
    if (!this.result) {
      this.args.notify("Run a query before saving results.", "warning");
      return;
    }
    this.saveMenuOpen = true;
    this.saveMenuCursor = 0;
    this.status = "Choose a save format. The explorer stays open after saving.";
    this.args.requestRender();
  }

  private async handleSaveMenuInput(data: string): Promise<void> {
    if (matchesKey(data, Key.escape) || data === "q") {
      this.saveMenuOpen = false;
      this.args.requestRender();
      return;
    }
    if (matchesKey(data, Key.up)) this.saveMenuCursor = Math.max(0, this.saveMenuCursor - 1);
    else if (matchesKey(data, Key.down))
      this.saveMenuCursor = Math.min(this.saveOptions().length - 1, this.saveMenuCursor + 1);
    else if (matchesKey(data, Key.enter)) {
      const picked = this.saveOptions()[this.saveMenuCursor];
      if (picked === "Back") {
        this.saveMenuOpen = false;
      } else {
        await this.saveSelectedFormat(picked.toLowerCase() as ExportFormat);
        // Keep the menu open so users can save another format, then Esc/Back.
      }
    } else if (data.toLowerCase() === "j")
      this.saveMenuCursor = Math.min(this.saveOptions().length - 1, this.saveMenuCursor + 1);
    else if (data.toLowerCase() === "k") this.saveMenuCursor = Math.max(0, this.saveMenuCursor - 1);
    this.args.requestRender();
  }

  private saveOptions(): Array<"JSON" | "CSV" | "Back"> {
    return ["JSON", "CSV", "Back"];
  }

  private async saveSelectedFormat(format: ExportFormat): Promise<void> {
    if (!this.result) return;
    try {
      const file = await saveResult({
        cwd: this.args.cwd,
        result: this.result,
        baseName: this.args.strategy.exportBaseName(this.previewState()),
        format,
      });
      this.status = `Saved ${format.toUpperCase()} result: ${file}`;
      this.args.notify(this.status, "info");
    } catch (error) {
      this.status = `Save failed: ${extractError(error)}`;
      this.args.notify(this.status, "error");
    }
  }

  private renderSaveMenu(width: number): string[] {
    const t = this.args.theme;
    const lines = [
      t.fg("accent", t.bold("Save result")),
      t.fg("dim", "↑↓ move · enter save/select · esc/q back · menu stays open after saving"),
      t.fg("border", "─".repeat(width)),
    ];
    const opts = this.saveOptions();
    for (let i = 0; i < opts.length; i += 1) {
      const selected = i === this.saveMenuCursor;
      const label = opts[i] === "Back" ? "Back to explorer" : `Save as ${opts[i]}`;
      lines.push(
        `${selected ? t.fg("accent", "› ") : "  "}${selected ? t.fg("accent", label) : label}`,
      );
    }
    if (this.result) {
      lines.push(
        "",
        t.fg(
          "muted",
          `Rows: ${this.result.totalReturned} · Destination: ${this.args.cwd}/.sf-data-explorer/exports/`,
        ),
      );
    }
    return lines.map((line) => fit(line, width));
  }

  async selectObjectByName(name: string, force: boolean): Promise<void> {
    const wanted = name.toLowerCase();
    const index = this.objects.findIndex(
      (obj) => this.args.strategy.objectName(obj).toLowerCase() === wanted,
    );
    if (index < 0) {
      this.status = `Object not found in ${this.args.strategy.objectKindLabel()} catalog: ${name}`;
      this.args.notify(this.status, "warning");
      this.args.requestRender();
      return;
    }
    this.objectCursor = index;
    this.ensureObjectVisible(this.objects.length);
    await this.selectObject(force, this.objects[index]);
  }

  private async selectObject(force: boolean, explicit?: TObject): Promise<void> {
    const obj = explicit ?? this.filteredObjects()[this.objectCursor];
    if (!obj) return;
    this.selectedObject = obj;
    this.focus = "fields";
    this.fieldCursor = 0;
    this.fieldScrollTop = 0;
    this.fieldQuery = "";
    this.selectedFields.clear();
    this.result = undefined;
    this.error = undefined;
    this.detailMode = false;
    this.queryDirty = false;
    await this.loadFields(obj, force);
  }

  private async loadFields(obj: TObject, force: boolean): Promise<void> {
    this.loading = true;
    const name = this.args.strategy.objectName(obj);
    this.status = `${force ? "Refreshing" : "Loading"} fields for ${name}…`;
    this.args.requestRender();
    try {
      const loaded = await this.args.strategy.loadFields(obj, force);
      this.fields = loaded.value;
      this.selectedFields.clear();
      for (const fieldName of this.args.strategy.defaultFieldSelections(this.fields))
        this.selectedFields.add(fieldName);
      this.status = cacheStatus(loaded.kindLabel, loaded.cached, loaded.loadedAt);
      this.args.notify(this.status, "info");
      this.rebuildQuery(false);
    } catch (error) {
      this.fields = [];
      this.status = `Load failed: ${extractError(error)}`;
      this.args.notify(this.status, "error");
    } finally {
      this.loading = false;
      this.args.requestRender();
    }
  }

  private async loadCatalog(force: boolean): Promise<void> {
    this.loading = true;
    this.status = `${force ? "Refreshing" : "Loading"} ${this.args.strategy.objectKindLabel()} catalog…`;
    this.args.requestRender();
    try {
      const loaded = await this.args.strategy.loadCatalog(force);
      this.objects = loaded.value;
      this.objectCacheLine = cacheStatus(loaded.kindLabel, loaded.cached, loaded.loadedAt);
      this.status = this.objectCacheLine;
      this.args.notify(this.objectCacheLine, "info");
    } catch (error) {
      this.status = extractError(error);
      this.args.notify(this.status, "error");
    } finally {
      this.loading = false;
      this.args.requestRender();
    }
  }

  private async forceReloadCurrent(): Promise<void> {
    if (this.focus === "fields" && this.selectedObject)
      await this.loadFields(this.selectedObject, true);
    else await this.loadCatalog(true);
  }

  private async toggleAlternateCatalog(): Promise<void> {
    const alt = this.args.strategy.alternateCatalog;
    if (!alt) return;
    await alt.toggle();
    this.objectCursor = 0;
    this.objectScrollTop = 0;
    this.objectQuery = "";
    this.selectedObject = undefined;
    this.fields = [];
    this.selectedFields.clear();
    this.result = undefined;
    this.error = undefined;
    this.detailMode = false;
    await this.loadCatalog(false);
  }

  private enterEdit(kind: "where" | "limit"): void {
    this.editing = kind;
    this.editBuffer = kind === "where" ? this.whereClause : String(this.limit);
    this.searchMode = false;
    this.confirmQuit = false;
    this.args.requestRender();
  }

  private handleEditInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.editing = null;
      this.editBuffer = "";
      this.args.requestRender();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      if (this.editing === "where") {
        this.whereClause = this.editBuffer.trim();
        this.status = this.whereClause
          ? `${this.args.strategy.whereLabel} set.`
          : `${this.args.strategy.whereLabel} cleared.`;
      } else if (this.editing === "limit") {
        const n = parseInt(this.editBuffer.trim(), 10);
        if (Number.isFinite(n) && n > 0) {
          this.limit = Math.min(10000, n);
          this.status = `${this.args.strategy.limitLabel} set to ${this.limit}.`;
        } else this.status = `${this.args.strategy.limitLabel} must be a positive integer.`;
      }
      this.editing = null;
      this.editBuffer = "";
      this.maybeRegenerateQuery();
      return;
    }
    if (isBackspaceKey(data)) {
      this.editBuffer = this.editBuffer.slice(0, -1);
      this.args.requestRender();
      return;
    }
    if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127) {
      if (this.editing === "limit" && !/[0-9]/.test(data)) return;
      this.editBuffer += data;
      this.args.requestRender();
    }
  }

  private handleSearchInput(data: string): void {
    this.confirmQuit = false;
    if (matchesKey(data, Key.up)) return this.move(-1);
    if (matchesKey(data, Key.down)) return this.move(1);
    if (matchesKey(data, Key.left)) return this.moveFocus(-1);
    if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) return this.moveFocus(1);
    if (matchesKey(data, Key.enter)) {
      this.searchMode = false;
      if (this.focus === "objects") void this.selectObject(false);
      else if (this.focus === "fields") this.toggleField();
      else this.args.requestRender();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.searchMode = false;
      this.args.requestRender();
      return;
    }
    if (isBackspaceKey(data)) {
      this.setCurrentQuery(this.currentQuery().slice(0, -1));
      this.resetScrollForFocus();
      this.args.requestRender();
      return;
    }
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.setCurrentQuery(this.currentQuery() + data);
      this.resetScrollForFocus();
      this.args.requestRender();
    }
  }

  private handleDetailInput(data: string): void {
    if (matchesKey(data, Key.ctrl("c"))) return this.args.done();
    if (matchesKey(data, Key.escape) || data === "q") {
      this.detailMode = false;
      this.detailScrollTop = 0;
      this.args.requestRender();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.detailScrollTop = Math.max(0, this.detailScrollTop - 1);
      this.args.requestRender();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.detailScrollTop += 1;
      this.args.requestRender();
      return;
    }
    if (matchesKey(data, Key.left)) return this.detailNav(-1);
    if (matchesKey(data, Key.right)) return this.detailNav(1);
    if (data === "c") {
      const row = this.result?.rows[this.resultCursor];
      if (row)
        this.args.done({
          kind: "copyToEditor",
          text: JSON.stringify(row, null, 2),
          label: "record JSON",
        });
    }
  }

  private openDetail(): void {
    if (!this.result?.rows.length) return;
    this.detailMode = true;
    this.detailScrollTop = 0;
    this.args.requestRender();
  }

  private detailNav(delta: number): void {
    const rows = this.result?.rows ?? [];
    if (!rows.length) return;
    this.resultCursor = Math.max(0, Math.min(rows.length - 1, this.resultCursor + delta));
    this.detailScrollTop = 0;
    this.ensureResultVisible(rows.length);
    this.args.requestRender();
  }

  private toggleField(): void {
    const field = this.filteredFields()[this.fieldCursor];
    if (!field) return;
    const name = this.args.strategy.fieldName(field);
    if (this.selectedFields.has(name)) this.selectedFields.delete(name);
    else this.selectedFields.add(name);
    this.maybeRegenerateQuery();
  }

  private selectVisibleFields(value: boolean): void {
    for (const field of this.filteredFields()) {
      const name = this.args.strategy.fieldName(field);
      if (value) this.selectedFields.add(name);
      else this.selectedFields.delete(name);
    }
    this.maybeRegenerateQuery();
  }

  private invertVisibleFields(): void {
    for (const field of this.filteredFields()) {
      const name = this.args.strategy.fieldName(field);
      if (this.selectedFields.has(name)) this.selectedFields.delete(name);
      else this.selectedFields.add(name);
    }
    this.maybeRegenerateQuery();
  }

  private selectedFieldNames(): string[] {
    return this.fields
      .map((f) => this.args.strategy.fieldName(f))
      .filter((name) => this.selectedFields.has(name));
  }

  private filteredObjects(): TObject[] {
    const q = this.objectQuery.trim().toLowerCase();
    if (!q) return this.objects;
    return this.objects.filter((obj) =>
      this.args.strategy.objectQueryHay(obj).toLowerCase().includes(q),
    );
  }

  private filteredFields(): TField[] {
    const q = this.fieldQuery.trim().toLowerCase();
    if (!q) return this.fields;
    return this.fields.filter((field) =>
      this.args.strategy.fieldQueryHay(field).toLowerCase().includes(q),
    );
  }

  private currentQuery(): string {
    return this.focus === "fields" ? this.fieldQuery : this.objectQuery;
  }

  private setCurrentQuery(value: string): void {
    if (this.focus === "fields") this.fieldQuery = value;
    else this.objectQuery = value;
  }

  private resetScrollForFocus(): void {
    if (this.focus === "fields") {
      this.fieldCursor = 0;
      this.fieldScrollTop = 0;
    } else {
      this.objectCursor = 0;
      this.objectScrollTop = 0;
    }
  }

  private moveFocus(delta: number): void {
    const panes: FocusPane[] = ["objects", "fields", "query"];
    const idx = panes.indexOf(this.focus);
    const next = panes[Math.max(0, Math.min(panes.length - 1, idx + delta))];
    if (!next) return;
    this.focus = next;
    this.searchMode = false;
    if (this.expanded) this.applyExpansion();
    this.args.requestRender();
  }

  private move(delta: number): void {
    if (this.focus === "query") {
      const count = this.result?.rows.length ?? 0;
      if (!count) return;
      this.resultCursor = Math.max(0, Math.min(count - 1, this.resultCursor + delta));
      this.ensureResultVisible(count);
    } else if (this.focus === "fields") {
      const count = this.filteredFields().length;
      this.fieldCursor = Math.max(0, Math.min(Math.max(0, count - 1), this.fieldCursor + delta));
      this.ensureFieldVisible(count);
    } else {
      const count = this.filteredObjects().length;
      this.objectCursor = Math.max(0, Math.min(Math.max(0, count - 1), this.objectCursor + delta));
      this.ensureObjectVisible(count);
    }
    this.args.requestRender();
  }

  private jump(end: boolean): void {
    if (this.focus === "query") {
      const count = this.result?.rows.length ?? 0;
      if (!count) return;
      this.resultCursor = end ? Math.max(0, count - 1) : 0;
      this.ensureResultVisible(count);
    } else if (this.focus === "fields") {
      const count = this.filteredFields().length;
      this.fieldCursor = end ? Math.max(0, count - 1) : 0;
      this.ensureFieldVisible(count);
    } else {
      const count = this.filteredObjects().length;
      this.objectCursor = end ? Math.max(0, count - 1) : 0;
      this.ensureObjectVisible(count);
    }
    this.args.requestRender();
  }

  private ensureObjectVisible(count: number): void {
    this.objectCursor = Math.max(0, Math.min(Math.max(0, count - 1), this.objectCursor));
    if (this.objectCursor < this.objectScrollTop) this.objectScrollTop = this.objectCursor;
    if (this.objectCursor >= this.objectScrollTop + this.pageSize)
      this.objectScrollTop = this.objectCursor - this.pageSize + 1;
  }

  private ensureFieldVisible(count: number): void {
    this.fieldCursor = Math.max(0, Math.min(Math.max(0, count - 1), this.fieldCursor));
    if (this.fieldCursor < this.fieldScrollTop) this.fieldScrollTop = this.fieldCursor;
    if (this.fieldCursor >= this.fieldScrollTop + this.pageSize)
      this.fieldScrollTop = this.fieldCursor - this.pageSize + 1;
  }

  private ensureResultVisible(count: number): void {
    this.resultCursor = Math.max(0, Math.min(Math.max(0, count - 1), this.resultCursor));
    if (this.resultCursor < this.resultScrollTop) this.resultScrollTop = this.resultCursor;
    if (this.resultCursor >= this.resultScrollTop + this.resultPageSize)
      this.resultScrollTop = this.resultCursor - this.resultPageSize + 1;
  }

  private resizePane(delta: number): void {
    const i = this.focus === "objects" ? 0 : this.focus === "fields" ? 1 : 2;
    const current = this.paneWeights[i] ?? 0.33;
    const next = Math.max(0.12, Math.min(0.75, current + delta));
    const actual = next - current;
    if (actual === 0) return;
    const others = [0, 1, 2].filter((j) => j !== i) as Array<0 | 1 | 2>;
    const share = actual / others.length;
    this.paneWeights[i] = next;
    for (const j of others)
      this.paneWeights[j] = Math.max(0.1, (this.paneWeights[j] ?? 0.33) - share);
    const sum = this.paneWeights[0] + this.paneWeights[1] + this.paneWeights[2];
    this.paneWeights = [
      this.paneWeights[0] / sum,
      this.paneWeights[1] / sum,
      this.paneWeights[2] / sum,
    ];
    this.args.requestRender();
  }

  private toggleExpansion(): void {
    this.expanded = !this.expanded;
    this.applyExpansion();
    this.status = this.expanded ? "80% focus mode enabled." : "Default layout restored.";
    this.args.requestRender();
  }

  private applyExpansion(): void {
    if (this.expanded) {
      const i = this.focus === "objects" ? 0 : this.focus === "fields" ? 1 : 2;
      const others = [0, 1, 2].filter((j) => j !== i);
      this.paneWeights[i] = 0.8;
      for (const j of others) this.paneWeights[j as 0 | 1 | 2] = 0.1;
    } else this.paneWeights = [0.3, 0.32, 0.38];
  }

  private toggleLayout(): void {
    this.layoutMode = this.layoutMode === "columns" ? "accordion" : "columns";
    this.status = `Layout switched to ${this.layoutMode}.`;
    this.args.requestRender();
  }

  private askQuit(): void {
    this.confirmQuit = true;
    this.args.requestRender();
  }
}

function extractError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return stripAnsi(msg).split("\n")[0] ?? "Unknown error";
}
