/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Minimal shell-command tokenizer + structural matcher.
 *
 * Why hand-rolled instead of a package:
 *   We only need three things from the bash input:
 *     1. head word          → "sf"
 *     2. positional args    → ["project", "deploy", "start"]
 *     3. flag values        → { "-o": "Prod", "--method": "DELETE" }
 *   `shell-parse` is abandoned (deps published 2012). `shell-quote` is the
 *   maintained equivalent but its API shape doesn't fit ours any better than
 *   60 lines of tokenizer. Zero runtime deps is strictly nicer for a safety
 *   extension that runs on every tool_call.
 *
 * What we do NOT attempt to model:
 *   - pipelines / `&&` / `;`    — we tokenize the first simple command only.
 *     Since our rules target well-known sf/git/rm invocations, the common
 *     false-negative (`cd foo && sf project deploy`) only lets a rule skip;
 *     it does not make us match the wrong rule. classify.ts tests against
 *     the full command string via fallback regex for the command-gate path,
 *     which catches the `&&`-chained case.
 *   - shell expansions (backticks, $(...), variable substitution)
 *   - heredocs
 *
 * Matching semantics are documented on ShellAstMatch in types.ts.
 */
import type { ShellAstMatch } from "./types.ts";

export interface TokenizedCommand {
  /** The first non-empty token, stripped of its path (`/usr/bin/sf` → `sf`). */
  head: string;
  /** Every token after the head, in order, including flags. */
  args: string[];
}

/**
 * Tokenize a POSIX-style simple command into space-separated words, respecting
 * single quotes, double quotes, and backslash escapes. Everything before the
 * first `&&`, `||`, `;`, or `|` is kept; the rest is ignored.
 *
 * Returns `undefined` when the input has no head word (empty or whitespace).
 */
export function tokenize(command: string): TokenizedCommand | undefined {
  const source = command.trim();
  if (source.length === 0) return undefined;

  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let i = 0;

  const push = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  };

  while (i < source.length) {
    const ch = source[i];

    if (quote) {
      if (ch === "\\" && quote === '"' && i + 1 < source.length) {
        current += source[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      i += 1;
      continue;
    }

    if (ch === "\\" && i + 1 < source.length) {
      current += source[i + 1];
      i += 2;
      continue;
    }

    // Split/terminators: treat ;, &&, ||, | as end-of-simple-command.
    if (ch === ";" || ch === "|") {
      push();
      break;
    }
    if (ch === "&" && source[i + 1] === "&") {
      push();
      break;
    }

    if (ch === " " || ch === "\t" || ch === "\n") {
      push();
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }
  push();

  if (tokens.length === 0) return undefined;
  const headRaw = tokens.shift();
  if (!headRaw) return undefined;
  return { head: basename(headRaw), args: tokens };
}

function basename(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/**
 * Walk the non-flag positional args of the tokenized command in order, and
 * test them against the matcher's `subCmd`. Each matcher entry is either a
 * literal ("project") or an array of alternatives (["delete","update"]).
 *
 * Flags and their values are skipped during the walk so a rule like
 * `["apex","run"]` still matches `sf --json apex run -f script.apex`.
 */
export function matches(tokens: TokenizedCommand, spec: ShellAstMatch): boolean {
  if (tokens.head !== spec.cmd) return false;

  if (spec.subCmd && spec.subCmd.length > 0) {
    const positionals = extractPositionals(tokens.args);
    if (positionals.length < spec.subCmd.length) return false;
    for (let i = 0; i < spec.subCmd.length; i++) {
      const expected = spec.subCmd[i];
      const actual = positionals[i];
      if (Array.isArray(expected)) {
        if (!expected.includes(actual)) return false;
      } else if (expected !== actual) {
        return false;
      }
    }
  }

  if (spec.flagIn) {
    const flags = extractFlags(tokens.args);
    for (const [flagName, allowed] of Object.entries(spec.flagIn)) {
      const value = flags.get(flagName);
      if (value === undefined) return false;
      if (!allowed.includes(value)) return false;
    }
  }

  return true;
}

/**
 * Return every non-flag token in order.
 *
 * We deliberately do NOT try to distinguish "boolean flag" from "value-taking
 * flag" because that would require a per-command schema. Instead we rely on
 * the fact that every sf/git invocation we care about places its subcommand
 * chain (`project deploy start`, `apex run`, `org api`) before any flag. So
 * "drop tokens starting with `-`" leaves the subcommand chain plus the tail
 * of positional values (file paths, URLs, aliases); the matcher only checks
 * the first N positions of `subCmd`, so trailing values are harmless.
 *
 * This sidesteps the `--json apex run` footgun where a positional walker that
 * assumes `--json` takes a value would consume `apex` and miss the match.
 */
function extractPositionals(args: string[]): string[] {
  const out: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    out.push(arg);
  }
  return out;
}

/**
 * Return a map of flag name → string value for every `--flag value`,
 * `--flag=value`, `-o value` pair found. Boolean flags map to the literal
 * string `""`.
 *
 * The map key is the full flag token as it appeared on the command
 * line (`--method` / `-o`). Callers decide whether to match short vs long.
 */
function extractFlags(args: string[]): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq >= 0) {
        out.set(arg.slice(0, eq), arg.slice(eq + 1));
      } else {
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          out.set(arg, next);
          i += 2;
          continue;
        }
        out.set(arg, "");
      }
      i += 1;
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        out.set(arg, next);
        i += 2;
        continue;
      }
      out.set(arg, "");
      i += 1;
      continue;
    }
    i += 1;
  }
  return out;
}

// ─── Target-org extraction (Salesforce-specific helper) ─────────────────────────

/**
 * Parse the target-org alias from a tokenized sf command. Recognizes both
 * `-o <alias>` and `--target-org <alias>` (and the `--target-org=<alias>`
 * shorthand). Returns `undefined` when the flag is absent so callers can
 * fall back to the default-org alias from the env cache.
 */
export function extractTargetOrg(tokens: TokenizedCommand): string | undefined {
  const flags = extractFlags(tokens.args);
  return flags.get("-o") || flags.get("--target-org") || undefined;
}
