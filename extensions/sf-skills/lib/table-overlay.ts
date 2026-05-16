/* SPDX-License-Identifier: Apache-2.0 */
/**
 * TUI overlay for `/sf-skills` — three tabs:
 *
 *   [Active]    every skill pi.getCommands() reports right now
 *   [Discover]  active set + on-disk candidates not yet wired
 *   [Stats]     per-skill usage counters (filled by the usage store; v2)
 *
 * Per-row toggle changes settings.skills[] only. The rename / .off hack
 * we explored earlier is gone — every enable/disable flips a native pi
 * setting. Keys:
 *
 *   ↑/↓ or j/k   navigate rows
 *   tab/shift-tab  cycle tabs (1/2/3 jump)
 *   g            toggle global wiring on the highlighted row
 *   p            toggle project wiring on the highlighted row
 *   space        same as `g` (handy default)
 *   enter        apply pending toggles + close
 *   esc / q      cancel pending toggles
 *   /            (placeholder) future filter input
 *
 * The component is intentionally read-only against settings during
 * input handling — toggles accumulate in `pendingToggles` and only
 * flush on Enter via the result envelope. That keeps the UI responsive
 * and the writes batched.
 */
import { type Focusable, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ActiveRow, DiscoverRow, WiredScope } from "./table-data.ts";

export type TabId = "active" | "discover" | "stats";

export interface ToggleAction {
  /** Skill name. */
  name: string;
  /** Resolved path we'll write into settings.skills[]. */
  skillPath: string;
  /** Which scope's settings file to write. */
  scope: "global" | "project";
  /** True = add the path; false = remove it. */
  enable: boolean;
}

export interface InstallCandidateAction {
  settingsValue: string;
  scope: "global" | "project";
}

export type TableResult =
  | { kind: "cancel" }
  | {
      kind: "apply";
      toggles: ToggleAction[];
      addCandidates: InstallCandidateAction[];
    };

export interface TableOverlayProps {
  active: ActiveRow[];
  discover: DiscoverRow[];
  cwd: string;
  /** Optional, used only for the Stats tab. */
  statsTotalCount?: number;
}

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "active", label: "Active" },
  { id: "discover", label: "Discover" },
  { id: "stats", label: "Stats" },
];

export class SkillsTableOverlayComponent implements Focusable {
  focused = false;

  private tab: TabId = "active";
  private cursor: Record<TabId, number> = { active: 0, discover: 0, stats: 0 };

  /** Pending toggles keyed by `${name}|${scope}` so successive presses cancel out. */
  private toggles = new Map<string, ToggleAction>();
  /** Pending wires for Discover candidates (whole source roots). */
  private candidates = new Map<string, InstallCandidateAction>();

  constructor(
    private readonly theme: Theme,
    private readonly props: TableOverlayProps,
    private readonly done: (result: TableResult | undefined) => void,
  ) {}

  // -----------------------------------------------------------------------------------------------
  // Input handling
  // -----------------------------------------------------------------------------------------------

  handleInput(data: string): void {
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
    if (matchesKey(data, "up") || data === "k") {
      this.cursor[this.tab] = Math.max(0, this.cursor[this.tab] - 1);
      return;
    }
    if (matchesKey(data, "down") || data === "j") {
      this.cursor[this.tab] = Math.min(this.maxIndex(), this.cursor[this.tab]);
      this.cursor[this.tab] = Math.min(this.maxIndex(), this.cursor[this.tab] + 1);
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

  // -----------------------------------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------------------------------

  render(width: number): string[] {
    const innerWidth = Math.max(70, width - 2);
    const theme = this.theme;
    const lines: string[] = [];
    const row = (content: string = "") => {
      const padded = padAnsi(truncateToWidth(content, innerWidth, ""), innerWidth);
      return `${theme.fg("border", "│")}${padded}${theme.fg("border", "│")}`;
    };

    lines.push(theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));
    lines.push(row(this.renderTabStrip(theme)));
    lines.push(row(""));

    if (this.tab === "active") {
      lines.push(...this.renderActive(theme, innerWidth, row));
    } else if (this.tab === "discover") {
      lines.push(...this.renderDiscover(theme, innerWidth, row));
    } else {
      lines.push(...this.renderStats(theme, innerWidth, row));
    }

    lines.push(row(""));
    lines.push(row(this.renderFooter(theme)));
    lines.push(theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
    return lines;
  }

  invalidate(): void {}

  // -----------------------------------------------------------------------------------------------
  // Tab strip
  // -----------------------------------------------------------------------------------------------

  private renderTabStrip(theme: Theme): string {
    const parts: string[] = [];
    for (let i = 0; i < TABS.length; i++) {
      const tab = TABS[i]!;
      const count = this.tabCount(tab.id);
      const label = `${tab.label}${count !== null ? ` (${count})` : ""}`;
      const isActive = tab.id === this.tab;
      const decorated = isActive
        ? theme.fg("accent", theme.bold(`[ ${i + 1} ${label} ]`))
        : theme.fg("muted", `  ${i + 1} ${label}  `);
      parts.push(decorated);
    }
    return ` ${parts.join("  ")}`;
  }

  private tabCount(id: TabId): number | null {
    if (id === "active") return this.props.active.length;
    if (id === "discover") return this.props.discover.length;
    return null;
  }

  // -----------------------------------------------------------------------------------------------
  // Active tab
  // -----------------------------------------------------------------------------------------------

  private renderActive(theme: Theme, innerWidth: number, row: (s?: string) => string): string[] {
    if (this.props.active.length === 0) {
      return [row(theme.fg("dim", "  No skills loaded for this session yet."))];
    }
    const out: string[] = [];
    out.push(row(this.activeHeader(theme)));
    out.push(row(theme.fg("border", `  ${"─".repeat(innerWidth - 4)}`)));
    this.props.active.forEach((r, i) => {
      const isCursor = i === this.cursor.active;
      out.push(row(this.activeRow(theme, r, isCursor, innerWidth)));
    });
    return out;
  }

  private activeHeader(theme: Theme): string {
    const cells = [
      `${" ".repeat(2)}On `,
      padAnsi("Skill", 24),
      padAnsi("Class", 6),
      padAnsi("Source", 24),
      padAnsi("Wired", 8),
      padAnsi("Used", 6),
    ];
    return theme.fg("muted", ` ${cells.join(" ")}`);
  }

  private activeRow(theme: Theme, r: ActiveRow, isCursor: boolean, innerWidth: number): string {
    const cursor = isCursor ? theme.fg("accent", "▸") : " ";
    const onGlyph = this.onGlyph(theme, r);
    const klass = r.klass === "salesforce" ? theme.fg("success", "SF ") : theme.fg("muted", "Ext");
    const wired = formatWiredBadge(theme, r.wired);
    const cells = [
      `${cursor} ${onGlyph} `,
      padAnsi(truncateToWidth(r.name, 24, "…"), 24),
      padAnsi(klass, 6),
      padAnsi(truncateToWidth(r.sourceLabel, 24, "…"), 24),
      padAnsi(wired, 8),
      padAnsi(String(r.usageCount), 6),
    ];
    const line = cells.join(" ");
    void innerWidth; // wide tables truncate per-cell; outer pad handles total width
    return ` ${line}`;
  }

  private onGlyph(theme: Theme, r: ActiveRow): string {
    if (r.readOnly) return theme.fg("dim", "·");
    const pending = this.pendingForRow(r);
    if (pending === "enable") return theme.fg("accent", "●");
    if (pending === "disable") return theme.fg("muted", "○");
    return r.wired === "none" ? theme.fg("muted", "○") : theme.fg("success", "●");
  }

  // -----------------------------------------------------------------------------------------------
  // Discover tab
  // -----------------------------------------------------------------------------------------------

  private renderDiscover(theme: Theme, innerWidth: number, row: (s?: string) => string): string[] {
    if (this.props.discover.length === 0) {
      return [row(theme.fg("dim", "  Nothing to discover."))];
    }
    const out: string[] = [];
    out.push(row(this.discoverHeader(theme)));
    out.push(row(theme.fg("border", `  ${"─".repeat(innerWidth - 4)}`)));
    this.props.discover.forEach((r, i) => {
      const isCursor = i === this.cursor.discover;
      out.push(row(this.discoverRow(theme, r, isCursor)));
    });
    return out;
  }

  private discoverHeader(theme: Theme): string {
    const cells = [
      `${" ".repeat(2)}On `,
      padAnsi("Skill / Source", 28),
      padAnsi("Origin", 26),
      padAnsi("Status", 14),
    ];
    return theme.fg("muted", ` ${cells.join(" ")}`);
  }

  private discoverRow(theme: Theme, r: DiscoverRow, isCursor: boolean): string {
    const cursor = isCursor ? theme.fg("accent", "▸") : " ";
    if (r.discover === "active") {
      const on = this.onGlyph(theme, r);
      const cells = [
        `${cursor} ${on} `,
        padAnsi(truncateToWidth(r.name, 28, "…"), 28),
        padAnsi(truncateToWidth(r.sourceLabel, 26, "…"), 26),
        padAnsi(formatWiredBadge(theme, r.wired), 14),
      ];
      return ` ${cells.join(" ")}`;
    }
    // Candidate row (not yet wired).
    const pending = this.candidates.has(this.candidateKey(r));
    const on = pending ? theme.fg("accent", "●") : theme.fg("muted", "○");
    const status = pending
      ? theme.fg("accent", "wire pending")
      : theme.fg("muted", `${r.skillCount} skill${r.skillCount === 1 ? "" : "s"}`);
    const cells = [
      `${cursor} ${on} `,
      padAnsi(truncateToWidth(r.label, 28, "…"), 28),
      padAnsi(truncateToWidth(r.absolutePath, 26, "…"), 26),
      padAnsi(status, 14),
    ];
    return ` ${cells.join(" ")}`;
  }

  // -----------------------------------------------------------------------------------------------
  // Stats tab (placeholder for v1; populated when usage-store lands)
  // -----------------------------------------------------------------------------------------------

  private renderStats(theme: Theme, _innerWidth: number, row: (s?: string) => string): string[] {
    const totalUsed = this.props.active.filter((r) => r.usageCount > 0).length;
    if (totalUsed === 0) {
      return [
        row(
          theme.fg("dim", "  No usage recorded yet. Counters bump on /skill:<name> invocations."),
        ),
      ];
    }
    const top = [...this.props.active]
      .filter((r) => r.usageCount > 0)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10);
    const out: string[] = [
      row(
        theme.fg(
          "muted",
          `  Top usage (current scope) — ${this.props.statsTotalCount ?? totalUsed} total`,
        ),
      ),
      row(""),
    ];
    top.forEach((r, i) => {
      const klass =
        r.klass === "salesforce" ? theme.fg("success", "SF ") : theme.fg("muted", "Ext");
      out.push(
        row(
          `  ${i + 1}. ${padAnsi(truncateToWidth(r.name, 28, "…"), 28)} ${klass}  ${theme.fg(
            "accent",
            String(r.usageCount),
          )} ${r.lastUsedAt ? theme.fg("dim", `(last ${r.lastUsedAt})`) : ""}`,
        ),
      );
    });
    return out;
  }

  // -----------------------------------------------------------------------------------------------
  // Footer
  // -----------------------------------------------------------------------------------------------

  private renderFooter(theme: Theme): string {
    const pending = this.toggles.size + this.candidates.size;
    const pendingText =
      pending > 0
        ? theme.fg("warning", `${pending} change${pending === 1 ? "" : "s"} pending`)
        : theme.fg("dim", "no changes");
    const keys = theme.fg(
      "dim",
      "↑/↓ row · 1/2/3 tab · g global · p project · enter apply · esc cancel",
    );
    return ` ${pendingText}  ${theme.fg("muted", "·")}  ${keys}`;
  }

  // -----------------------------------------------------------------------------------------------
  // Toggle helpers
  // -----------------------------------------------------------------------------------------------

  private maxIndex(): number {
    if (this.tab === "active") return Math.max(0, this.props.active.length - 1);
    if (this.tab === "discover") return Math.max(0, this.props.discover.length - 1);
    return 0;
  }

  private toggleAtCursor(scope: "global" | "project"): void {
    if (this.tab === "active") {
      const r = this.props.active[this.cursor.active];
      if (!r || r.readOnly) return;
      this.toggleActiveRow(r, scope);
      return;
    }
    if (this.tab === "discover") {
      const r = this.props.discover[this.cursor.discover];
      if (!r) return;
      if (r.discover === "active") {
        if (r.readOnly) return;
        this.toggleActiveRow(r, scope);
        return;
      }
      // Candidate: scope is fixed by the candidate itself, ignore the
      // user's `g`/`p` choice and let the natural scope win.
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
    const key = this.candidateKey(r);
    if (this.candidates.has(key)) {
      this.candidates.delete(key);
      return;
    }
    this.candidates.set(key, {
      settingsValue: r.settingsValue,
      scope: r.scope,
    });
  }

  private candidateKey(r: Extract<DiscoverRow, { discover: "candidate" }>): string {
    return `${r.absolutePath}|${r.scope}`;
  }

  private pendingForRow(r: ActiveRow): "enable" | "disable" | null {
    for (const t of this.toggles.values()) {
      if (t.name === r.name) return t.enable ? "enable" : "disable";
    }
    return null;
  }
}

// -------------------------------------------------------------------------------------------------
// Module helpers
// -------------------------------------------------------------------------------------------------

function nextTab(current: TabId, delta: number): TabId {
  const idx = TABS.findIndex((t) => t.id === current);
  const next = (idx + delta + TABS.length) % TABS.length;
  return TABS[next]!.id;
}

function wiredAt(wired: WiredScope, scope: "global" | "project"): boolean {
  if (wired === "both") return true;
  return wired === scope;
}

function formatWiredBadge(theme: Theme, wired: WiredScope): string {
  if (wired === "both") return theme.fg("success", "G+P");
  if (wired === "global") return theme.fg("success", "G  ");
  if (wired === "project") return theme.fg("success", "P  ");
  return theme.fg("muted", "—  ");
}
