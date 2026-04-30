/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Extracted config panel for the SF LLM Gateway provider.
 *
 * This is the inner content of the gateway setup overlay, refactored to be
 * hostable by either:
 *   1. The standalone overlay (`/sf-llm-gateway-internal setup`)
 *   2. The sf-pi Extension Manager drill-down
 *
 * The panel does NOT draw its own border box — the host is responsible for
 * framing. It renders content rows and handles keyboard input when focused.
 */

import { CURSOR_MARKER, type Focusable, matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  type ConfigSource,
  PROVIDER_NAME,
  DEFAULT_MODEL_ID,
  DEFAULT_THINKING_LEVEL,
  BASE_URL_ENV,
  API_KEY_ENV,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  describeConfigValue,
  describeApiKey,
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
  | "apiKey"
  | "exclusiveScope"
  | "save-enable"
  | "save"
  | "disable"
  | "cancel";

type ExclusiveScopeMode = "inherit" | "exclusive" | "additive";

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

function maskApiKeyForDisplay(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(Math.max(4, value.length));
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

// -------------------------------------------------------------------------------------------------
// Config panel component
// -------------------------------------------------------------------------------------------------

export class GatewayConfigPanelComponent implements Focusable {
  focused = false;

  private readonly focusOrder: readonly PanelField[] = [
    "baseUrl",
    "apiKey",
    "exclusiveScope",
    "save-enable",
    "save",
    "disable",
    "cancel",
  ];
  private focusIndex = 0;
  private savedBaseUrl: string;
  private savedApiKey: string;
  private savedExclusiveScopeMode: ExclusiveScopeMode;
  private baseUrlCursor: number;
  private apiKeyCursor: number;
  private errorMessage: string | null = null;
  private state: SetupOverlayState;
  private readonly cwd: string;

  constructor(
    private readonly theme: Theme,
    private readonly scope: "global" | "project",
    cwd: string,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    this.cwd = cwd;
    this.state = getSetupOverlayState(cwd, scope);
    this.savedBaseUrl = this.state.scopeSaved.baseUrl ?? "";
    this.savedApiKey = this.state.scopeSaved.apiKey ?? "";
    this.savedExclusiveScopeMode =
      this.state.scopeSaved.exclusiveScope === true
        ? "exclusive"
        : this.state.scopeSaved.exclusiveScope === false
          ? "additive"
          : "inherit";
    this.baseUrlCursor = this.savedBaseUrl.length;
    this.apiKeyCursor = this.savedApiKey.length;
  }

  handleInput(data: string): void {
    // Escape goes back (host handles this for drill-down; standalone handles close)
    if (matchesKey(data, "escape")) {
      this.done(undefined);
      return;
    }

    const focus = this.currentFocus();
    if (focus === "baseUrl" || focus === "apiKey") {
      if (this.handleTextFieldInput(focus, data)) {
        return;
      }
    }

    if (focus === "exclusiveScope") {
      if (this.handleExclusiveScopeInput(data)) {
        return;
      }
    }

    if (matchesKey(data, "tab") || matchesKey(data, "down")) {
      this.errorMessage = null;
      this.focusIndex = (this.focusIndex + 1) % this.focusOrder.length;
      return;
    }

    if (matchesKey(data, "shift+tab") || matchesKey(data, "up")) {
      this.errorMessage = null;
      this.focusIndex = (this.focusIndex - 1 + this.focusOrder.length) % this.focusOrder.length;
      return;
    }

    if (matchesKey(data, "left")) {
      if (focus !== "baseUrl" && focus !== "apiKey") {
        this.errorMessage = null;
        this.focusIndex = (this.focusIndex - 1 + this.focusOrder.length) % this.focusOrder.length;
      }
      return;
    }

    if (matchesKey(data, "right")) {
      if (focus !== "baseUrl" && focus !== "apiKey") {
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
    const helpText = "Tab/↑↓ move · type to edit · Enter next/apply · Esc back";
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
        ` ${theme.fg("dim", `Enable sets ${PROVIDER_NAME}/${DEFAULT_MODEL_ID} with thinking ${DEFAULT_THINKING_LEVEL}.`)}`,
      ),
    );
    lines.push(
      pad(
        ` ${theme.fg("dim", "Saved fields are fallbacks. Matching env vars override them when present.")}`,
      ),
    );
    lines.push(pad(""));

    // Base URL field
    lines.push(pad(` ${this.renderFieldLabel("baseUrl", "Saved base URL fallback")}`));
    lines.push(pad(`   ${this.renderTextField("baseUrl", width - 4)}`));
    lines.push(
      pad(
        `   ${theme.fg("muted", `Effective now: ${describeConfigValue(effective.baseUrl, effective.baseUrlSource)}`)}`,
      ),
    );
    if (this.state.effectiveConfig.baseUrlSource === "env") {
      lines.push(
        pad(`   ${theme.fg("dim", `${BASE_URL_ENV} currently overrides the saved fallback.`)}`),
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

    // API key field
    lines.push(pad(` ${this.renderFieldLabel("apiKey", "Saved API key fallback")}`));
    lines.push(pad(`   ${this.renderTextField("apiKey", width - 4)}`));
    lines.push(
      pad(
        `   ${theme.fg("muted", `Effective now: ${describeApiKey(effective.apiKey, effective.apiKeySource)}`)}`,
      ),
    );
    if (this.state.effectiveConfig.apiKeySource === "env") {
      lines.push(
        pad(`   ${theme.fg("dim", `${API_KEY_ENV} currently overrides the saved fallback.`)}`),
      );
    } else if (
      this.scope === "project" &&
      this.state.lowerSavedApiKey &&
      !this.savedApiKey.trim()
    ) {
      lines.push(
        pad(`   ${theme.fg("dim", "Blank project value falls back to the global saved API key.")}`),
      );
    } else if (this.scope === "global" && this.state.higherSavedApiKey) {
      lines.push(
        pad(
          `   ${theme.fg("dim", "A project-scope saved API key currently overrides global for this project.")}`,
        ),
      );
    }
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
          `   ${theme.fg("dim", "Save + enable writes gateway-only scoped models and restores the previous scope on disable.")}`,
        ),
      );
    } else if (this.savedExclusiveScopeMode === "additive") {
      lines.push(
        pad(
          `   ${theme.fg("dim", `Save + enable prepends ${PROVIDER_NAME}/* while preserving other scoped models.`)}`,
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
    lines.push(
      pad(
        `   ${this.renderButton("save-enable", "Save + enable Opus 4.7")}  ${this.renderButton("save", "Save only")}`,
      ),
    );
    lines.push(
      pad(
        `   ${this.renderButton("disable", "Disable")}  ${this.renderButton("cancel", "Cancel")}`,
      ),
    );
    lines.push(pad(""));

    // Status / error line
    if (this.errorMessage) {
      lines.push(pad(` ${theme.fg("error", `⚠ ${this.errorMessage}`)}`));
    } else {
      lines.push(pad(` ${theme.fg("dim", helpText)}`));
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

  private renderFieldLabel(field: "baseUrl" | "apiKey" | "exclusiveScope", label: string): string {
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

  private renderTextField(field: "baseUrl" | "apiKey", width: number): string {
    const focused = this.currentFocus() === field;
    const rawValue = field === "baseUrl" ? this.savedBaseUrl : this.savedApiKey;
    const cursor = field === "baseUrl" ? this.baseUrlCursor : this.apiKeyCursor;
    const placeholder =
      field === "baseUrl" ? DEFAULT_BASE_URL : "Paste saved fallback API key here";
    const innerWidth = Math.max(12, width - 2);
    const open = this.theme.fg(focused ? "accent" : "border", "[");
    const close = this.theme.fg(focused ? "accent" : "border", "]");

    if (!rawValue && !focused) {
      const content = padAnsi(this.theme.fg("dim", placeholder), innerWidth);
      return `${open}${content}${close}`;
    }

    const displayValue = field === "apiKey" && !focused ? maskApiKeyForDisplay(rawValue) : rawValue;
    const viewport = getTextViewport(displayValue, cursor, innerWidth);
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
    field: "save-enable" | "save" | "disable" | "cancel",
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
    if (matchesKey(data, "left")) {
      this.cycleExclusiveScopeMode(-1);
      this.errorMessage = null;
      return true;
    }
    if (matchesKey(data, "right") || matchesKey(data, "space")) {
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

  private handleTextFieldInput(field: "baseUrl" | "apiKey", data: string): boolean {
    const getter =
      field === "baseUrl"
        ? () => ({ value: this.savedBaseUrl, cursor: this.baseUrlCursor })
        : () => ({ value: this.savedApiKey, cursor: this.apiKeyCursor });
    const setter =
      field === "baseUrl"
        ? (value: string, cursor: number) => {
            this.savedBaseUrl = value;
            this.baseUrlCursor = cursor;
          }
        : (value: string, cursor: number) => {
            this.savedApiKey = value;
            this.apiKeyCursor = cursor;
          };

    let { value, cursor } = getter();

    if (matchesKey(data, "left")) {
      setter(value, Math.max(0, cursor - 1));
      this.errorMessage = null;
      return true;
    }
    if (matchesKey(data, "right")) {
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
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      value = value.slice(0, cursor) + data + value.slice(cursor);
      cursor += 1;
      setter(value, cursor);
      this.errorMessage = null;
      return true;
    }

    return false;
  }

  private submitCurrentFocus(): void {
    const focus = this.currentFocus();
    if (focus === "baseUrl" || focus === "apiKey") {
      this.focusIndex = (this.focusIndex + 1) % this.focusOrder.length;
      return;
    }
    if (focus === "exclusiveScope") {
      this.cycleExclusiveScopeMode(1);
      return;
    }
    if (focus === "cancel") {
      this.done(undefined);
      return;
    }

    const normalizedSavedBaseUrl = this.normalizeSavedBaseUrl();
    if (this.savedBaseUrl.trim() && !normalizedSavedBaseUrl) {
      this.errorMessage = "Saved base URL must be blank or a valid http:// or https:// URL.";
      this.focusIndex = 0;
      return;
    }

    if (focus === "save-enable") {
      const effective = this.resolveEffectivePreview(normalizedSavedBaseUrl);
      if (!effective.baseUrl) {
        this.errorMessage = `Built-in default base URL is unavailable; set ${BASE_URL_ENV} or enter a saved base URL fallback before enabling.`;
        this.focusIndex = 0;
        return;
      }
      if (!effective.apiKey) {
        this.errorMessage = `Set ${API_KEY_ENV} or enter a saved API key fallback before enabling.`;
        this.focusIndex = 1;
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

    const trimmedApiKey = this.savedApiKey.trim() || undefined;
    if (trimmedApiKey) {
      saved.apiKey = trimmedApiKey;
    } else {
      delete saved.apiKey;
    }

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

    writeGatewaySavedConfig(configPath, saved);

    // Signal reload needed for enable/disable actions
    const needsReload = focus === "save-enable" || focus === "disable";
    this.done({ needsReload });
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

  private resolveEffectivePreview(
    normalizedSavedBaseUrl: string | undefined = this.normalizeSavedBaseUrl(),
  ): {
    baseUrl?: string;
    baseUrlSource: ConfigSource;
    apiKey?: string;
    apiKeySource: ConfigSource;
    exclusiveScope: boolean;
    exclusiveScopeSource: Extract<ConfigSource, "saved" | "default">;
  } {
    const envBaseUrl = normalizeBaseUrl(process.env[BASE_URL_ENV]);
    const savedBaseUrl =
      this.state.higherSavedBaseUrl ?? normalizedSavedBaseUrl ?? this.state.lowerSavedBaseUrl;
    const envApiKey = process.env[API_KEY_ENV]?.trim() || undefined;
    const savedApiKey = this.savedApiKey.trim() || undefined;
    const savedExclusiveScope =
      this.state.higherSavedExclusiveScope ??
      this.getSavedExclusiveScopeValue() ??
      this.state.lowerSavedExclusiveScope;

    const baseUrl = envBaseUrl ?? savedBaseUrl ?? DEFAULT_BASE_URL;
    const apiKey =
      envApiKey ?? this.state.higherSavedApiKey ?? savedApiKey ?? this.state.lowerSavedApiKey;

    return {
      baseUrl,
      baseUrlSource: envBaseUrl ? "env" : savedBaseUrl ? "saved" : "default",
      apiKey,
      apiKeySource: envApiKey ? "env" : apiKey ? "saved" : "missing",
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
