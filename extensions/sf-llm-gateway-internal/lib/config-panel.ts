/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Extracted config panel for the SF LLM Gateway provider.
 *
 * This is the inner content of the gateway setup UI, refactored to be
 * hostable by either:
 *   1. The standalone slash-command overlay (`/sf-llm-gateway setup`)
 *   2. The sf-pi Extension Manager settings/setup drill-down
 *
 * The panel does NOT draw its own border box — the host is responsible for
 * framing. It renders content rows and handles keyboard input when focused.
 */

import { CURSOR_MARKER, type Focusable, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  type ConfigSource,
  PROVIDER_NAME,
  DEFAULT_MODEL_ID,
  BASE_URL_ENV,
  LEGACY_BASE_URL_ENV,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  readGatewayEnv,
  describeConfigValue,
  readGatewaySavedConfig,
  writeGatewaySavedConfig,
  globalGatewayConfigPath,
  projectGatewayConfigPath,
} from "./config.ts";
import { getTextViewport, type SetupOverlayState, getSetupOverlayState } from "./setup-overlay.ts";

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

type PanelField =
  | "baseUrl"
  | "exclusiveScope"
  | "open-token"
  | "import-claude"
  | "save-enable"
  | "save"
  | "disable"
  | "cancel";

type GatewayConfigPanelResult = ConfigPanelResult & {
  gatewayAction?: "open-token" | "import-claude" | "save-enable" | "save" | "disable";
  baseUrl?: string;
};

type ExclusiveScopeMode = "inherit" | "exclusive" | "additive";

type ConfigPanelOptions = {
  /** Show token-page / Claude Code import buttons. Used by the standalone setup overlay. */
  externalActions?: boolean;
  /** Show enable/disable actions. These require entry-point orchestration after the panel closes. */
  lifecycleActions?: boolean;
  /** Close after save and return a gatewayAction to the host. Manager-hosted settings save in place. */
  closeOnSave?: boolean;
};

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

const ESC = String.fromCharCode(27);
const CSI = `${ESC}[`;
const SS3 = `${ESC}O`;

export function normalizePastedTextFieldInput(data: string): string {
  if (isBareCsiSequence(data)) return "";

  let output = "";
  for (let i = 0; i < data.length; i++) {
    const nextIndex = consumeTerminalControl(data, i);
    if (nextIndex !== i) {
      i = nextIndex - 1;
      continue;
    }

    const code = data.charCodeAt(i);
    if (code < 32 || code === 127) continue;
    output += data[i] ?? "";
  }
  return output;
}

function consumeTerminalControl(data: string, index: number): number {
  if (data.startsWith(CSI, index)) {
    return consumeCsi(data, index);
  }
  if (data.startsWith(SS3, index) && isArrowFinal(data[index + 2])) {
    return index + 3;
  }
  return index;
}

function consumeCsi(data: string, index: number): number {
  for (let i = index + CSI.length; i < data.length; i++) {
    const code = data.charCodeAt(i);
    // CSI final bytes are in the ASCII @ through ~ range.
    if (code >= 64 && code <= 126) return i + 1;
  }
  return data.length;
}

function isBareCsiSequence(data: string): boolean {
  return /^\[(?:\d+(?:;\d+)*)?[A-Za-z~]$/.test(data);
}

function isUpKey(data: string): boolean {
  return matchesKey(data, "up") || data === `${SS3}A` || isCsiArrow(data, "A");
}

function isDownKey(data: string): boolean {
  return matchesKey(data, "down") || data === `${SS3}B` || isCsiArrow(data, "B");
}

function isLeftKey(data: string): boolean {
  return matchesKey(data, "left") || data === `${SS3}D` || isCsiArrow(data, "D");
}

function isRightKey(data: string): boolean {
  return matchesKey(data, "right") || data === `${SS3}C` || isCsiArrow(data, "C");
}

function isCsiArrow(data: string, final: "A" | "B" | "C" | "D"): boolean {
  if (!data.startsWith(CSI) || !data.endsWith(final)) return false;
  const params = data.slice(CSI.length, -1);
  return params === "" || /^(?:\d+(?:;\d+)*)$/.test(params);
}

function isArrowFinal(value: string | undefined): boolean {
  return value === "A" || value === "B" || value === "C" || value === "D";
}

// -------------------------------------------------------------------------------------------------
// Config panel component
// -------------------------------------------------------------------------------------------------

export class GatewayConfigPanelComponent implements Focusable {
  focused = false;

  private readonly focusOrder: readonly PanelField[];
  private focusIndex = 0;
  private savedBaseUrl: string;
  private savedExclusiveScopeMode: ExclusiveScopeMode;
  private persistedBaseUrl: string;
  private persistedExclusiveScopeMode: ExclusiveScopeMode;
  private baseUrlCursor: number;
  private errorMessage: string | null = null;
  private savedMessage: string | null = null;
  private reloadRequired = false;
  private state: SetupOverlayState;
  private readonly cwd: string;

  constructor(
    private readonly theme: Theme,
    private readonly scope: "global" | "project",
    cwd: string,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
    private readonly options: ConfigPanelOptions = {},
  ) {
    this.cwd = cwd;
    this.focusOrder = [
      "baseUrl",
      "exclusiveScope",
      ...(options.externalActions ? (["open-token", "import-claude"] as const) : []),
      ...(options.lifecycleActions ? (["save-enable"] as const) : []),
      "save",
      ...(options.lifecycleActions ? (["disable"] as const) : []),
      "cancel",
    ];
    this.state = getSetupOverlayState(cwd, scope);
    this.savedBaseUrl = this.state.scopeSaved.baseUrl ?? "";
    this.savedExclusiveScopeMode = this.modeFromSavedExclusiveScope(
      this.state.scopeSaved.exclusiveScope,
    );
    this.persistedBaseUrl = this.savedBaseUrl;
    this.persistedExclusiveScopeMode = this.savedExclusiveScopeMode;
    this.baseUrlCursor = this.savedBaseUrl.length;
  }

  handleInput(data: string): void {
    // Escape goes back (host handles this for drill-down; standalone handles close)
    if (matchesKey(data, "escape")) {
      this.closePanel();
      return;
    }

    const focus = this.currentFocus();
    if (focus === "baseUrl") {
      if (this.handleTextFieldInput(data)) {
        return;
      }
    }

    if (focus === "exclusiveScope") {
      if (this.handleExclusiveScopeInput(data)) {
        return;
      }
    }

    if (matchesKey(data, "tab") || isDownKey(data)) {
      this.errorMessage = null;
      this.focusIndex = (this.focusIndex + 1) % this.focusOrder.length;
      return;
    }

    if (matchesKey(data, "shift+tab") || isUpKey(data)) {
      this.errorMessage = null;
      this.focusIndex = (this.focusIndex - 1 + this.focusOrder.length) % this.focusOrder.length;
      return;
    }

    if (isLeftKey(data)) {
      if (focus !== "baseUrl") {
        this.errorMessage = null;
        this.focusIndex = (this.focusIndex - 1 + this.focusOrder.length) % this.focusOrder.length;
      }
      return;
    }

    if (isRightKey(data)) {
      if (focus !== "baseUrl") {
        this.errorMessage = null;
        this.focusIndex = (this.focusIndex + 1) % this.focusOrder.length;
      }
      return;
    }

    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.submitCurrentFocus();
    }
  }

  /**
   * Render content rows (no border). The host draws the border box.
   * Each returned string should fit within `width`.
   */
  renderContent(width: number): string[] {
    const lines: string[] = [];
    const theme = this.theme;
    const effective = this.resolveEffectivePreview();
    const helpText = this.options.closeOnSave
      ? "Tab/↑↓ move · type/paste to edit · Enter action · token/import buttons return here"
      : "Tab/↑↓ move · type/paste to edit · Enter save · Esc back/discard";
    const saveTarget =
      this.scope === "project" ? projectGatewayConfigPath(this.cwd) : globalGatewayConfigPath();

    const pad = (content: string) => padAnsi(content, width);

    // Header info
    lines.push(
      pad(
        ` ${theme.fg("muted", `Scope: ${this.scope} · Effective status: ${this.state.effectiveConfig.enabled ? "enabled" : "disabled"}`)}`,
      ),
    );
    lines.push(
      pad(
        ` ${theme.fg(
          "dim",
          this.options.lifecycleActions
            ? `Enable sets ${PROVIDER_NAME}/${DEFAULT_MODEL_ID} without selecting thinking; Pi may clamp the current choice for model capabilities.`
            : `Use the detail-page Enable action to set ${PROVIDER_NAME}/${DEFAULT_MODEL_ID}; Pi/user settings keep thinking authority and Pi may clamp for capabilities.`,
        )}`,
      ),
    );
    lines.push(
      pad(
        ` ${theme.fg("dim", "Saved fields are primary. Env vars are only fallbacks when saved values are blank.")}`,
      ),
    );
    lines.push(pad(""));

    // Base URL field
    lines.push(pad(` ${this.renderFieldLabel("baseUrl", "Saved base URL")}`));
    lines.push(pad(`   ${this.renderTextField("baseUrl", width - 4)}`));
    lines.push(
      pad(
        `   ${theme.fg("muted", `Effective now: ${describeConfigValue(effective.baseUrl, effective.baseUrlSource)}`)}`,
      ),
    );
    if (this.state.effectiveConfig.baseUrlSource === "env") {
      lines.push(
        pad(
          `   ${theme.fg("dim", `Using ${BASE_URL_ENV} because no saved base URL is configured.`)}`,
        ),
      );
    } else if (
      this.scope === "project" &&
      this.state.lowerSavedBaseUrl &&
      !this.savedBaseUrl.trim()
    ) {
      lines.push(
        pad(
          `   ${theme.fg("dim", "Blank project value falls back to the global saved base URL.")}`,
        ),
      );
    } else if (this.scope === "global" && this.state.higherSavedBaseUrl) {
      lines.push(
        pad(
          `   ${theme.fg("dim", "A project-scope saved base URL currently overrides global for this project.")}`,
        ),
      );
    }
    lines.push(pad(""));

    const legacyCredentialPresent = Boolean(
      this.state.scopeSaved.apiKey ?? this.state.lowerSavedApiKey ?? this.state.higherSavedApiKey,
    );
    lines.push(
      pad(
        ` ${theme.fg(
          legacyCredentialPresent ? "warning" : "dim",
          legacyCredentialPresent
            ? "A legacy saved token is present but inactive. Use /login, then remove-legacy-token after verification."
            : "Credentials are managed by Pi. Use /login sf-llm-gateway-internal.",
        )}`,
      ),
    );
    lines.push(pad(""));

    // Scoped model mode field
    lines.push(pad(` ${this.renderFieldLabel("exclusiveScope", "Scoped model scope fallback")}`));
    lines.push(pad(`   ${this.renderExclusiveScopeField()}`));
    lines.push(
      pad(
        `   ${theme.fg("muted", `Effective now: ${effective.exclusiveScope ? "exclusive" : "additive"} (${effective.exclusiveScopeSource})`)}`,
      ),
    );
    if (this.savedExclusiveScopeMode === "exclusive") {
      lines.push(
        pad(
          `   ${theme.fg(
            "dim",
            this.options.lifecycleActions
              ? "Save + enable writes gateway-only scoped models and restores the previous scope on disable."
              : "The detail-page Enable action will write gateway-only scoped models and restore the previous scope on disable.",
          )}`,
        ),
      );
    } else if (this.savedExclusiveScopeMode === "additive") {
      lines.push(
        pad(
          `   ${theme.fg(
            "dim",
            this.options.lifecycleActions
              ? `Save + enable prepends ${PROVIDER_NAME}/* while preserving other scoped models.`
              : `The detail-page Enable action will prepend ${PROVIDER_NAME}/* while preserving other scoped models.`,
          )}`,
        ),
      );
    } else if (this.scope === "project" && this.state.lowerSavedExclusiveScope !== undefined) {
      lines.push(
        pad(`   ${theme.fg("dim", "Inherit uses the global saved scope mode for this project.")}`),
      );
    } else if (this.scope === "global" && this.state.higherSavedExclusiveScope !== undefined) {
      lines.push(
        pad(
          `   ${theme.fg("dim", "A project-scope saved mode currently overrides the global mode for this project.")}`,
        ),
      );
    } else {
      lines.push(
        pad(
          `   ${theme.fg("dim", "Inherit falls back to additive scope when no saved override exists.")}`,
        ),
      );
    }
    lines.push(pad(""));

    // Action buttons
    lines.push(pad(` ${theme.fg("muted", "Actions")}`));
    if (this.options.externalActions) {
      lines.push(
        pad(
          `   ${this.renderButton("open-token", "Open token page")}  ${this.renderButton("import-claude", "Import from Claude Code")}`,
        ),
      );
    }
    if (this.options.lifecycleActions) {
      lines.push(
        pad(
          `   ${this.renderButton("save-enable", "Save + enable default model")}  ${this.renderButton("save", "Save only")}`,
        ),
      );
      lines.push(
        pad(
          `   ${this.renderButton("disable", "Disable")}  ${this.renderButton("cancel", "Cancel")}`,
        ),
      );
    } else {
      lines.push(
        pad(`   ${this.renderButton("save", "Save")}  ${this.renderButton("cancel", "Cancel")}`),
      );
    }
    lines.push(pad(""));

    // Status / error line
    if (this.errorMessage) {
      lines.push(pad(` ${theme.fg("error", `⚠ ${this.errorMessage}`)}`));
    } else if (this.savedMessage) {
      lines.push(pad(` ${theme.fg("success", this.savedMessage)}`));
    } else {
      lines.push(pad(` ${theme.fg("dim", helpText)}`));
    }
    if (this.reloadRequired) {
      lines.push(
        pad(
          ` ${theme.fg("warning", "Reload required — Esc back, then close the Manager to apply.")}`,
        ),
      );
    }
    lines.push(pad(` ${theme.fg("dim", `Save target: ${saveTarget}`)}`));

    return lines;
  }

  render(width: number): string[] {
    // For standalone usage — just delegate to renderContent
    return this.renderContent(width);
  }

  invalidate(): void {}

  /**
   * Get the result to pass to the save logic.
   * Returns the action and field values for the host to process.
   */
  getAction(): "save-enable" | "save" | "disable" | undefined {
    // This is used by the standalone overlay wrapper
    return undefined;
  }

  // --- Private helpers ---

  private currentFocus(): PanelField {
    // focusIndex is kept in range by the moveFocus helpers, so focusOrder
    // always has a field at this position. Use a typed fallback instead
    // of a non-null assertion to satisfy strict lints.
    const field = this.focusOrder[this.focusIndex];
    if (!field) {
      throw new Error(
        `config-panel: focusIndex ${this.focusIndex} out of range (${this.focusOrder.length} fields)`,
      );
    }
    return field;
  }

  private renderFieldLabel(field: "baseUrl" | "exclusiveScope", label: string): string {
    const focused = this.currentFocus() === field;
    const prefix = focused ? this.theme.fg("accent", "▶") : this.theme.fg("dim", "•");
    const color = focused ? "accent" : "text";
    return `${prefix} ${this.theme.fg(color, label)}`;
  }

  private renderExclusiveScopeField(): string {
    const focused = this.currentFocus() === "exclusiveScope";
    const prefix = focused ? this.theme.fg("accent", "→") : this.theme.fg("dim", " ");
    const renderMode = (mode: ExclusiveScopeMode, label: string) => {
      const active = this.savedExclusiveScopeMode === mode;
      const color = active ? "accent" : "muted";
      const weight = active ? this.theme.bold(label) : label;
      return this.theme.fg(color, weight);
    };

    return [
      prefix,
      renderMode("inherit", "inherit"),
      this.theme.fg("dim", " / "),
      renderMode("exclusive", "exclusive"),
      this.theme.fg("dim", " / "),
      renderMode("additive", "additive"),
    ].join("");
  }

  private renderTextField(field: "baseUrl", width: number): string {
    const focused = this.currentFocus() === field;
    const rawValue = this.savedBaseUrl;
    const cursor = this.baseUrlCursor;
    const placeholder = DEFAULT_BASE_URL;
    const innerWidth = Math.max(12, width - 2);
    const open = this.theme.fg(focused ? "accent" : "border", "[");
    const close = this.theme.fg(focused ? "accent" : "border", "]");

    if (!rawValue && !focused) {
      const content = padAnsi(this.theme.fg("dim", placeholder), innerWidth);
      return `${open}${content}${close}`;
    }

    const viewport = getTextViewport(rawValue, cursor, innerWidth);
    let body = viewport.text;

    if (focused) {
      const before = body.slice(0, viewport.cursorIndex);
      // body[i] is only read when the guard above proves i < body.length,
      // but TS's noUncheckedIndexedAccess still reports the access as
      // string|undefined. Fall back to a space to keep the cursor cell sized.
      const atCursor =
        viewport.cursorIndex < body.length ? (body[viewport.cursorIndex] ?? " ") : " ";
      const after = viewport.cursorIndex < body.length ? body.slice(viewport.cursorIndex + 1) : "";
      const marker = this.focused ? CURSOR_MARKER : "";
      body = `${before}${marker}\x1b[7m${atCursor}\x1b[27m${after}`;
    }

    const padded = padAnsi(body, innerWidth);
    const content = focused ? this.theme.bg("selectedBg", padded) : padded;
    return `${open}${content}${close}`;
  }

  private renderButton(
    field: "open-token" | "import-claude" | "save-enable" | "save" | "disable" | "cancel",
    label: string,
  ): string {
    const focused = this.currentFocus() === field;
    const color =
      field === "save-enable"
        ? "success"
        : field === "disable"
          ? "warning"
          : field === "cancel"
            ? "muted"
            : "accent";
    const text = `[ ${label} ]`;
    if (focused) {
      return this.theme.bg("selectedBg", this.theme.fg("text", text));
    }
    return this.theme.fg(color, text);
  }

  private handleExclusiveScopeInput(data: string): boolean {
    if (isLeftKey(data)) {
      this.cycleExclusiveScopeMode(-1);
      this.errorMessage = null;
      return true;
    }
    if (isRightKey(data) || matchesKey(data, "space")) {
      this.cycleExclusiveScopeMode(1);
      this.errorMessage = null;
      return true;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.cycleExclusiveScopeMode(1);
      this.errorMessage = null;
      return true;
    }
    return false;
  }

  private cycleExclusiveScopeMode(direction: -1 | 1): void {
    const modes: ExclusiveScopeMode[] = ["inherit", "exclusive", "additive"];
    const currentIndex = modes.indexOf(this.savedExclusiveScopeMode);
    const nextIndex = (currentIndex + direction + modes.length) % modes.length;
    // Modulo keeps nextIndex within modes.length, but TS needs help to
    // prove it. Default back to the current mode if indexing ever returns
    // undefined (should be unreachable).
    this.savedExclusiveScopeMode = modes[nextIndex] ?? this.savedExclusiveScopeMode;
  }

  private handleTextFieldInput(data: string): boolean {
    const setter = (value: string, cursor: number) => {
      this.savedBaseUrl = value;
      this.baseUrlCursor = cursor;
    };

    let value = this.savedBaseUrl;
    let cursor = this.baseUrlCursor;

    if (isLeftKey(data)) {
      setter(value, Math.max(0, cursor - 1));
      this.errorMessage = null;
      return true;
    }
    if (isRightKey(data)) {
      setter(value, Math.min(value.length, cursor + 1));
      this.errorMessage = null;
      return true;
    }
    if (matchesKey(data, "home")) {
      setter(value, 0);
      this.errorMessage = null;
      return true;
    }
    if (matchesKey(data, "end")) {
      setter(value, value.length);
      this.errorMessage = null;
      return true;
    }
    if (matchesKey(data, "backspace")) {
      if (cursor > 0) {
        value = value.slice(0, cursor - 1) + value.slice(cursor);
        cursor -= 1;
      }
      setter(value, cursor);
      this.errorMessage = null;
      return true;
    }
    if (matchesKey(data, "delete")) {
      value = value.slice(0, cursor) + value.slice(cursor + 1);
      setter(value, cursor);
      this.errorMessage = null;
      return true;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.errorMessage = null;
      this.focusIndex = (this.focusIndex + 1) % this.focusOrder.length;
      return true;
    }
    const pastedText = normalizePastedTextFieldInput(data);
    if (pastedText) {
      value = value.slice(0, cursor) + pastedText + value.slice(cursor);
      cursor += pastedText.length;
      setter(value, cursor);
      this.errorMessage = null;
      return true;
    }

    return false;
  }

  private submitCurrentFocus(): void {
    const focus = this.currentFocus();
    if (focus === "baseUrl") {
      this.focusIndex = (this.focusIndex + 1) % this.focusOrder.length;
      return;
    }
    if (focus === "exclusiveScope") {
      this.cycleExclusiveScopeMode(1);
      return;
    }
    if (focus === "cancel") {
      this.closePanel();
      return;
    }

    const normalizedSavedBaseUrl = this.normalizeSavedBaseUrl();

    if (focus === "open-token") {
      if (this.savedBaseUrl.trim() && !normalizedSavedBaseUrl) {
        this.errorMessage = "Saved base URL must be blank or a valid http:// or https:// URL.";
        this.focusIndex = 0;
        return;
      }
      const effective = this.resolveEffectivePreview(normalizedSavedBaseUrl);
      this.done({
        gatewayAction: "open-token",
        baseUrl: effective.baseUrl,
      } as GatewayConfigPanelResult);
      return;
    }

    if (focus === "import-claude") {
      this.done({ gatewayAction: "import-claude" } as GatewayConfigPanelResult);
      return;
    }

    if (this.savedBaseUrl.trim() && !normalizedSavedBaseUrl) {
      this.errorMessage = "Saved base URL must be blank or a valid http:// or https:// URL.";
      this.focusIndex = 0;
      return;
    }

    if (focus === "save-enable") {
      const effective = this.resolveEffectivePreview(normalizedSavedBaseUrl);
      if (!effective.baseUrl) {
        this.errorMessage = `Enter a saved base URL before enabling. ${BASE_URL_ENV} is only an automation fallback.`;
        this.focusIndex = 0;
        return;
      }
    }

    // Save the config
    const configPath =
      this.scope === "project" ? projectGatewayConfigPath(this.cwd) : globalGatewayConfigPath();
    const saved = readGatewaySavedConfig(configPath);

    if (normalizedSavedBaseUrl) {
      saved.baseUrl = normalizedSavedBaseUrl;
    } else {
      delete saved.baseUrl;
    }

    // Existing apiKey fields are migration-only. Preserve them byte-for-byte;
    // this panel never creates, changes, or removes credential material.

    const savedExclusiveScope = this.getSavedExclusiveScopeValue();
    if (savedExclusiveScope === undefined) {
      delete saved.exclusiveScope;
    } else {
      saved.exclusiveScope = savedExclusiveScope;
    }

    if (focus === "save-enable") {
      saved.enabled = true;
    } else if (focus === "disable") {
      saved.enabled = false;
    }

    const changed = this.isDirty(normalizedSavedBaseUrl);
    const needsReload = focus === "save-enable" || focus === "disable";

    if (!changed && !needsReload && !this.options.closeOnSave) {
      this.savedMessage = "No changes to save.";
      this.errorMessage = null;
      return;
    }

    writeGatewaySavedConfig(configPath, saved);
    this.markSaved(normalizedSavedBaseUrl, savedExclusiveScope);

    // Signal reload needed for enable/disable actions. Manager-hosted settings
    // save in place and report the reload requirement when the user backs out.
    if (this.options.closeOnSave) {
      this.done({ needsReload, gatewayAction: focus } as GatewayConfigPanelResult);
      return;
    }

    this.reloadRequired = true;
    this.savedMessage = "Saved gateway settings.";
    this.errorMessage = null;
  }

  private normalizeSavedBaseUrl(): string | undefined {
    const trimmed = this.savedBaseUrl.trim();
    if (!trimmed) return undefined;
    return normalizeBaseUrl(trimmed);
  }

  private getSavedExclusiveScopeValue(): boolean | undefined {
    if (this.savedExclusiveScopeMode === "inherit") {
      return undefined;
    }
    return this.savedExclusiveScopeMode === "exclusive";
  }

  private closePanel(): void {
    this.done(this.reloadRequired ? ({ needsReload: true } as ConfigPanelResult) : undefined);
  }

  private isDirty(normalizedSavedBaseUrl: string | undefined): boolean {
    const draftBaseUrl = normalizedSavedBaseUrl ?? "";
    return (
      draftBaseUrl !== (normalizeBaseUrl(this.persistedBaseUrl) ?? "") ||
      this.savedExclusiveScopeMode !== this.persistedExclusiveScopeMode
    );
  }

  private markSaved(
    normalizedSavedBaseUrl: string | undefined,
    exclusiveScope: boolean | undefined,
  ): void {
    this.savedBaseUrl = normalizedSavedBaseUrl ?? "";
    this.savedExclusiveScopeMode = this.modeFromSavedExclusiveScope(exclusiveScope);
    this.persistedBaseUrl = this.savedBaseUrl;
    this.persistedExclusiveScopeMode = this.savedExclusiveScopeMode;
    this.baseUrlCursor = Math.min(this.baseUrlCursor, this.savedBaseUrl.length);
    this.state = getSetupOverlayState(this.cwd, this.scope);
  }

  private modeFromSavedExclusiveScope(value: boolean | undefined): ExclusiveScopeMode {
    if (value === true) return "exclusive";
    if (value === false) return "additive";
    return "inherit";
  }

  private resolveEffectivePreview(
    normalizedSavedBaseUrl: string | undefined = this.normalizeSavedBaseUrl(),
  ): {
    baseUrl?: string;
    baseUrlSource: ConfigSource;
    exclusiveScope: boolean;
    exclusiveScopeSource: Extract<ConfigSource, "saved" | "default">;
  } {
    const envBaseUrl = normalizeBaseUrl(readGatewayEnv(BASE_URL_ENV, LEGACY_BASE_URL_ENV));
    const savedBaseUrl =
      this.state.higherSavedBaseUrl ?? normalizedSavedBaseUrl ?? this.state.lowerSavedBaseUrl;
    const savedExclusiveScope =
      this.state.higherSavedExclusiveScope ??
      this.getSavedExclusiveScopeValue() ??
      this.state.lowerSavedExclusiveScope;

    const baseUrl = savedBaseUrl ?? envBaseUrl ?? DEFAULT_BASE_URL;

    return {
      baseUrl,
      baseUrlSource: savedBaseUrl ? "saved" : envBaseUrl ? "env" : "default",
      exclusiveScope: savedExclusiveScope ?? false,
      exclusiveScopeSource: savedExclusiveScope !== undefined ? "saved" : "default",
    };
  }
}

// -------------------------------------------------------------------------------------------------
// Factory function (matches ConfigPanelFactory signature)
// -------------------------------------------------------------------------------------------------

/** Convention export name used by the catalog generator. */
export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new GatewayConfigPanelComponent(theme, scope, cwd, done);
};
