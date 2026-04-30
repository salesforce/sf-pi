/* SPDX-License-Identifier: Apache-2.0 */
/**
 * TUI overlay component for the sf-pi extension manager.
 *
 * Two-level navigation:
 *   Level 0 (list)   — Extension list with enable/disable toggles and scope selector
 *   Level 1 (detail) — Per-extension details for every extension, with inline settings
 *                      for configurable extensions
 *
 * The overlay is a composite router: one overlay stays open, and internal state
 * switches between the list view and a detail/config view. No screen flicker.
 *
 * Keybindings:
 *   ↑↓       navigate list
 *   Space    toggle enable/disable (list view, or detail view without settings)
 *   Enter    open detail view for the selected extension
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
} from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
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

type OverlayView = { kind: "list" } | { kind: "detail"; extensionId: string };

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
              this.view.kind === "detail" &&
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
    // --- Detail view ---
    if (this.view.kind === "detail") {
      if (matchesKey(data, "escape")) {
        this.returnToList();
        return;
      }

      if (!this.activePanel && matchesKey(data, "space")) {
        this.toggleActiveDetailExtension();
        return;
      }

      if (this.activePanel) {
        this.activePanel.focused = this.focused;
        this.activePanel.handleInput?.(data);
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

    const row = (content: string = "") => {
      const padded = padAnsi(truncateToWidth(content, innerWidth, ""), innerWidth);
      return `${theme.fg("border", "│")}${padded}${theme.fg("border", "│")}`;
    };

    if (this.view.kind === "detail") {
      return this.renderDetailView(innerWidth, row);
    }

    return this.renderListView(innerWidth, row);
  }

  invalidate(): void {
    this.activePanel?.invalidate?.();
  }

  // -------------------------------------------------------------------------------------------------
  // List view rendering
  // -------------------------------------------------------------------------------------------------

  private renderListView(innerWidth: number, row: (content?: string) => string): string[] {
    const lines: string[] = [];
    const theme = this.theme;
    const enabledCount = this.extensions.filter((e) => e.enabled).length;
    const totalCount = this.extensions.length;
    const selected = this.extensions[this.selectedIndex];

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

    for (let i = 0; i < this.extensions.length; i++) {
      const ext = this.extensions[i];
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
      const gap = Math.max(2, innerWidth - visibleWidth(leftPart) - visibleWidth(rightParts) - 1);

      lines.push(row(`${leftPart}${" ".repeat(gap)}${rightParts}`));
      lines.push(
        row(`     ${theme.fg(ext.enabled || ext.alwaysActive ? "dim" : "muted", ext.description)}`),
      );

      if (i < this.extensions.length - 1) {
        lines.push(row(""));
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

    const countText = theme.fg("muted", `Enabled: ${enabledCount}/${totalCount} extensions`);
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

    if (ext.configurable) {
      lines.push(row(""));
      lines.push(row(` ${theme.fg("accent", theme.bold("Settings"))}`));
      if (this.activePanel) {
        this.activePanel.focused = this.focused;
        const contentRows = this.activePanel.renderContent
          ? this.activePanel.renderContent(innerWidth)
          : this.activePanel.render(innerWidth);
        for (const contentRow of contentRows) {
          lines.push(row(contentRow));
        }
      } else if (this.pendingFactories.has(ext.id)) {
        lines.push(row(`  ${theme.fg("dim", "Loading settings panel…")}`));
      } else {
        lines.push(row(`  ${theme.fg("muted", "Settings panel unavailable.")}`));
      }
    } else {
      lines.push(row(""));
      lines.push(row(` ${theme.fg("accent", theme.bold("Actions"))}`));
      if (ext.alwaysActive) {
        lines.push(row(`  ${theme.fg("dim", "This extension is locked and always active.")}`));
      } else {
        lines.push(row(`  ${theme.fg("dim", "Space toggle enabled/disabled")}`));
      }
      lines.push(row(`  ${theme.fg("dim", "Esc back to the extension list")}`));
    }

    lines.push(theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));

    return lines;
  }

  // -------------------------------------------------------------------------------------------------
  // View transitions
  // -------------------------------------------------------------------------------------------------

  private drillIntoDetail(extensionId: string): void {
    this.activePanelExtId = extensionId;
    this.activePanel = null;
    this.view = { kind: "detail", extensionId };
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
        this.returnToList();
      },
    ) as ConfigPanel;
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
    if (this.view.kind !== "detail") {
      return undefined;
    }
    const detailView = this.view;
    return this.extensions.find((ext) => ext.id === detailView.extensionId);
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
