/* SPDX-License-Identifier: Apache-2.0 */
/**
 * TUI overlay component for the sf-pi extension manager.
 *
 * Three-level navigation:
 *   Level 0 (list)     — Extension list with enable/disable toggles and scope selector
 *   Level 1 (detail)   — Per-extension details and actions
 *   Level 2 (settings) — Config panel for configurable extensions
 *
 * The overlay is a composite router: one overlay stays open, and internal state
 * switches between the list view and a detail/config view. No screen flicker.
 *
 * Keybindings:
 *   ↑↓       navigate list
 *   Space    toggle enable/disable (list view, or detail view without settings)
 *   Enter    open selected item/action
 *   A        toggle all
 *   S        cycle scope (global ↔ project)
 *   Esc      back to list (from detail) or apply/close (from list)
 */
import {
  type Component,
  type Focusable,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type {
  SfPiExtension,
  ConfigPanelFactory,
  ConfigPanelResult,
} from "../../../catalog/registry.ts";
import {
  buildExtensionDetailSummary,
  getExtensionStatus,
  getExtensionStatusLabel,
} from "./extension-details.ts";

/**
 * A config panel is both a Component (render, handleInput, invalidate) and
 * Focusable (focused). It may also expose renderContent() for borderless
 * rendering inside the manager's border box.
 */
type ConfigPanel = Component &
  Focusable & {
    renderContent?: (width: number) => string[];
  };

const LIST_MAX_TERMINAL_FRACTION = 0.85;
const LIST_NON_VIEWPORT_ROWS = 7;
const EXTENSION_ROW_HEIGHT = 3;
const MIN_VISIBLE_EXTENSIONS = 2;

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

export type ExtensionState = SfPiExtension & { enabled: boolean };

export type OverlayResult = {
  changed: boolean;
  disabledFiles: Set<string>;
  needsReload?: boolean;
  scope: "global" | "project";
};

type OverlayView =
  | { kind: "list" }
  | { kind: "detail"; extensionId: string; actionIndex: number }
  | { kind: "settings"; extensionId: string };

type DetailAction = "settings" | "toggle" | "back";

interface DetailActionItem {
  value: DetailAction;
  label: string;
  description: string;
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

function wrapPlainText(text: string, width: number): string[] {
  if (width <= 0) {
    return [text];
  }

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

// -------------------------------------------------------------------------------------------------
// Component
// -------------------------------------------------------------------------------------------------

export class SfPiOverlayComponent implements Focusable {
  focused = false;

  private selectedIndex = 0;
  private listScrollOffset = 0;
  private extensions: ExtensionState[];
  private changed = false;
  private view: OverlayView = { kind: "list" };
  private activePanel: ConfigPanel | null = null;
  private activePanelExtId: string | null = null;
  private configPanelReloadNeeded = false;
  private scope: "global" | "project";

  // Resolved config panel factories keyed by extension id.
  // ConfigPanelFactory returns Focusable, but our panels also implement Component.
  private configFactories = new Map<string, ConfigPanelFactory>();
  private pendingFactories = new Map<string, Promise<ConfigPanelFactory>>();

  constructor(
    private readonly theme: Theme,
    private readonly packageVersion: string,
    private readonly packageRoot: string,
    private readonly cwd: string,
    initialStates: ExtensionState[],
    private readonly registryEntries: readonly SfPiExtension[],
    initialScope: "global" | "project",
    private readonly getTerminalRows: () => number,
    private readonly done: (result: OverlayResult | undefined) => void,
  ) {
    this.extensions = initialStates.map((e) => ({ ...e }));
    this.scope = initialScope;

    // Start cursor on the first toggleable extension.
    const firstToggleable = this.extensions.findIndex((e) => !e.alwaysActive);
    if (firstToggleable >= 0) this.selectedIndex = firstToggleable;

    // Pre-load config panel factories for configurable extensions.
    for (const ext of this.registryEntries) {
      if (ext.configurable && ext.getConfigPanel) {
        const promise = ext.getConfigPanel();
        this.pendingFactories.set(ext.id, promise);
        promise
          .then((factory) => {
            this.configFactories.set(ext.id, factory);
            this.pendingFactories.delete(ext.id);
            if (
              this.view.kind === "settings" &&
              this.activePanelExtId === ext.id &&
              !this.activePanel
            ) {
              this.attachConfigPanel(ext.id);
            }
          })
          .catch(() => {
            this.pendingFactories.delete(ext.id);
          });
      }
    }
  }

  handleInput(data: string): void {
    // --- Settings view ---
    if (this.view.kind === "settings") {
      if (this.activePanel) {
        this.activePanel.focused = this.focused;
        this.activePanel.handleInput?.(data);
      } else if (matchesKey(data, "escape")) {
        this.returnToDetail();
      }
      return;
    }

    // --- Detail view ---
    if (this.view.kind === "detail") {
      if (matchesKey(data, "escape")) {
        this.returnToList();
        return;
      }

      if (matchesKey(data, "up") || matchesKey(data, "k")) {
        this.moveDetailAction(-1);
        return;
      }

      if (matchesKey(data, "down") || matchesKey(data, "j")) {
        this.moveDetailAction(1);
        return;
      }

      if (matchesKey(data, "return") || matchesKey(data, "enter") || matchesKey(data, "space")) {
        this.runSelectedDetailAction();
      }
      return;
    }

    // --- List view ---

    if (matchesKey(data, "escape")) {
      if (this.changed || this.configPanelReloadNeeded) {
        this.applyAndClose();
      } else {
        this.done(undefined);
      }
      return;
    }

    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      const ext = this.extensions[this.selectedIndex];
      if (ext) {
        this.drillIntoDetail(ext.id);
      }
      return;
    }

    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      this.moveCursor(-1);
      return;
    }

    if (matchesKey(data, "down") || matchesKey(data, "j")) {
      this.moveCursor(1);
      return;
    }

    if (matchesKey(data, "space")) {
      this.toggleSelected();
      return;
    }

    if (data === "a" || data === "A") {
      const allEnabled = this.extensions.filter((e) => !e.alwaysActive).every((e) => e.enabled);
      for (const ext of this.extensions) {
        if (!ext.alwaysActive) ext.enabled = !allEnabled;
      }
      this.changed = true;
      return;
    }

    if (data === "s" || data === "S") {
      this.scope = this.scope === "global" ? "project" : "global";
      return;
    }
  }

  render(width: number): string[] {
    const innerWidth = Math.max(50, width - 2);
    const theme = this.theme;

    const row = (content: string = "", scrollBar: string = "") => {
      const scrollBarWidth = scrollBar ? 1 : 0;
      const contentWidth = Math.max(1, innerWidth - scrollBarWidth);
      const padded = padAnsi(truncateToWidth(content, contentWidth, ""), contentWidth);
      return `${theme.fg("border", "│")}${padded}${scrollBar}${theme.fg("border", "│")}`;
    };

    if (this.view.kind === "detail") {
      return this.renderDetailView(innerWidth, row);
    }

    if (this.view.kind === "settings") {
      return this.renderSettingsView(innerWidth, row);
    }

    return this.renderListView(innerWidth, row);
  }

  invalidate(): void {
    this.activePanel?.invalidate?.();
  }

  // -------------------------------------------------------------------------------------------------
  // List view rendering
  // -------------------------------------------------------------------------------------------------

  private renderListView(
    innerWidth: number,
    row: (content?: string, scrollBar?: string) => string,
  ): string[] {
    const lines: string[] = [];
    const theme = this.theme;
    const enabledCount = this.extensions.filter((e) => e.enabled).length;
    const totalCount = this.extensions.length;
    const visibleCount = this.getVisibleExtensionCount();
    this.ensureSelectionVisible(visibleCount);

    const selected = this.extensions[this.selectedIndex];
    const visibleExtensions = this.extensions.slice(
      this.listScrollOffset,
      this.listScrollOffset + visibleCount,
    );
    const needsScrollbar = totalCount > visibleCount;
    const listContentWidth = needsScrollbar ? innerWidth - 1 : innerWidth;
    const listViewportRows = Math.max(1, visibleExtensions.length * EXTENSION_ROW_HEIGHT - 1);
    let listViewportRowIndex = 0;
    const listRow = (content: string = "") =>
      row(
        content,
        needsScrollbar
          ? this.renderListScrollbar(listViewportRowIndex++, listViewportRows, visibleCount)
          : "",
      );

    lines.push(theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));

    const title = theme.fg("accent", theme.bold("sf-pi Extension Manager"));
    const version = theme.fg("dim", `v${this.packageVersion}`);
    const titleLeft = ` ${title}`;
    const titlePad = Math.max(1, innerWidth - visibleWidth(titleLeft) - visibleWidth(version) - 1);
    lines.push(row(`${titleLeft}${" ".repeat(titlePad)}${version}`));

    const scopeLabel =
      this.scope === "global" ? theme.fg("accent", "global") : theme.fg("warning", "project");
    lines.push(
      row(
        ` ${theme.fg("dim", "Scope:")} ${scopeLabel} ${theme.fg("dim", "· S switch · ↑↓ move · Space toggle · Enter details · Esc done")}`,
      ),
    );
    lines.push(row(""));

    for (let localIndex = 0; localIndex < visibleExtensions.length; localIndex++) {
      const ext = visibleExtensions[localIndex];
      if (!ext) continue;
      const i = this.listScrollOffset + localIndex;
      const isSelected = i === this.selectedIndex;

      const indicator = this.renderStatusIndicator(getExtensionStatus(ext));
      const cursor = isSelected ? theme.fg("accent", "▸") : " ";
      const name = isSelected
        ? theme.bold(ext.name)
        : ext.enabled || ext.alwaysActive
          ? ext.name
          : theme.fg("dim", ext.name);
      const categoryTag = theme.fg("muted", `[${ext.category}]`);
      const stateBadge = this.renderListStateBadge(getExtensionStatus(ext));
      const configBadge = ext.configurable ? theme.fg("accent", "⚙") : "";
      const rightParts = [configBadge, stateBadge, categoryTag].filter(Boolean).join(" ");
      const leftPart = ` ${cursor} ${indicator} ${name}`;
      const gap = Math.max(
        2,
        listContentWidth - visibleWidth(leftPart) - visibleWidth(rightParts) - 1,
      );

      lines.push(listRow(`${leftPart}${" ".repeat(gap)}${rightParts}`));
      lines.push(
        listRow(
          `     ${theme.fg(ext.enabled || ext.alwaysActive ? "dim" : "muted", ext.description)}`,
        ),
      );

      if (localIndex < visibleExtensions.length - 1) {
        lines.push(listRow(""));
      }
    }

    lines.push(row(""));
    if (selected) {
      const selectedSummary = [
        getExtensionStatusLabel(selected),
        selected.defaultEnabled ? "Default on install" : "Disabled by default",
        selected.configurable ? "Configurable" : "No settings",
      ];
      lines.push(
        row(` ${theme.fg("muted", "Selected:")} ${theme.fg("dim", selectedSummary.join(" · "))}`),
      );
    }

    const visibleStart = totalCount === 0 ? 0 : this.listScrollOffset + 1;
    const visibleEnd = Math.min(totalCount, this.listScrollOffset + visibleCount);
    const countText = theme.fg(
      "muted",
      `Enabled: ${enabledCount}/${totalCount} extensions · Showing ${visibleStart}-${visibleEnd}`,
    );
    const changedText = this.changed ? theme.fg("warning", " (unsaved changes)") : "";
    const reloadText = this.configPanelReloadNeeded ? theme.fg("warning", " (reload pending)") : "";
    lines.push(row(` ${countText}${changedText}${reloadText}`));

    lines.push(theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));

    return lines;
  }

  // -------------------------------------------------------------------------------------------------
  // Detail view rendering
  // -------------------------------------------------------------------------------------------------

  private renderDetailView(innerWidth: number, row: (content?: string) => string): string[] {
    const lines: string[] = [];
    const theme = this.theme;
    const ext = this.getActiveExtension();

    if (!ext) {
      return this.renderListView(innerWidth, row);
    }

    const detail = buildExtensionDetailSummary(ext, this.packageRoot);
    const backHint = theme.fg("dim", "← Esc back");
    const titleText = theme.fg("accent", theme.bold(ext.name));
    const stateTag = this.renderStateTag(detail.status);
    const categoryTag = theme.fg("muted", `[${ext.category}]`);
    const headerLeft = ` ${backHint}  ${titleText}`;
    const headerRight = `${stateTag} ${categoryTag} `;
    const headerGap = Math.max(
      2,
      innerWidth - visibleWidth(headerLeft) - visibleWidth(headerRight),
    );

    lines.push(theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));
    lines.push(row(`${headerLeft}${" ".repeat(headerGap)}${headerRight}`));
    lines.push(row(""));

    lines.push(row(` ${theme.fg("accent", theme.bold("About"))}`));
    for (const descLine of wrapPlainText(ext.description, innerWidth - 3)) {
      lines.push(row(`  ${theme.fg("dim", descLine)}`));
    }
    lines.push(row(""));

    lines.push(row(` ${theme.fg("accent", theme.bold("State"))}`));
    lines.push(row(`  Status: ${this.renderStateValue(detail.status, detail.statusLabel)}`));
    lines.push(row(`  Scope: ${theme.fg("dim", this.scope)}`));
    lines.push(row(`  Default on install: ${theme.fg("dim", ext.defaultEnabled ? "yes" : "no")}`));
    lines.push(row(`  Configurable: ${theme.fg("dim", ext.configurable ? "yes" : "no")}`));
    lines.push(row(`  Always active: ${theme.fg("dim", ext.alwaysActive ? "yes" : "no")}`));
    lines.push(row(""));

    lines.push(row(` ${theme.fg("accent", theme.bold("Bundle"))}`));
    lines.push(row(`  Entry: ${theme.fg("dim", ext.file)}`));
    lines.push(
      row(
        `  README: ${theme.fg(detail.readmeAvailable ? "dim" : "muted", detail.readmeAvailable ? detail.readmePath : "Not provided")}`,
      ),
    );
    lines.push(
      row(
        `  Tests: ${theme.fg(detail.testsAvailable ? "dim" : "muted", detail.testsAvailable ? `${detail.testsPath}/` : "Not provided")}`,
      ),
    );
    lines.push(row(""));

    lines.push(row(` ${theme.fg("accent", theme.bold("Capabilities"))}`));
    this.pushCapabilityGroup(lines, row, "Commands", detail.commands);
    this.pushCapabilityGroup(lines, row, "Providers", detail.providers);
    this.pushCapabilityGroup(lines, row, "Tools", detail.tools);
    this.pushCapabilityGroup(lines, row, "Events", detail.events);
    if (
      detail.commands.length === 0 &&
      detail.providers.length === 0 &&
      detail.tools.length === 0 &&
      detail.events.length === 0
    ) {
      lines.push(
        row(`  ${theme.fg("muted", "No commands, providers, tools, or events declared.")}`),
      );
    }

    lines.push(row(""));
    lines.push(row(` ${theme.fg("accent", theme.bold("Actions"))}`));
    const actions = this.getDetailActions(ext);
    const actionIndex = this.view.kind === "detail" ? this.view.actionIndex : 0;
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (!action) continue;
      const selected = i === actionIndex;
      const cursor = selected ? theme.fg("accent", "→") : " ";
      const label = selected ? theme.fg("accent", action.label) : theme.fg("text", action.label);
      lines.push(row(`  ${cursor} ${label}`));
      lines.push(row(`     ${theme.fg("dim", action.description)}`));
    }

    lines.push(theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));

    return lines;
  }

  private renderSettingsView(innerWidth: number, row: (content?: string) => string): string[] {
    const lines: string[] = [];
    const theme = this.theme;
    const ext = this.getActiveExtension();

    if (!ext) {
      return this.renderListView(innerWidth, row);
    }

    lines.push(theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));
    const breadcrumb = `← Esc back  SF Pi › ${ext.name} › Settings`;
    lines.push(row(` ${theme.fg("accent", theme.bold(breadcrumb))}`));
    lines.push(row(""));

    if (this.activePanel) {
      this.activePanel.focused = this.focused;
      const contentRows = this.activePanel.renderContent
        ? this.activePanel.renderContent(innerWidth)
        : this.activePanel.render(innerWidth);
      for (const contentRow of contentRows) {
        lines.push(row(contentRow));
      }
    } else if (this.pendingFactories.has(ext.id)) {
      lines.push(row(` ${theme.fg("dim", "Loading settings panel…")}`));
    } else {
      lines.push(row(` ${theme.fg("muted", "Settings panel unavailable.")}`));
    }

    lines.push(theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
    return lines;
  }

  // -------------------------------------------------------------------------------------------------
  // View transitions
  // -------------------------------------------------------------------------------------------------

  private drillIntoDetail(extensionId: string): void {
    this.activePanelExtId = null;
    this.activePanel = null;
    this.view = { kind: "detail", extensionId, actionIndex: 0 };
  }

  private drillIntoSettings(extensionId: string): void {
    this.activePanelExtId = extensionId;
    this.activePanel = null;
    this.view = { kind: "settings", extensionId };
    this.attachConfigPanel(extensionId);
  }

  private attachConfigPanel(extensionId: string): void {
    const ext = this.extensions.find((entry) => entry.id === extensionId);
    const factory = this.configFactories.get(extensionId);
    if (!ext?.configurable || !factory) {
      return;
    }

    this.activePanel = factory(
      this.theme,
      this.cwd,
      this.scope,
      (result: ConfigPanelResult | undefined) => {
        if (result?.needsReload) {
          this.configPanelReloadNeeded = true;
        }
        this.returnToDetail();
      },
    ) as ConfigPanel;
  }

  private returnToDetail(): void {
    const extensionId =
      this.view.kind === "settings" ? this.view.extensionId : this.activePanelExtId;
    this.activePanel = null;
    this.activePanelExtId = null;
    if (extensionId) {
      this.view = { kind: "detail", extensionId, actionIndex: 0 };
      return;
    }
    this.view = { kind: "list" };
  }

  private returnToList(): void {
    this.activePanel = null;
    this.activePanelExtId = null;
    this.view = { kind: "list" };
  }

  private applyAndClose(): void {
    if (this.changed || this.configPanelReloadNeeded) {
      const disabledFiles = new Set<string>();
      for (const ext of this.extensions) {
        if (!ext.enabled && !ext.alwaysActive) {
          disabledFiles.add(ext.file);
        }
      }
      this.done({
        changed: true,
        disabledFiles,
        needsReload: this.configPanelReloadNeeded,
        scope: this.scope,
      });
    } else {
      this.done(undefined);
    }
  }

  // -------------------------------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------------------------------

  private getActiveExtension(): ExtensionState | undefined {
    const view = this.view;
    if (view.kind === "list") {
      return undefined;
    }
    return this.extensions.find((ext) => ext.id === view.extensionId);
  }

  private getDetailActions(ext: ExtensionState): DetailActionItem[] {
    const actions: DetailActionItem[] = [];
    if (ext.configurable) {
      actions.push({
        value: "settings",
        label: "Settings",
        description: "Open this extension's focused settings page.",
      });
    }
    if (!ext.alwaysActive) {
      actions.push({
        value: "toggle",
        label: ext.enabled ? "Disable extension" : "Enable extension",
        description: ext.enabled
          ? "Add this extension to the disabled package filters."
          : "Remove this extension from the disabled package filters.",
      });
    }
    actions.push({ value: "back", label: "Back", description: "Return to the extension list." });
    return actions;
  }

  private moveDetailAction(direction: -1 | 1): void {
    if (this.view.kind !== "detail") return;
    const ext = this.getActiveExtension();
    if (!ext) return;
    const count = this.getDetailActions(ext).length;
    this.view.actionIndex = (this.view.actionIndex + direction + count) % count;
  }

  private runSelectedDetailAction(): void {
    if (this.view.kind !== "detail") return;
    const ext = this.getActiveExtension();
    if (!ext) return;
    const action = this.getDetailActions(ext)[this.view.actionIndex];
    if (!action) return;

    switch (action.value) {
      case "settings":
        this.drillIntoSettings(ext.id);
        return;
      case "toggle":
        this.toggleActiveDetailExtension();
        return;
      case "back":
        this.returnToList();
        return;
    }
  }

  private getVisibleExtensionCount(): number {
    const terminalRows = Math.max(1, this.getTerminalRows());
    const overlayRows = Math.max(1, Math.floor(terminalRows * LIST_MAX_TERMINAL_FRACTION));
    const availableListRows = Math.max(
      EXTENSION_ROW_HEIGHT * MIN_VISIBLE_EXTENSIONS,
      overlayRows - LIST_NON_VIEWPORT_ROWS,
    );
    const visibleCount = Math.max(
      MIN_VISIBLE_EXTENSIONS,
      Math.floor((availableListRows + 1) / EXTENSION_ROW_HEIGHT),
    );

    return Math.min(this.extensions.length, visibleCount);
  }

  private ensureSelectionVisible(visibleCount = this.getVisibleExtensionCount()): void {
    if (this.extensions.length === 0) {
      this.selectedIndex = 0;
      this.listScrollOffset = 0;
      return;
    }

    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.extensions.length - 1));

    const maxOffset = Math.max(0, this.extensions.length - visibleCount);
    if (this.selectedIndex < this.listScrollOffset) {
      this.listScrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.listScrollOffset + visibleCount) {
      this.listScrollOffset = this.selectedIndex - visibleCount + 1;
    }

    this.listScrollOffset = Math.max(0, Math.min(this.listScrollOffset, maxOffset));
  }

  private renderListScrollbar(
    viewportRowIndex: number,
    viewportRows: number,
    visibleCount: number,
  ): string {
    if (this.extensions.length <= visibleCount || viewportRows <= 0) {
      return "";
    }

    const maxOffset = Math.max(1, this.extensions.length - visibleCount);
    const thumbRows = Math.max(
      1,
      Math.round((visibleCount / this.extensions.length) * viewportRows),
    );
    const thumbStart = Math.round((this.listScrollOffset / maxOffset) * (viewportRows - thumbRows));
    const isThumb = viewportRowIndex >= thumbStart && viewportRowIndex < thumbStart + thumbRows;

    return this.theme.fg(isThumb ? "accent" : "dim", isThumb ? "█" : "│");
  }

  private renderStatusIndicator(status: ReturnType<typeof getExtensionStatus>): string {
    if (status === "locked") {
      return this.theme.fg("accent", "◆");
    }
    return status === "enabled" ? this.theme.fg("success", "●") : this.theme.fg("error", "○");
  }

  private renderListStateBadge(status: ReturnType<typeof getExtensionStatus>): string {
    const color = status === "locked" ? "accent" : status === "enabled" ? "success" : "error";
    const label = status === "locked" ? "locked" : status;
    return this.theme.fg(color, `[ ${label} ]`);
  }

  private renderStateTag(status: ReturnType<typeof getExtensionStatus>): string {
    const indicator = this.renderStatusIndicator(status);
    return `${indicator} ${this.renderListStateBadge(status)}`;
  }

  private renderStateValue(status: ReturnType<typeof getExtensionStatus>, label: string): string {
    const color = status === "locked" ? "accent" : status === "enabled" ? "success" : "error";
    return this.theme.fg(color, label);
  }

  private pushCapabilityGroup(
    lines: string[],
    row: (content?: string) => string,
    label: string,
    values: readonly string[],
  ): void {
    if (values.length === 0) {
      return;
    }

    lines.push(row(`  ${this.theme.fg("muted", `${label}:`)}`));
    for (const value of values) {
      lines.push(row(`    ${this.theme.fg("dim", value)}`));
    }
  }

  private moveCursor(direction: number): void {
    const len = this.extensions.length;
    let next = this.selectedIndex + direction;

    if (next < 0) next = len - 1;
    if (next >= len) next = 0;

    this.selectedIndex = next;
    this.ensureSelectionVisible();
  }

  private toggleSelected(): void {
    const ext = this.extensions[this.selectedIndex];
    if (!ext || ext.alwaysActive) return;
    ext.enabled = !ext.enabled;
    this.changed = true;
  }

  private toggleActiveDetailExtension(): void {
    const ext = this.getActiveExtension();
    if (!ext || ext.alwaysActive) {
      return;
    }
    ext.enabled = !ext.enabled;
    this.changed = true;
  }
}
