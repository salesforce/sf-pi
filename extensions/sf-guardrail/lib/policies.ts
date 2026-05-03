/* SPDX-License-Identifier: Apache-2.0 */
/**
 * File-path policy matcher.
 *
 * Evaluates a path against every enabled rule in the config and returns the
 * strongest applicable protection (`noAccess > readOnly > none`). Also answers
 * which tools a protection level blocks, so the tool_call handler can emit a
 * rule-appropriate decision.
 *
 * Glob semantics (matches @aliou and other tools):
 *   - Patterns containing `/` match against the full relative/normalized path.
 *   - Patterns without `/` match against the basename of the path.
 *   - `*` matches any characters except `/`.
 *   - `**` matches any characters including `/`.
 *   - Leading `~/` expands to the user's home directory before matching.
 *
 * Regex mode: set `regex: true` on a pattern to use anchored JavaScript regex
 * (`^pattern$` is applied implicitly). Errors in the regex cause the pattern
 * to be skipped silently — misconfiguration should never crash the hook.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { PolicyPattern, PolicyRule, ProtectionLevel } from "./types.ts";

// ─── Public match API ───────────────────────────────────────────────────────────

export interface PolicyMatch {
  rule: PolicyRule;
  /** The concrete pattern that matched; used for human-readable logs. */
  pattern: PolicyPattern;
}

/**
 * Find the strongest-protection rule that applies to `targetPath`.
 *
 * `cwd` is used to resolve relative paths to an absolute path before matching,
 * which lets rules like `**\/destructiveChanges*.xml` work regardless of whether
 * the agent passed a relative or absolute path to write/edit.
 */
export function matchPath(
  targetPath: string,
  cwd: string,
  rules: PolicyRule[],
): PolicyMatch | undefined {
  if (!targetPath) return undefined;

  const abs = path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);
  const rel = path.relative(cwd, abs);
  const basename = path.basename(abs);

  let best: PolicyMatch | undefined;

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (rule.onlyIfExists && !existsSync(abs)) continue;

    // Skip this rule if any `allowedPatterns` entry matches first.
    if (
      rule.allowedPatterns?.some((p) =>
        patternMatches(p, { absolute: abs, relative: rel, basename }),
      )
    ) {
      continue;
    }

    const matched = rule.patterns.find((p) =>
      patternMatches(p, { absolute: abs, relative: rel, basename }),
    );
    if (!matched) continue;

    const candidate: PolicyMatch = { rule, pattern: matched };
    if (!best || strongerThan(rule.protection, best.rule.protection)) {
      best = candidate;
    }
  }
  return best;
}

/** Protection-level ordering (strongest first). */
const RANK: Record<ProtectionLevel, number> = { noAccess: 2, readOnly: 1, none: 0 };

function strongerThan(a: ProtectionLevel, b: ProtectionLevel): boolean {
  return RANK[a] > RANK[b];
}

/** Return the list of tool names that are blocked at a given protection level. */
export function blockedTools(level: ProtectionLevel): string[] {
  switch (level) {
    case "noAccess":
      return ["read", "write", "edit", "bash", "grep", "find", "ls"];
    case "readOnly":
      return ["write", "edit"];
    default:
      return [];
  }
}

// ─── Pattern matching ───────────────────────────────────────────────────────────

interface PathVariants {
  absolute: string;
  relative: string;
  basename: string;
}

function patternMatches(pattern: PolicyPattern, variants: PathVariants): boolean {
  const expanded = expandHome(pattern.pattern);
  if (pattern.regex) {
    try {
      const re = new RegExp(expanded);
      return re.test(variants.absolute) || re.test(variants.relative) || re.test(variants.basename);
    } catch {
      return false;
    }
  }

  const matchFull = expanded.includes("/");
  const regex = globToRegExp(expanded);

  if (matchFull) {
    // Anchored full-path match against either the absolute or relative form.
    return regex.test(variants.absolute) || regex.test(variants.relative);
  }
  return regex.test(variants.basename);
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}

/**
 * Convert a glob pattern to an anchored RegExp. Implementation is intentionally
 * small — we do not need brace expansion or character classes for the rule set
 * we ship. Patterns that exercise unsupported syntax should use `regex: true`.
 */
export function globToRegExp(pattern: string): RegExp {
  let out = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` (zero or more segments) or trailing `**` (anything)
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
          continue;
        }
        out += ".*";
        i += 2;
        continue;
      }
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if (ch === ".") {
      out += "\\.";
      i += 1;
      continue;
    }
    if (/[+^$()|{}[\]\\]/.test(ch)) {
      out += "\\" + ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  out += "$";
  return new RegExp(out);
}
