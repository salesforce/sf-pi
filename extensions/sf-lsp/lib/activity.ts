/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Per-language LSP activity store.
 *
 * Pure state + formatters for:
 *   - `setStatus()` footer segment (picked up by sf-devbar via
 *     `footerData.getExtensionStatuses()`)
 *   - HUD overlay rows
 *   - Below-editor widget line
 *   - Rich `/sf-lsp` panel
 *
 * No rendering (ANSI/theme) lives here — only data + label/formatter helpers
 * that the thin rendering modules consume. That keeps this file fully
 * testable without any TUI dependency.
 */

import type {
  SfPiDiagnosticMetadataItem,
  SfPiDiagnosticsMetadata,
} from "../../../lib/common/display/diagnostics.ts";
import type { LspDiagnostic, LspDoctorStatus, SupportedLanguage } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

/** Latest known status for one LSP language. */
export type LspActivityStatus =
  | "idle"
  | "checking"
  | "clean"
  | "error"
  | "unavailable"
  | "transition-clean";

export interface LspActivityEntry {
  language: SupportedLanguage;
  status: LspActivityStatus;
  /** Last file checked (absolute path) — undefined before the first run. */
  filePath?: string;
  /** Basename cache for display. */
  fileName?: string;
  /** Number of diagnostics from the last run. */
  diagnosticCount: number;
  /** Wall-clock duration of the last check in ms. */
  durationMs?: number;
  /** Monotonic timestamp (Date.now()) of the last update. */
  updatedAt?: number;
  /** Human-readable reason when status === "unavailable". */
  unavailableReason?: string;
  /** Structured diagnostics payload from the last check (errors only). */
  diagnostics?: SfPiDiagnosticMetadataItem[];
  /** Launch source (vscode, pi-global, env, path, ...) when known. */
  source?: string;
}

export interface LspActivityStore {
  /** One entry per supported language. Initialized lazily. */
  byLanguage: Map<SupportedLanguage, LspActivityEntry>;
  /** Circular ring of recent check events (newest first). */
  recent: LspActivityRecord[];
  /** True once at least one check has been recorded this session. */
  hasActivity: boolean;
}

export interface LspActivityRecord {
  language: SupportedLanguage;
  filePath: string;
  fileName: string;
  status: LspActivityStatus;
  diagnosticCount: number;
  durationMs: number;
  timestamp: number;
  unavailableReason?: string;
}

export interface LspCheckSample {
  language: SupportedLanguage;
  filePath: string;
  startedAt: number;
  finishedAt: number;
  diagnostics: LspDiagnostic[];
  unavailable?: LspDoctorStatus;
  /**
   * Previous file status *before* this check — used to promote a clean
   * result to `transition-clean` so the UI can pop a "now clean" chip.
   */
  previousFileStatus: "clean" | "error" | undefined;
  /**
   * Metadata mirror of what `buildToolResultUpdate` stamped into
   * `details.sfPiDiagnostics`. Used for the in-card renderer so we
   * keep exactly one source of truth.
   */
  metadata?: SfPiDiagnosticsMetadata;
}

const RECENT_RING_SIZE = 20;

// -------------------------------------------------------------------------------------------------
// Store management
// -------------------------------------------------------------------------------------------------

export function createActivityStore(): LspActivityStore {
  return {
    byLanguage: new Map<SupportedLanguage, LspActivityEntry>(),
    recent: [],
    hasActivity: false,
  };
}

export function resetActivityStore(store: LspActivityStore): void {
  store.byLanguage.clear();
  store.recent.length = 0;
  store.hasActivity = false;
}

/** Seed entries from a doctor probe so the HUD/footer can show availability
 *  even before the first tool_result check fires. */
export function seedFromDoctor(store: LspActivityStore, statuses: LspDoctorStatus[]): void {
  for (const status of statuses) {
    const entry = ensureEntry(store, status.language);
    if (!status.available) {
      entry.status = "unavailable";
      entry.unavailableReason = status.detail;
    } else {
      entry.source = status.source;
    }
  }
}

/** Mark a language as actively checking (used to drive the working indicator
 *  and a transient "checking…" badge on the HUD). */
export function markChecking(
  store: LspActivityStore,
  language: SupportedLanguage,
  filePath: string,
  fileName: string,
): void {
  const entry = ensureEntry(store, language);
  entry.status = "checking";
  entry.filePath = filePath;
  entry.fileName = fileName;
  entry.updatedAt = Date.now();
}

/**
 * Record the result of one LSP check. Promotes clean results to
 * `transition-clean` when the file was previously in error.
 */
export function recordCheck(store: LspActivityStore, sample: LspCheckSample): LspActivityEntry {
  const entry = ensureEntry(store, sample.language);
  const fileName = basename(sample.filePath);
  const durationMs = Math.max(0, sample.finishedAt - sample.startedAt);

  if (sample.unavailable) {
    entry.status = "unavailable";
    entry.filePath = sample.filePath;
    entry.fileName = fileName;
    entry.diagnosticCount = 0;
    entry.durationMs = durationMs;
    entry.updatedAt = sample.finishedAt;
    entry.unavailableReason = sample.unavailable.detail;
    entry.source = sample.unavailable.source ?? entry.source;
    entry.diagnostics = [];
  } else {
    const errorDiagnostics = sample.diagnostics.filter((d) => (d.severity ?? 1) === 1);
    const isError = errorDiagnostics.length > 0;
    entry.status = isError
      ? "error"
      : sample.previousFileStatus === "error"
        ? "transition-clean"
        : "clean";
    entry.filePath = sample.filePath;
    entry.fileName = fileName;
    entry.diagnosticCount = errorDiagnostics.length;
    entry.durationMs = durationMs;
    entry.updatedAt = sample.finishedAt;
    entry.unavailableReason = undefined;
    entry.diagnostics = sample.metadata?.diagnostics ?? [];
    entry.source = sample.metadata?.diagnostics ? entry.source : entry.source;
  }

  pushRecent(store, {
    language: sample.language,
    filePath: sample.filePath,
    fileName,
    status: entry.status,
    diagnosticCount: entry.diagnosticCount,
    durationMs,
    timestamp: sample.finishedAt,
    unavailableReason: entry.unavailableReason,
  });

  store.hasActivity = true;
  return entry;
}

function ensureEntry(store: LspActivityStore, language: SupportedLanguage): LspActivityEntry {
  let entry = store.byLanguage.get(language);
  if (!entry) {
    entry = {
      language,
      status: "idle",
      diagnosticCount: 0,
    };
    store.byLanguage.set(language, entry);
  }
  return entry;
}

function pushRecent(store: LspActivityStore, record: LspActivityRecord): void {
  store.recent.unshift(record);
  if (store.recent.length > RECENT_RING_SIZE) {
    store.recent.length = RECENT_RING_SIZE;
  }
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx === -1 ? p : p.slice(idx + 1);
}

// -------------------------------------------------------------------------------------------------
// Public label / formatter helpers (pure, no theme)
// -------------------------------------------------------------------------------------------------

export const LANGUAGE_ORDER: readonly SupportedLanguage[] = ["apex", "lwc", "agentscript"];

export function languageLabel(language: SupportedLanguage): string {
  switch (language) {
    case "apex":
      return "Apex";
    case "lwc":
      return "LWC";
    case "agentscript":
      return "AS";
  }
}

export function languageLongLabel(language: SupportedLanguage): string {
  switch (language) {
    case "apex":
      return "Apex";
    case "lwc":
      return "LWC";
    case "agentscript":
      return "Agent Script";
  }
}

/**
 * Map status to a single-cell glyph. ASCII-safe fallback is handled by the
 * caller via glyph-policy; this returns the aspirational glyph.
 */
export function statusGlyph(status: LspActivityStatus): string {
  switch (status) {
    case "checking":
      return "◐";
    case "clean":
    case "transition-clean":
      return "●";
    case "error":
      return "●";
    case "unavailable":
      return "○";
    case "idle":
    default:
      return "·";
  }
}

/** Which theme color category the caller should use for a given status. */
export type LspStatusColor = "success" | "error" | "warning" | "accent" | "muted" | "dim";

export function statusColor(status: LspActivityStatus): LspStatusColor {
  switch (status) {
    case "clean":
    case "transition-clean":
      return "success";
    case "error":
      return "error";
    case "unavailable":
      return "warning";
    case "checking":
      return "accent";
    case "idle":
    default:
      return "dim";
  }
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatRelativeAge(timestamp: number | undefined, now: number = Date.now()): string {
  if (!timestamp) return "";
  const diff = Math.max(0, now - timestamp);
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

/** One-word label for the footer pill (e.g. "clean", "error", "off"). */
export function statusBadgeLabel(status: LspActivityStatus): string {
  switch (status) {
    case "clean":
    case "transition-clean":
      return "ok";
    case "error":
      return "err";
    case "unavailable":
      return "off";
    case "checking":
      return "…";
    case "idle":
    default:
      return "idle";
  }
}
