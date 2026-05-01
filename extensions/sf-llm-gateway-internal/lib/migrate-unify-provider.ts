/* SPDX-License-Identifier: Apache-2.0 */
/**
 * One-shot settings migration: collapse two gateway providers into one.
 *
 * Before R1·Unify the extension registered two providers:
 *   - sf-llm-gateway-internal             (openai-completions)
 *   - sf-llm-gateway-internal-anthropic   (anthropic-messages)
 *
 * After R1·Unify only the first one exists. Users upgrading from an older
 * sf-pi may have any of the following persisted in their pi settings.json
 * (global or project):
 *
 *   - defaultProvider:  "sf-llm-gateway-internal-anthropic"
 *   - defaultModel:     "sf-llm-gateway-internal-anthropic/claude-*"
 *   - enabledModels:    [... "sf-llm-gateway-internal-anthropic/*" ...]
 *
 * Without rewriting those values, pi would resolve defaultProvider to a
 * ghost registration, pin an unknown model, and warn
 * `No models match pattern "sf-llm-gateway-internal-anthropic/*"`.
 *
 * This module runs once per user (idempotent), rewrites each affected
 * field, and drops a sentinel under the `sfPi` settings namespace so we
 * never rewrite the same file twice.
 *
 * The migrator is conservative:
 *   - only touches the three keys above
 *   - only rewrites values that reference the legacy provider
 *   - preserves non-gateway patterns, casing, and ordering
 *   - leaves user's pi settings otherwise untouched
 *   - never overwrites a hand-crafted value that the user already changed
 *     to something non-legacy
 */
import {
  LEGACY_ENABLED_MODEL_PATTERN_ANTHROPIC,
  LEGACY_PROVIDER_NAME_ANTHROPIC,
  PROVIDER_NAME,
} from "./config.ts";
import {
  globalSettingsPath,
  projectSettingsPath,
  readSettings,
  writeSettings,
} from "./pi-settings.ts";

const LEGACY_PROVIDER_PREFIX = `${LEGACY_PROVIDER_NAME_ANTHROPIC}/`;
const ENABLED_PATTERN = `${PROVIDER_NAME}/*`;

/**
 * Namespace + key for the sentinel. We store under `sfPi.gatewayUnifyMigrated`
 * instead of a top-level key to keep the pi settings root clean and to match
 * the pattern established by sf-pi-manager (`sfPi.announcements`, etc.).
 */
export const MIGRATION_SENTINEL_KEY = "sfPi";
export const MIGRATION_SENTINEL_FIELD = "gatewayUnifyMigrated";

export interface MigrationResult {
  /** true when at least one key in this settings file was rewritten. */
  changed: boolean;
  /** true when the settings file already carried the sentinel. */
  alreadyMigrated: boolean;
  /** Human-readable summary of what changed, for notifications / logs. */
  changes: string[];
}

/**
 * Rewrite a single settings.json file in place.
 *
 * Returns `changed=true` when one or more of defaultProvider / defaultModel /
 * enabledModels referenced the legacy anthropic provider and had to be
 * rewritten, OR when the sentinel was just set for the first time on a file
 * that happened to already be clean (prevents re-scanning next session).
 */
export function migrateSettingsFile(filePath: string): MigrationResult {
  const settings = readSettings(filePath);
  const sentinelBlock = toRecord(settings[MIGRATION_SENTINEL_KEY]);
  const alreadyMigrated = sentinelBlock[MIGRATION_SENTINEL_FIELD] === true;
  if (alreadyMigrated) {
    return { changed: false, alreadyMigrated: true, changes: [] };
  }

  const changes: string[] = [];
  let dirty = false;

  // ── defaultProvider ───────────────────────────────────────────────────
  if (settings.defaultProvider === LEGACY_PROVIDER_NAME_ANTHROPIC) {
    settings.defaultProvider = PROVIDER_NAME;
    changes.push(`defaultProvider: ${LEGACY_PROVIDER_NAME_ANTHROPIC} → ${PROVIDER_NAME}`);
    dirty = true;
  }

  // ── defaultModel ──────────────────────────────────────────────────────
  if (
    typeof settings.defaultModel === "string" &&
    settings.defaultModel.startsWith(LEGACY_PROVIDER_PREFIX)
  ) {
    const rewritten = `${PROVIDER_NAME}/${settings.defaultModel.slice(LEGACY_PROVIDER_PREFIX.length)}`;
    changes.push(`defaultModel: ${settings.defaultModel} → ${rewritten}`);
    settings.defaultModel = rewritten;
    dirty = true;
  }

  // ── enabledModels ─────────────────────────────────────────────────────
  // Drop the legacy wildcard entirely. The remaining `sf-llm-gateway-internal/*`
  // now covers every model family (OpenAI-compat + Anthropic).
  if (Array.isArray(settings.enabledModels)) {
    const before = (settings.enabledModels as unknown[]).filter(
      (item): item is string => typeof item === "string",
    );
    const filtered = before.filter((pattern) => !isLegacyAnthropicPattern(pattern));
    // Also collapse any legacy exact-model entries that already used the
    // retired provider id, e.g. "sf-llm-gateway-internal-anthropic/claude-*".
    const hasLegacyExact = before.some(
      (pattern) =>
        pattern.startsWith(LEGACY_PROVIDER_PREFIX) &&
        pattern !== LEGACY_ENABLED_MODEL_PATTERN_ANTHROPIC,
    );

    if (filtered.length !== before.length) {
      // Ensure the current wildcard stays present; it may have been dropped if
      // the user had only the legacy wildcard.
      const out = filtered.includes(ENABLED_PATTERN) ? filtered : [ENABLED_PATTERN, ...filtered];
      settings.enabledModels = out;
      changes.push(
        hasLegacyExact
          ? `enabledModels: removed legacy anthropic entries`
          : `enabledModels: removed ${LEGACY_ENABLED_MODEL_PATTERN_ANTHROPIC}`,
      );
      dirty = true;
    }
  }

  // Always stamp the sentinel so future sessions skip this file entirely.
  // Preserves unrelated keys under `sfPi` (e.g. announcements state).
  settings[MIGRATION_SENTINEL_KEY] = {
    ...sentinelBlock,
    [MIGRATION_SENTINEL_FIELD]: true,
  };

  // Write only when something actually changed OR when we needed to stamp
  // the sentinel for the first time on a fresh file. The second case
  // prevents us from re-scanning the same untouched file every session.
  const hadSentinelBlockBefore = settings[MIGRATION_SENTINEL_KEY] !== sentinelBlock;
  if (dirty || !hadSentinelBlockBefore || !alreadyMigrated) {
    writeSettings(filePath, settings);
  }

  return { changed: dirty, alreadyMigrated: false, changes };
}

/**
 * Run the migration across the user's global settings and their project
 * settings (when a cwd is available). Safe to call multiple times — each
 * file carries its own sentinel and short-circuits after the first run.
 */
export function migrateGatewaySettings(cwd: string | undefined): MigrationResult[] {
  const results: MigrationResult[] = [];
  results.push(migrateSettingsFile(globalSettingsPath()));
  if (cwd) {
    results.push(migrateSettingsFile(projectSettingsPath(cwd)));
  }
  return results;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function isLegacyAnthropicPattern(pattern: string): boolean {
  return pattern === LEGACY_ENABLED_MODEL_PATTERN_ANTHROPIC;
}
