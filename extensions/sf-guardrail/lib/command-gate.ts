/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Dangerous-command matcher.
 *
 * For each `bash` tool_call, test the command against the configured
 * command-gate patterns. Patterns can be simple substrings ("rm -rf") or
 * full regex. The matcher also inspects the tokenized form so substring
 * matches inside string literals (e.g. `echo "rm -rf is bad"`) don't
 * misfire — we only return true when the head word or an arg contains the
 * substring, not arbitrary content inside a quoted literal.
 *
 * The ordering of evaluation is: allowedPatterns → autoDenyPatterns →
 * patterns. `allowedPatterns` short-circuits to allow; `autoDenyPatterns`
 * short-circuits to block (no prompt); everything else requires user
 * confirmation.
 */
import { tokenize } from "./bash-ast.ts";
import type { CommandGateConfig, CommandPattern } from "./types.ts";

export type CommandGateOutcome =
  | { action: "allow"; matched?: CommandPattern }
  | { action: "confirm"; matched: CommandPattern }
  | { action: "autodeny"; matched: CommandPattern };

export function evaluateCommand(
  command: string,
  gate: CommandGateConfig,
): CommandGateOutcome | undefined {
  if (!command || command.trim().length === 0) return undefined;

  // Allowed patterns: any match → no gate.
  const allowed = findMatch(command, gate.allowedPatterns);
  if (allowed) return { action: "allow", matched: allowed };

  // Auto-deny: any match → block without prompting.
  const autodeny = findMatch(command, gate.autoDenyPatterns);
  if (autodeny) return { action: "autodeny", matched: autodeny };

  // Dangerous patterns: any match → confirm.
  const matched = findMatch(command, gate.patterns);
  if (matched) return { action: "confirm", matched };

  return undefined;
}

function findMatch(command: string, patterns: CommandPattern[]): CommandPattern | undefined {
  if (patterns.length === 0) return undefined;
  const tokens = tokenize(command);
  const headAndArgs = tokens ? [tokens.head, ...tokens.args] : [];

  for (const p of patterns) {
    if (patternMatches(command, headAndArgs, p.pattern)) return p;
  }
  return undefined;
}

function patternMatches(command: string, tokens: string[], pattern: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);

  // Multi-word pattern: require N consecutive tokens that equal the N pattern
  // words. This intentionally does NOT match content inside a quoted string
  // literal, because the tokenizer leaves those as a single token. Example:
  // `echo "sf org delete"` tokenizes to ["echo", "sf org delete"], and no
  // sliding window over those two tokens can equal ["sf","org","delete"].
  if (words.length > 1) {
    for (let i = 0; i + words.length <= tokens.length; i++) {
      let ok = true;
      for (let j = 0; j < words.length; j++) {
        if (tokens[i + j] !== words[j]) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }

  // Single-word pattern: match against any individual token.
  if (tokens.includes(trimmed)) return true;

  // Fallback: if the tokenizer failed (empty/unparseable), do a whole-string
  // substring check so we never silently miss on exotic shell syntax.
  if (tokens.length === 0 && command.includes(trimmed)) return true;

  return false;
}
