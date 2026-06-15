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
import { type TokenizedCommand, tokenizeSimpleCommands } from "./bash-ast.ts";
import { resolveRuleBehavior } from "./rule-behavior.ts";
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

  const simpleCommands = tokenizeSimpleCommands(command);
  const commands = expandCommands(simpleCommands.map((item) => item.tokens));
  const headAndArgs = commands.flatMap((tokens) => [tokens.head, ...tokens.args]);

  // Allowed patterns: any match → no gate.
  const allowed = findMatch(
    command,
    gate.allowedPatterns,
    simpleCommands.map((item) => item.tokens),
    commands,
    headAndArgs,
  );
  if (allowed) return { action: "allow", matched: allowed };

  // Auto-deny: any match → block without prompting.
  const autodeny = findMatch(
    command,
    gate.autoDenyPatterns,
    simpleCommands.map((item) => item.tokens),
    commands,
    headAndArgs,
  );
  if (autodeny) return { action: "autodeny", matched: autodeny };

  // Dangerous patterns: any match → confirm.
  const matched = findMatch(
    command,
    gate.patterns,
    simpleCommands.map((item) => item.tokens),
    commands,
    headAndArgs,
  );
  if (matched) return { action: "confirm", matched };

  return undefined;
}

function findMatch(
  command: string,
  patterns: CommandPattern[],
  simpleCommands: TokenizedCommand[],
  commands: TokenizedCommand[],
  headAndArgs: string[],
): CommandPattern | undefined {
  if (patterns.length === 0) return undefined;

  for (const p of patterns) {
    if (resolveRuleBehavior(p) === "off") continue;
    if (patternMatches(command, simpleCommands, commands, headAndArgs, p.pattern)) return p;
  }
  return undefined;
}

function patternMatches(
  command: string,
  simpleCommands: TokenizedCommand[],
  commands: TokenizedCommand[],
  tokens: string[],
  pattern: string,
): boolean {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return false;

  if (trimmed === "dd of=") {
    return commands.some(
      (item) => item.head === "dd" && item.args.some((token) => token.startsWith("of=")),
    );
  }
  if (trimmed === "mkfs.*") {
    return tokens.some((token) => token === "mkfs" || token.startsWith("mkfs."));
  }
  if (trimmed === "remote-script-to-shell") {
    return hasPipeToShell(simpleCommands, new Set(["curl", "wget"]));
  }
  if (trimmed === "base64-decode-to-shell") {
    return hasBase64DecodeToShell(simpleCommands);
  }
  if (trimmed === "find -delete") {
    return commands.some((item) => item.head === "find" && item.args.includes("-delete"));
  }
  if (trimmed === "find -exec rm") {
    return commands.some(
      (item) =>
        item.head === "find" &&
        item.args.includes("-exec") &&
        item.args.some((arg, index) => arg === "rm" && index > item.args.indexOf("-exec")),
    );
  }

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

const SHELL_HEADS = new Set(["bash", "sh", "zsh"]);
const WRAPPER_HEADS = new Set(["sudo", "env", "timeout", "nohup", "nice", "time", "watch"]);

function expandCommands(commands: TokenizedCommand[], depth = 0): TokenizedCommand[] {
  if (depth > 3) return commands;
  const out: TokenizedCommand[] = [];
  for (const command of commands) {
    out.push(command);
    for (const nested of nestedCommands(command)) {
      out.push(...expandCommands([nested], depth + 1));
    }
  }
  return out;
}

function nestedCommands(command: TokenizedCommand): TokenizedCommand[] {
  if (SHELL_HEADS.has(command.head)) {
    const index = command.args.indexOf("-c");
    const nested = index >= 0 ? command.args[index + 1] : undefined;
    return nested ? tokenizeSimpleCommands(nested).map((item) => item.tokens) : [];
  }

  if (command.head === "xargs") {
    const index = command.args.findIndex((arg) => !arg.startsWith("-"));
    if (index >= 0)
      return [{ head: basename(command.args[index] ?? ""), args: command.args.slice(index + 1) }];
  }

  if (WRAPPER_HEADS.has(command.head)) {
    const index = command.args.findIndex((arg) => !arg.startsWith("-") && !arg.includes("="));
    if (index >= 0)
      return [{ head: basename(command.args[index] ?? ""), args: command.args.slice(index + 1) }];
  }

  return [];
}

function hasPipeToShell(commands: TokenizedCommand[], downloaders: Set<string>): boolean {
  for (let i = 0; i < commands.length - 1; i++) {
    const left = commands[i];
    const right = commands[i + 1];
    if (left && right && downloaders.has(left.head) && SHELL_HEADS.has(right.head)) return true;
  }
  return false;
}

function hasBase64DecodeToShell(commands: TokenizedCommand[]): boolean {
  for (let i = 0; i < commands.length - 1; i++) {
    const left = commands[i];
    const right = commands[i + 1];
    if (!left || !right || left.head !== "base64" || !SHELL_HEADS.has(right.head)) continue;
    if (left.args.includes("-d") || left.args.includes("--decode")) return true;
  }
  return false;
}

function basename(value: string): string {
  const idx = value.lastIndexOf("/");
  return idx >= 0 ? value.slice(idx + 1) : value;
}
