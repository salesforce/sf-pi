/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Build safe, deterministic quick fixes for a set of filtered diagnostics.
 *
 * We intentionally handle only the codes where upstream ships a fix with an
 * exact TextEdit range — so the agent can apply the edit by-coordinates without
 * guessing. The fixes below mirror the upstream
 * `@agentscript/lsp/providers/code-actions.ts` behavior, scoped to the subset
 * where we don't need AST walking:
 *
 *   invalid-modifier, unknown-type  → replace typo with best candidate
 *   unknown-dialect                 → replace with each available dialect
 *   deprecated-field                → replace with `data.replacement` when set
 *   unused-variable                 → delete `data.removalRange`
 *   invalid-version                 → replace with each suggested version
 *
 * We do NOT attempt the `topic → subagent` rename, because that needs the AST
 * to rename `@topic.X` references. The agent can still do that from the
 * deprecation message alone.
 */

import type { AgentScriptDiagnostic, AgentScriptQuickFix, AgentScriptRange } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Shape of SDK-provided diagnostic data we trust
// -------------------------------------------------------------------------------------------------

/**
 * `data.found` + `data.expected` travels on `invalid-modifier` / `unknown-type`.
 */
interface SuggestionData {
  found?: string;
  expected?: string[];
}

/**
 * `data.removalRange` travels on `unused-variable`.
 */
interface RemovalRangeData {
  removalRange?: AgentScriptRange;
}

/**
 * `data.replacement` travels on `deprecated-field` when the SDK knows the
 * one-to-one replacement.
 */
interface ReplacementData {
  replacement?: string;
}

/**
 * `data.availableNames` travels on `unknown-dialect`.
 */
interface AvailableNamesData {
  availableNames?: string[];
}

/**
 * `data.suggestedVersions` travels on `invalid-version`.
 */
interface SuggestedVersionsData {
  suggestedVersions?: string[];
}

// -------------------------------------------------------------------------------------------------
// Typo closest-match
// -------------------------------------------------------------------------------------------------

/**
 * Minimal Levenshtein distance. Enough to rank a handful of dialect/modifier
 * candidates — not meant for large corpora.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = new Array<number>(rows * cols);

  for (let i = 0; i < rows; i++) dp[i * cols] = i;
  for (let j = 0; j < cols; j++) dp[j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i * cols + j] = Math.min(
        dp[(i - 1) * cols + j] + 1,
        dp[i * cols + (j - 1)] + 1,
        dp[(i - 1) * cols + (j - 1)] + cost,
      );
    }
  }

  return dp[rows * cols - 1];
}

/**
 * Best typo match for `found` against `candidates`, or `undefined` when no
 * candidate is reasonably close.
 */
function bestSuggestion(found: string, candidates: string[]): string | undefined {
  if (candidates.length === 0) return undefined;

  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = editDistance(found, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  // Reject suggestions that are farther than half the input length — those
  // are usually not typos, they're different words.
  if (best && bestScore * 2 > found.length) return undefined;
  return best;
}

// -------------------------------------------------------------------------------------------------
// Per-code fix builders
// -------------------------------------------------------------------------------------------------

/**
 * Build a text-edit that replaces an exact substring on the diagnostic's line.
 * Returns `null` when the substring isn't on the line (shouldn't happen, but we
 * guard defensively because TextEdits with bad ranges corrupt files).
 */
function replaceSubstringOnLine(
  source: string,
  line: number,
  substring: string,
  replacement: string,
): AgentScriptQuickFix["edits"][number] | null {
  const lines = source.split("\n");
  const lineText = lines[line];
  if (!lineText) return null;

  const col = lineText.indexOf(substring);
  if (col === -1) return null;

  return {
    range: {
      start: { line, character: col },
      end: { line, character: col + substring.length },
    },
    newText: replacement,
  };
}

function buildSuggestionFix(
  source: string,
  diagnostic: AgentScriptDiagnostic,
): AgentScriptQuickFix | null {
  const data = (diagnostic.data ?? {}) as SuggestionData;
  if (!data.found || !Array.isArray(data.expected) || data.expected.length === 0) return null;

  const suggestion = bestSuggestion(data.found, data.expected);
  if (!suggestion) return null;

  const edit = replaceSubstringOnLine(source, diagnostic.range.start.line, data.found, suggestion);
  if (!edit) return null;

  return {
    title: `Change '${data.found}' to '${suggestion}'`,
    preferred: true,
    diagnosticLine: diagnostic.range.start.line,
    diagnosticCode: diagnostic.code,
    edits: [edit],
  };
}

function buildUnknownDialectFixes(
  source: string,
  diagnostic: AgentScriptDiagnostic,
): AgentScriptQuickFix[] {
  const data = (diagnostic.data ?? {}) as AvailableNamesData;
  if (!Array.isArray(data.availableNames) || data.availableNames.length === 0) return [];

  return data.availableNames.map((name, index) => ({
    title: `Change to '${name}'`,
    preferred: index === 0,
    diagnosticLine: diagnostic.range.start.line,
    diagnosticCode: diagnostic.code,
    edits: [
      {
        range: diagnostic.range,
        newText: name,
      },
    ],
  }));
}

function buildDeprecatedFieldFix(
  source: string,
  diagnostic: AgentScriptDiagnostic,
): AgentScriptQuickFix | null {
  const data = (diagnostic.data ?? {}) as ReplacementData;
  if (!data.replacement || typeof data.replacement !== "string") return null;

  return {
    title: `Replace with '${data.replacement}'`,
    preferred: true,
    diagnosticLine: diagnostic.range.start.line,
    diagnosticCode: diagnostic.code,
    edits: [
      {
        range: diagnostic.range,
        newText: data.replacement,
      },
    ],
  };
}

function buildUnusedVariableFix(
  source: string,
  diagnostic: AgentScriptDiagnostic,
): AgentScriptQuickFix | null {
  const data = (diagnostic.data ?? {}) as RemovalRangeData;
  const removal = data.removalRange;
  if (!removal || !removal.start || !removal.end) return null;

  // Extend the end of the removal to the end of the line so we don't leave a
  // blank stub behind.
  const lines = source.split("\n");
  const endLine = removal.end.line;
  const endLineLength = lines[endLine]?.length ?? 0;

  const deleteEnd =
    endLine + 1 < lines.length
      ? { line: endLine + 1, character: 0 }
      : { line: endLine, character: endLineLength };

  return {
    title: `Remove unused variable`,
    preferred: true,
    diagnosticLine: diagnostic.range.start.line,
    diagnosticCode: diagnostic.code,
    edits: [
      {
        range: {
          start: { line: removal.start.line, character: 0 },
          end: deleteEnd,
        },
        newText: "",
      },
    ],
  };
}

function buildInvalidVersionFixes(
  source: string,
  diagnostic: AgentScriptDiagnostic,
): AgentScriptQuickFix[] {
  const data = (diagnostic.data ?? {}) as SuggestedVersionsData;
  const suggestions = data.suggestedVersions;
  if (!Array.isArray(suggestions) || suggestions.length === 0) return [];

  return suggestions.map((version, index) => ({
    title: `Set version to '${version}'`,
    preferred: index === 0,
    diagnosticLine: diagnostic.range.start.line,
    diagnosticCode: diagnostic.code,
    edits: [
      {
        range: diagnostic.range,
        newText: version,
      },
    ],
  }));
}

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

/**
 * Build the ordered list of quick fixes for a document.
 *
 * Input is the already-filtered diagnostic list so that quick fix generation
 * can't accidentally surface fixes for warnings the rest of the system chose
 * to hide.
 */
export function buildQuickFixes(
  source: string,
  diagnostics: AgentScriptDiagnostic[],
): AgentScriptQuickFix[] {
  const fixes: AgentScriptQuickFix[] = [];

  for (const diagnostic of diagnostics) {
    if (!diagnostic.code) continue;

    switch (diagnostic.code) {
      case "invalid-modifier":
      case "unknown-type": {
        const fix = buildSuggestionFix(source, diagnostic);
        if (fix) fixes.push(fix);
        break;
      }
      case "unknown-dialect": {
        fixes.push(...buildUnknownDialectFixes(source, diagnostic));
        break;
      }
      case "deprecated-field": {
        const fix = buildDeprecatedFieldFix(source, diagnostic);
        if (fix) fixes.push(fix);
        break;
      }
      case "unused-variable": {
        const fix = buildUnusedVariableFix(source, diagnostic);
        if (fix) fixes.push(fix);
        break;
      }
      case "invalid-version": {
        fixes.push(...buildInvalidVersionFixes(source, diagnostic));
        break;
      }
      default:
        // Not all codes have machine-applyable fixes. The diagnostic still gets
        // rendered — the agent just doesn't get a prebuilt TextEdit.
        break;
    }
  }

  return fixes;
}
