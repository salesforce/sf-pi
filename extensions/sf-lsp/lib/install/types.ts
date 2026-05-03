/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared types for the first-boot LSP installer.
 *
 * Kept deliberately tiny so the pure detection/versioning modules do not
 * have to import the installer's side-effectful code.
 */

/** Components the installer manages. "java" is detect-only. */
export type LspComponentId = "apex" | "lwc" | "java";

/** Per-component state derived from local files + upstream metadata. */
export type ComponentState =
  /** Not installed locally. */
  | "missing"
  /** Installed locally but upstream has a newer version. */
  | "outdated"
  /** Installed and up to date. */
  | "current"
  /** Installer cannot auto-manage this on the current platform (Windows / Java). */
  | "manual"
  /** Upstream version lookup failed (offline, proxy, etc.). */
  | "unknown";

export interface ComponentReport {
  id: LspComponentId;
  /** Human-readable label used in prompts and notifications. */
  label: string;
  state: ComponentState;
  /** Version currently installed under ~/.pi/agent/lsp/. */
  installedVersion?: string;
  /** Latest version published upstream. */
  latestVersion?: string;
  /** Free-form status detail — shown in `/sf-lsp install status`. */
  detail?: string;
}

/** Consolidated snapshot for the orchestrator. */
export interface InstallReport {
  components: ComponentReport[];
  /** True if at least one component is `missing` or `outdated`. */
  hasActionable: boolean;
  /** True on Windows — we can still detect but cannot auto-install. */
  platformManual: boolean;
}

/** Persisted per-component decision; keyed by component id. */
export type ComponentDecision =
  /** User accepted the prompt. We still re-prompt on version bumps. */
  | { action: "install"; acceptedVersion?: string; at: string }
  /** User declined. We re-prompt only when a newer version is available. */
  | { action: "decline"; declinedVersion?: string; at: string };

export interface LspInstallState {
  /** Last time the orchestrator presented the bundled confirm dialog. */
  lastPromptedAt?: string;
  decisions: Partial<Record<LspComponentId, ComponentDecision>>;
}

/** Outcome of a single component install attempt. */
export interface ComponentInstallResult {
  id: LspComponentId;
  ok: boolean;
  installedVersion?: string;
  message: string;
}
