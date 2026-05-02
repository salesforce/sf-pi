/* SPDX-License-Identifier: Apache-2.0 */
/**
 * slack_resolve tool — fuzzy Slack entity resolution.
 */
import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import {
  SlackResolveParams,
  type ResolveResult,
  type ResolvedChannel,
  type ResolvedUser,
} from "./types.ts";
import { requireAuth } from "./auth.ts";
import { buildSlackTextResult } from "./truncation.ts";
import { formatResolveResult, resolveChannel, resolveUser } from "./resolve.ts";

interface ResolveToolCallArgs {
  type?: string;
  text?: string;
}

interface ResolveToolRenderResult {
  content?: unknown[];
  details?: {
    ok?: boolean;
    type?: string;
    confidence?: number;
    best?: ResolvedChannel | ResolvedUser;
    candidates?: Array<ResolvedChannel | ResolvedUser>;
  };
}

const AUTO_SELECT_THRESHOLD = 0.85;

/** Module-level guard: only one slack_resolve clarify dialog may be pending
 *  at a time across concurrent tool calls in the same process.
 *
 *  Agent runtimes routinely fan out parallel tool calls (e.g. an onboarding
 *  routine resolving four channel patterns at once). The TUI can only show
 *  one modal, so without this gate the second+ calls block forever on
 *  `await ctx.ui.select` / `ctx.ui.input` behind the first dialog, and
 *  from the user's POV the whole session wedges — indistinguishable from
 *  a network hang (see fix #17). This gate is a pure, in-process Promise
 *  mutex: the first call that reaches the dialog takes the slot, any
 *  concurrent call returns the non-interactive resolver result with a
 *  warning so the agent can decide what to do with the low-confidence
 *  candidates instead of hanging. A single isolated call still gets the
 *  nice HITL UX. */
let clarifyInFlight: Promise<void> | null = null;

/** Test hook: reset the clarify mutex between tests. Not part of the
 *  public API — do not call from extension code. */
export function __resetClarifyGateForTests(): void {
  clarifyInFlight = null;
}

/** Run `fn` under the clarify mutex. If another clarify is already
 *  pending, returns `undefined` immediately so the caller falls back to
 *  the non-interactive path. Exported for tests only. */
export async function __withClarifyGateForTests<T>(fn: () => Promise<T>): Promise<T | undefined> {
  return withClarifyGate(fn);
}

async function withClarifyGate<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (clarifyInFlight) return undefined;
  let release!: () => void;
  clarifyInFlight = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    return await fn();
  } finally {
    release();
    clarifyInFlight = null;
  }
}

function callLabel(label: string, summary: string, theme: Theme): Text {
  return new Text(
    theme.fg("toolTitle", theme.bold(label + " ")) + theme.fg("muted", summary),
    0,
    0,
  );
}

export function registerResolveTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof SlackResolveParams>({
    name: "slack_resolve",
    label: "Slack Resolve",
    description:
      "Resolve fuzzy Slack references into concrete Slack entities. " +
      "Types: channel — resolve channel names/IDs. user — resolve people by name, handle, ID, or email.",
    promptSnippet:
      "Resolve fuzzy Slack channel/user references before Slack research or history calls",
    // Cross-tool routing ("use slack_resolve when you have a fuzzy reference") lives on
    // the `slack` tool. These guidelines describe slack_resolve's own contract.
    promptGuidelines: [
      "slack_resolve returns a best candidate with a confidence score plus alternates. Confidence ≥ 0.85 is auto-select-safe; lower confidence should be treated as ambiguous and may need user clarification.",
      "Pass type:'user' with an email address to hit Slack's email lookup fast-path when you already have an email.",
      "Use the returned `best.id` directly in subsequent slack/slack_channel/slack_user calls — do NOT pass the fuzzy name a second time to other tools.",
    ],
    parameters: SlackResolveParams,

    renderCall(args: ResolveToolCallArgs, theme: Theme) {
      return callLabel("Slack Resolve", `${args.type || "entity"}: ${args.text || "?"}`, theme);
    },

    renderResult(result: ResolveToolRenderResult, _opts, theme: Theme) {
      const details = result.details || {};
      if (!details.ok) {
        return new Text(
          theme.fg("error", "✗ " + (getFirstText(result.content) || "Could not resolve")),
          0,
          0,
        );
      }

      const best = details.best;
      if (!best) return new Text(theme.fg("warning", "No candidates found"), 0, 0);

      const confidence = details.confidence ?? 0;
      const color = confidence >= AUTO_SELECT_THRESHOLD ? "success" : "warning";
      let text = theme.fg(color, `✓ ${details.type || "entity"} ${confidence.toFixed(2)}`);
      text += "  " + theme.fg("accent", formatBest(best));
      const count = details.candidates?.length || 0;
      if (count > 1) text += theme.fg("dim", `  (${count - 1} alternate${count === 2 ? "" : "s"})`);
      return new Text(text, 0, 0);
    },

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const auth = await requireAuth(ctx);
      if ("result" in auth) return auth.result;

      let result: ResolveResult<ResolvedChannel | ResolvedUser>;
      if (params.type === "channel") {
        result = await resolveChannel(auth.token, params.text, signal, { limit: params.limit });
      } else {
        result = await resolveUser(auth.token, params.text, signal, { limit: params.limit });
      }

      if (params.clarify !== false && ctx.hasUI) {
        const shouldClarify =
          !result.ok || (result.confidence < AUTO_SELECT_THRESHOLD && result.candidates.length > 0);
        if (shouldClarify) {
          // Serialize across concurrent resolve calls so parallel fan-out
          // doesn't stack modal dialogs on the TUI (see clarifyInFlight doc).
          const gated = await withClarifyGate(async () => {
            if (
              result.ok &&
              result.confidence < AUTO_SELECT_THRESHOLD &&
              result.candidates.length > 0
            ) {
              const selected = await askUserToChoose(result, ctx.ui.select.bind(ctx.ui));
              if (selected) return withSelectedCandidate(result, selected);
              return result;
            }
            const replacement = await ctx.ui.input(
              `Could not resolve Slack ${params.type} "${params.text}"`,
              "Enter exact name/ID, or leave blank to cancel",
            );
            if (!replacement?.trim()) return result;
            let retried: ResolveResult<ResolvedChannel | ResolvedUser> =
              params.type === "channel"
                ? await resolveChannel(auth.token, replacement.trim(), signal, {
                    limit: params.limit,
                  })
                : await resolveUser(auth.token, replacement.trim(), signal, {
                    limit: params.limit,
                  });
            if (
              retried.ok &&
              retried.confidence < AUTO_SELECT_THRESHOLD &&
              retried.candidates.length > 0
            ) {
              const selected = await askUserToChoose(retried, ctx.ui.select.bind(ctx.ui));
              if (selected) retried = withSelectedCandidate(retried, selected);
            }
            return retried;
          });
          if (gated) {
            result = gated;
          } else {
            // Another clarify dialog is already pending. Rather than block
            // (which wedges the whole session), return the non-interactive
            // resolver result with an explicit warning so the agent can
            // decide: accept the low-confidence match, retry serially, or
            // ask the user directly.
            result = {
              ...result,
              warnings: [
                ...result.warnings,
                "Another slack_resolve clarify dialog was already pending; returned non-interactive result to avoid stacking modals. Re-invoke serially if you need interactive selection.",
              ],
            };
          }
        }
      }

      return buildSlackTextResult(
        formatResolveResult(result),
        {
          ok: result.ok,
          action: "resolve",
          type: result.type,
          input: result.input,
          confidence: result.confidence,
          best: result.best,
          candidates: result.candidates,
          strategy: result.strategy,
          warnings: result.warnings,
        },
        { prefix: "pi-slack-resolve" },
      );
    },
  });
}

function withSelectedCandidate<T extends ResolvedChannel | ResolvedUser>(
  result: ResolveResult<T>,
  selected: T,
): ResolveResult<T> {
  return {
    ...result,
    best: selected,
    candidates: [selected, ...result.candidates.filter((candidate) => candidate !== selected)],
    confidence: 1,
    warnings: [
      ...result.warnings.filter((warning) => !warning.includes("below auto-select")),
      "User selected this candidate interactively.",
    ],
  };
}

async function askUserToChoose<T extends ResolvedChannel | ResolvedUser>(
  result: ResolveResult<T>,
  select: (title: string, options: string[]) => Promise<string | undefined>,
): Promise<T | undefined> {
  const options = result.candidates.map(
    (candidate, index) =>
      `${index + 1}. ${formatBest(candidate)} (${candidate.confidence.toFixed(2)})`,
  );
  const choice = await select(`Pick Slack ${result.type} for "${result.input}"`, options);
  if (!choice) return undefined;
  const index = Number(choice.match(/^(\d+)\./)?.[1] || "0") - 1;
  return result.candidates[index];
}

function formatBest(candidate: ResolvedChannel | ResolvedUser): string {
  if ("name" in candidate) return `#${candidate.name} (${candidate.id})`;
  return `${candidate.displayName || candidate.realName || candidate.handle} (${candidate.id})`;
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}
