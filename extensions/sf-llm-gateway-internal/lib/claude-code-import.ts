/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Claude Code settings importer for SF LLM Gateway onboarding.
 *
 * The Salesforce Claude Code installer can leave a gateway root URL and API
 * token in the user's local Claude Code settings. This module imports only
 * non-secret settings, normalizes the URL back to the gateway root, and reports
 * credential presence without returning credential material.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { normalizeBaseUrl } from "./config.ts";

export const CLAUDE_CODE_SETTINGS_RELATIVE_PATH = path.join(".claude", "settings.json");

export type ClaudeCodeGatewayImportCandidate = {
  baseUrl?: string;
  apiKeyPresent: boolean;
  baseUrlPath?: string;
  apiKeyPath?: string;
  warnings: string[];
};

export type ClaudeCodeGatewayImportSuccess = ClaudeCodeGatewayImportCandidate & {
  ok: true;
  reason?: undefined;
};

export type ClaudeCodeGatewayImportFailure = {
  ok: false;
  reason: string;
  warnings: string[];
};

export type ClaudeCodeGatewayImportResult =
  ClaudeCodeGatewayImportSuccess | ClaudeCodeGatewayImportFailure;

type StringEntry = {
  path: string;
  key: string;
  value: string;
};

type ScoredEntry = StringEntry & {
  score: number;
  normalized?: string;
};

export function getClaudeCodeSettingsPath(home: string = homedir()): string {
  return path.join(home, CLAUDE_CODE_SETTINGS_RELATIVE_PATH);
}

export function readClaudeCodeGatewayConfig(
  settingsPath: string = getClaudeCodeSettingsPath(),
): ClaudeCodeGatewayImportResult {
  if (!existsSync(settingsPath)) {
    return {
      ok: false,
      reason: `Claude Code settings not found at ${settingsPath}`,
      warnings: [],
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    return findClaudeCodeGatewayConfig(parsed);
  } catch (error) {
    return {
      ok: false,
      reason: `Could not read Claude Code settings: ${error instanceof Error ? error.message : String(error)}`,
      warnings: [],
    };
  }
}

export function findClaudeCodeGatewayConfig(raw: unknown): ClaudeCodeGatewayImportResult {
  const entries = collectStringEntries(raw);
  const urlCandidates = scoreUrlCandidates(entries);
  const tokenCandidates = scoreTokenCandidates(entries);
  const bestUrl = urlCandidates[0];
  const bestToken = tokenCandidates[0];
  const warnings: string[] = [];

  if (urlCandidates.length > 1) {
    warnings.push(
      "Multiple URL-like values were found; imported the highest-confidence gateway URL.",
    );
  }
  if (tokenCandidates.length > 1) {
    warnings.push(
      "Multiple token-like values were found; imported the highest-confidence API token.",
    );
  }

  if (!bestUrl && !bestToken) {
    return {
      ok: false,
      reason: "No gateway URL or API token was detected in Claude Code settings.",
      warnings,
    };
  }

  return {
    ok: true,
    baseUrl: bestUrl?.normalized,
    apiKeyPresent: Boolean(bestToken),
    baseUrlPath: bestUrl?.path,
    apiKeyPath: bestToken?.path,
    warnings,
  };
}

function collectStringEntries(raw: unknown): StringEntry[] {
  const entries: StringEntry[] = [];
  const seen = new Set<unknown>();

  function visit(value: unknown, pathParts: string[]): void {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        entries.push({
          path: pathParts.join("."),
          key: pathParts[pathParts.length - 1] ?? "",
          value: trimmed,
        });
      }
      return;
    }

    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...pathParts, String(index)]));
      return;
    }

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      visit(item, [...pathParts, key]);
    }
  }

  visit(raw, []);
  return entries;
}

function scoreUrlCandidates(entries: StringEntry[]): ScoredEntry[] {
  return entries
    .map((entry): ScoredEntry | null => {
      const normalized = normalizeBaseUrl(entry.value);
      if (!normalized) return null;

      const haystack = `${entry.path} ${entry.key} ${entry.value}`.toLowerCase();
      let score = 1;
      if (
        /anthropic[_-]?base[_-]?url|base[_-]?url|gateway[_-]?url|gateway[_-]?host/.test(haystack)
      ) {
        score += 80;
      }
      if (/gateway|litellm|proxy/.test(haystack)) score += 25;
      if (/env|settings|provider/.test(haystack)) score += 5;
      if (/docs|homepage|support|browser|install/.test(haystack)) score -= 30;

      return score > 0 ? { ...entry, normalized, score } : null;
    })
    .filter((entry): entry is ScoredEntry => Boolean(entry))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function scoreTokenCandidates(entries: StringEntry[]): ScoredEntry[] {
  return entries
    .map((entry): ScoredEntry | null => {
      const value = stripBearerPrefix(entry.value.trim());
      if (!isTokenLikeValue(value)) return null;

      const haystack = `${entry.path} ${entry.key}`.toLowerCase();
      let score = 0;
      if (/anthropic[_-]?auth[_-]?token|auth[_-]?token|api[_-]?key|apikey/.test(haystack)) {
        score += 90;
      }
      if (/(^|[._-])(token|key|authorization|auth)([._-]|$)/.test(haystack)) score += 45;
      if (/gateway|llm|provider|env|settings/.test(haystack)) score += 10;
      if (/url|host|model|path|command|script|install|homepage/.test(haystack)) score -= 60;
      if (value.length >= 24) score += 5;

      return score > 0 ? { ...entry, value, score } : null;
    })
    .filter((entry): entry is ScoredEntry => Boolean(entry))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function stripBearerPrefix(value: string): string {
  return value.replace(/^Bearer\s+/i, "").trim();
}

function isTokenLikeValue(value: string): boolean {
  if (value.length < 12) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/\s/.test(value)) return false;
  // Avoid importing JSON snippets or shell fragments as tokens.
  if (/[{}<>]/.test(value)) return false;
  return true;
}
