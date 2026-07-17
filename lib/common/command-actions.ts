/* SPDX-License-Identifier: Apache-2.0 */
/**
 * One catalog drives every command surface.
 *
 * ADR 0005 ("Standard Pi-Native Command Panels") asks each command-bearing
 * extension to define its action metadata once and reuse it for:
 *
 *   1. The no-args slash-command panel rows (open via openCommandPanel)
 *   2. `getArgumentCompletions()` returned to Pi
 *   3. `/<id> help` text
 *   4. The README command table
 *
 * Today most extensions hand-maintain those four surfaces independently
 * and they drift. This module centralizes the shape so new (and migrating)
 * extensions can declare the catalog in one place and feed it into every
 * surface with helper functions instead of bespoke parallel lists.
 *
 * Adoption is incremental — the existing `CommandPanelAction` type is still
 * exported from `./command-panel.ts`, and `SfPiCommandAction` is structurally
 * a superset, so panels accept both. New code should prefer
 * `SfPiCommandAction`; old code can migrate one extension at a time.
 *
 * Example:
 *
 * ```ts
 * import {
 *   type SfPiCommandAction,
 *   getFirstTokenCompletionsFromActions,
 *   formatHelpFromActions,
 * } from "../../lib/common/command-actions.ts";
 *
 * const ACTIONS: SfPiCommandAction<"status" | "refresh" | "help" | "close">[] = [
 *   { value: "status", label: "Show status", description: "…", group: "Diagnostics" },
 *   { value: "refresh", label: "Refresh", description: "…", group: "Diagnostics" },
 *   { value: "help", label: "Show help", description: "…", group: "Reference" },
 *   { value: "close", label: "Close", description: "Dismiss this panel.", group: "Lifecycle" },
 * ];
 *
 * pi.registerCommand("sf-foo", {
 *   description: "…",
 *   getArgumentCompletions: (prefix) => getFirstTokenCompletionsFromActions(ACTIONS, prefix),
 *   handler: async (args, ctx) => {
 *     if (!args && ctx.hasUI) return openPanel(ctx);
 *     if (args.trim() === "help") {
 *       ctx.ui.notify(formatHelpFromActions(ACTIONS, "sf-foo"), "info");
 *       return;
 *     }
 *     // …
 *   },
 * });
 * ```
 */
import type { CommandPanelAction } from "./command-panel.ts";

/**
 * One row in an extension's action catalog.
 *
 * Compatible with `CommandPanelAction` from ./command-panel.ts so the same
 * objects can be passed straight to `openCommandPanel`. Extra fields are
 * optional and only consumed by the helper functions below.
 */
export interface SfPiCommandAction<T extends string = string> extends CommandPanelAction<T> {
  /**
   * Logical area the action belongs to. Pure UI hint for filters and
   * tooling; the panel itself uses `group` for display.
   */
  section?: "status" | "setup" | "diagnostics" | "tools" | "help" | "lifecycle";
  /**
   * Hidden actions still exist in the catalog (so /help can describe
   * legacy aliases) but are filtered out of the panel and completions.
   */
  hidden?: boolean;
  /**
   * When set, marks the action as needing user confirmation or write
   * permission. Only advisory; gating still happens in the action handler.
   */
  danger?: "none" | "confirm" | "write";
  /**
   * Slash-command aliases accepted by the parser, e.g. "dr" → "doctor".
   * Surfaced in /help and completions when present.
   */
  aliases?: readonly string[];
  /** Append a space after accepting this action so child completions are one Tab away. */
  appendSpace?: boolean;
}

export interface SfPiCompletionOption {
  value: string;
  label?: string;
  description: string;
  /** Append a space after accepting this completion so the next token is ready for Tab. */
  appendSpace?: boolean;
}

export interface SfPiArgumentCompletion {
  value: string;
  label: string;
  description: string;
}

export interface SfPiArgumentCompletionContext {
  tokens: string[];
  tokenIndex: number;
  current: string;
  priorTokens: string[];
}

/**
 * Low-level completion helper. Returns null when no actions match (Pi treats
 * null as "no autocompletion" instead of an empty list).
 *
 * Matches by prefix against `value` and any declared aliases. Most slash
 * commands should use `getFirstTokenCompletionsFromActions()` instead, because
 * Pi replaces the full argument tail when a completion is accepted.
 */
export function getCompletionsFromActions<T extends string>(
  actions: readonly SfPiCommandAction<T>[],
  prefix: string,
  options?: { excludeValues?: readonly T[] },
): SfPiArgumentCompletion[] | null {
  const exclude = new Set<string>(options?.excludeValues ?? []);
  const lower = prefix.trim().toLowerCase();
  const matches: SfPiArgumentCompletion[] = [];

  for (const action of actions) {
    if (action.hidden) continue;
    if (exclude.has(action.value)) continue;
    const candidates = [action.value, ...(action.aliases ?? [])];
    const hit = candidates.find((c) => c.toLowerCase().startsWith(lower));
    if (!hit) continue;
    matches.push({
      value: action.appendSpace ? `${hit} ` : hit,
      label: hit,
      description: action.description,
    });
  }

  return matches.length > 0 ? matches : null;
}

/**
 * Pi replaces the full argument tail after `/command ` when a slash-command
 * completion is accepted. Use this helper for flat command surfaces so typing
 * a second token (for example `/sf-docs status h`) does not replace the whole
 * tail with a top-level completion such as `help`.
 */
export function getFirstTokenCompletionsFromActions<T extends string>(
  actions: readonly SfPiCommandAction<T>[],
  prefix: string,
  options?: { excludeValues?: readonly T[] },
): SfPiArgumentCompletion[] | null {
  const context = parseArgumentCompletionPrefix(prefix);
  if (context.tokenIndex !== 0) return null;
  return getCompletionsFromActions(actions, context.current, options);
}

export function getFirstTokenCompletions(
  options: readonly SfPiCompletionOption[],
  prefix: string,
): SfPiArgumentCompletion[] | null {
  const context = parseArgumentCompletionPrefix(prefix);
  if (context.tokenIndex !== 0) return null;
  return completeArgumentTail(options, context);
}

export function completeArgumentTail(
  options: readonly SfPiCompletionOption[],
  context: SfPiArgumentCompletionContext,
  priorTokens: readonly string[] = context.priorTokens,
): SfPiArgumentCompletion[] | null {
  const lower = context.current.toLowerCase();
  const matches = options
    .filter((option) => option.value.toLowerCase().startsWith(lower))
    .map((option) => {
      const value = [...priorTokens, option.value].join(" ");
      return {
        value: option.appendSpace ? `${value} ` : value,
        label: option.label ?? option.value,
        description: option.description,
      };
    });
  return matches.length > 0 ? matches : null;
}

export function parseArgumentCompletionPrefix(prefix: string): SfPiArgumentCompletionContext {
  const hasTrailingSpace = /\s$/.test(prefix);
  const trimmed = prefix.trim();
  const tokens = trimmed ? trimmed.split(/\s+/) : [];
  const tokenIndex = tokens.length === 0 ? 0 : hasTrailingSpace ? tokens.length : tokens.length - 1;

  return {
    tokens,
    tokenIndex,
    current: hasTrailingSpace ? "" : (tokens[tokenIndex] ?? ""),
    priorTokens: tokens.slice(0, tokenIndex),
  };
}

/**
 * Resolve a typed sub-command string to an action value, accepting
 * aliases. Returns null when nothing matches — callers can then fall
 * back to an "unknown subcommand" message.
 */
export function resolveAction<T extends string>(
  actions: readonly SfPiCommandAction<T>[],
  raw: string,
): T | null {
  const needle = raw.trim().toLowerCase();
  if (needle.length === 0) return null;
  for (const action of actions) {
    if (action.value.toLowerCase() === needle) return action.value;
    if (action.aliases?.some((a) => a.toLowerCase() === needle)) return action.value;
  }
  return null;
}

/**
 * Format a plain-text `/help` block from the catalog. Skips hidden
 * actions and groups by `group` (or `section` when no group is set).
 *
 * The output deliberately stays text-only so the same string works in
 * `ctx.ui.notify`, headless print mode, and an `openInfoPanel` body.
 */
export function formatHelpFromActions<T extends string>(
  actions: readonly SfPiCommandAction<T>[],
  commandName: string,
): string {
  const visible = actions.filter((a) => !a.hidden);
  if (visible.length === 0) return `/${commandName} — no subcommands.`;

  const buckets = new Map<string, SfPiCommandAction<T>[]>();
  for (const action of visible) {
    const key = action.group ?? action.section ?? "Actions";
    const list = buckets.get(key) ?? [];
    list.push(action);
    buckets.set(key, list);
  }

  const lines: string[] = [`/${commandName} subcommands:`];
  for (const [groupName, items] of buckets) {
    lines.push("");
    lines.push(`${groupName}:`);
    for (const action of items) {
      const aliases = action.aliases?.length ? ` (alias: ${action.aliases.join(", ")})` : "";
      lines.push(`  /${commandName} ${action.value}${aliases} — ${action.description}`);
    }
  }
  return lines.join("\n");
}

/**
 * Render a Markdown table suitable for an extension README. Hidden
 * actions are omitted. Useful in the per-extension README "Commands"
 * section so the table never drifts from the catalog.
 */
export function formatReadmeTableFromActions<T extends string>(
  actions: readonly SfPiCommandAction<T>[],
  commandName: string,
): string {
  const visible = actions.filter((a) => !a.hidden);
  const rows = [
    "| Subcommand | Description |",
    "| --- | --- |",
    ...visible.map(
      (action) =>
        // Escape `\` first, then `|`, so a literal backslash in the description
        // can't pair with the inserted `\` from the pipe-escape pass and break
        // the markdown table cell.
        `| \`/${commandName} ${action.value}\` | ${action.description
          .replace(/\\/g, "\\\\")
          .replace(/\|/g, "\\|")} |`,
    ),
  ];
  return rows.join("\n");
}
