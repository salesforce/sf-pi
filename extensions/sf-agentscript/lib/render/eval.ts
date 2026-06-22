/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Eval run + get_failure renderer.
 *
 * `agentscript_eval run` produces:
 *   - run header: ✅/❌ totals, latency badges
 *   - latency histogram (ASCII bar chart)
 *   - per-test rows (✅/❌ + evaluator counts)
 *   - failed-test cards inline (when ≤ inline_threshold)
 *
 * `agentscript_eval get_failure` produces a single failure card with the
 * failed evaluators + per-turn waterfall (reusing the timeline renderer's
 * step-row formatting via `digest.timeline`).
 */

import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { clipLine, fmtMs, padRightVisible, rowDetail, styleForStep, stepLabel } from "./shared.ts";
import type { TraceDigest } from "../preview/trace-digest.ts";

interface FailureRecord {
  test_id: string;
  failed_evaluators: Array<{
    id?: string;
    score?: number | null;
    expected_value?: string;
    actual_value?: string;
    explainability?: string;
  }>;
  step_errors: Array<{ id?: string; error_message?: string }>;
  turns: Array<{
    turn_id: string;
    utterance?: string;
    agent_response?: string;
    topic?: string;
    invoked_actions?: string[];
    latency_ms?: number;
    plan_id?: string;
    state_variables?: Record<string, unknown>;
    digest?: TraceDigest;
  }>;
  trace_files?: string[];
}

interface RunTotals {
  tests: number;
  test_pass: number;
  test_fail: number;
  evals: number;
  ev_pass: number;
  ev_fail: number;
  errors: number;
}

interface LatencySummary {
  count: number;
  min_ms?: number;
  p50_ms?: number;
  p95_ms?: number;
  p99_ms?: number;
  max_ms?: number;
}

export interface EvalRunDetails {
  ok?: boolean;
  run_id?: string;
  run_dir?: string;
  totals?: RunTotals;
  latency?: LatencySummary;
  failed_test_ids?: string[];
  // The text payload (which the LLM consumes) embeds the failure JSON when
  // small. The renderer parses that for inline failure cards.
}

export interface EvalGetFailureDetails {
  ok?: boolean;
  run_id?: string;
  failure?: FailureRecord;
  failures?: FailureRecord[];
  total_failures?: number;
}

interface EvalArgs {
  action?: string;
  spec_path?: string;
  agent_api_name?: string;
  test_id?: string;
  run_id?: string;
}

// ─── renderCall ───────────────────────────────────────────────────────────────

export function renderEvalCall(args: EvalArgs, theme: Theme): Text {
  const label = theme.fg("toolTitle", theme.bold("🧪 Agent Script eval "));
  const action = args.action ?? "run";
  let summary: string;
  switch (action) {
    case "run":
      summary = `run · ${args.spec_path ?? "(inline spec)"}`;
      if (args.agent_api_name) summary += ` · ${args.agent_api_name}`;
      break;
    case "get_failure":
      summary = `get_failure · ${args.run_id ?? "?"}${args.test_id ? ` · ${args.test_id}` : ""}`;
      break;
    case "trace":
      summary = `trace`;
      break;
    case "resolve_active":
      summary = `resolve_active · ${args.agent_api_name ?? "?"}`;
      break;
    default:
      summary = action;
  }
  return new Text(label + theme.fg("muted", summary), 0, 0);
}

// ─── renderResult ─────────────────────────────────────────────────────────────

export function renderEvalRunResult(
  result: { details?: EvalRunDetails | unknown; content?: unknown[] },
  opts: { isPartial?: boolean; expanded?: boolean },
  theme: Theme,
): Text {
  if (opts.isPartial) {
    return new Text(
      theme.fg("warning", getFirstText(result.content) || "🧪 eval · running…"),
      0,
      0,
    );
  }
  const details = (result.details ?? {}) as EvalRunDetails;
  if (!details.run_id) {
    return new Text(
      theme.fg("error", `✗ ${getFirstText(result.content) || "eval run failed"}`),
      0,
      0,
    );
  }
  // The inline failures live in the LLM `content[0].text` JSON blob; reparse
  // it (cheap, single string) so the human can see the per-test rows.
  const inlineFailures = parseInlineFailures(result.content);
  return new Text(formatRunBody(details, inlineFailures, theme, /*ansi=*/ true), 0, 0);
}

export function renderEvalGetFailureResult(
  result: { details?: EvalGetFailureDetails | unknown; content?: unknown[] },
  opts: { isPartial?: boolean; expanded?: boolean },
  theme: Theme,
): Text {
  if (opts.isPartial) return new Text(theme.fg("warning", "🧪 eval get_failure · running…"), 0, 0);
  const details = (result.details ?? {}) as EvalGetFailureDetails;
  if (details.failure) {
    return new Text(formatFailureCard(details.failure, theme, /*ansi=*/ true), 0, 0);
  }
  if (details.failures && details.failures.length > 0) {
    const lines = details.failures.map((f) => formatFailureCard(f, theme, true)).join("\n\n");
    return new Text(lines, 0, 0);
  }
  return new Text(theme.fg("success", `✓ run ${details.run_id ?? "?"} has no failures`), 0, 0);
}

// ─── Markdown emitters ────────────────────────────────────────────────────────

export function evalRunMarkdown(details: EvalRunDetails, inlineFailures: FailureRecord[]): string {
  return formatRunBody(details, inlineFailures, undefined, /*ansi=*/ false);
}

export function evalFailureMarkdown(failure: FailureRecord): string {
  return formatFailureCard(failure, undefined, /*ansi=*/ false);
}

// ─── Shared body formatters ───────────────────────────────────────────────────

function formatRunBody(
  details: EvalRunDetails,
  inlineFailures: FailureRecord[],
  theme: Theme | undefined,
  ansi: boolean,
): string {
  const fg = (token: Parameters<Theme["fg"]>[0], s: string): string =>
    theme ? theme.fg(token, s) : s;
  const bold = (s: string): string => (theme ? theme.bold(s) : `**${s}**`);
  const dim = (s: string): string => fg("dim", s);
  const ok = (s: string): string => fg("success", s);
  const err = (s: string): string => fg("error", s);
  const accent = (s: string): string => fg("accent", s);
  const code = (s: string): string => fg("mdCode", s);

  const totals = details.totals ?? {
    tests: 0,
    test_pass: 0,
    test_fail: 0,
    evals: 0,
    ev_pass: 0,
    ev_fail: 0,
    errors: 0,
  };
  const passed = totals.test_fail === 0 && totals.errors === 0;
  const lat = details.latency ?? { count: 0 };

  const lines: string[] = [];
  // Header
  const head = [
    passed ? ok("🧪 ✅ all tests passing") : err("🧪 ❌ failures detected"),
    code(`run ${details.run_id ?? "?"}`),
  ];
  lines.push(head.join("  "));

  // Totals badges
  const badges = [
    `${ok(`✅ ${totals.test_pass}/${totals.tests} tests`)}`,
    `${ok(`✅ ${totals.ev_pass}/${totals.evals} evaluators`)}`,
    totals.test_fail > 0
      ? err(`⚠ ${totals.test_fail} test fail${totals.test_fail === 1 ? "" : "s"}`)
      : null,
    totals.errors > 0
      ? err(`⚠ ${totals.errors} step error${totals.errors === 1 ? "" : "s"}`)
      : null,
  ].filter(Boolean) as string[];
  lines.push("  " + badges.join("  "));

  // Latency histogram
  if (lat.count > 0) {
    lines.push("");
    lines.push(dim(ansi ? "─── Latency (per turn, ms) ───" : "**Latency (per turn, ms)**"));
    const max = lat.max_ms ?? lat.p99_ms ?? 1;
    const rows: Array<[string, number | undefined]> = [
      ["p50", lat.p50_ms],
      ["p95", lat.p95_ms],
      ["p99", lat.p99_ms],
      ["max", lat.max_ms],
    ];
    for (const [name, val] of rows) {
      if (val === undefined) continue;
      const w = 40;
      const filled = Math.max(0, Math.min(w, Math.round((val / max) * w)));
      const bar = ok("█".repeat(filled)) + dim("░".repeat(w - filled));
      lines.push(`  ${dim(padRightVisible(name, 4))} ${bar}  ${bold(String(val))}`);
    }
  }

  // Per-test rows (build from totals + failed_test_ids; we don't have a
  // per-test list in details, so we render inlineFailures as the failures
  // and assume the rest passed).
  if (totals.tests > 0) {
    lines.push("");
    lines.push(dim(ansi ? "─── Tests ───" : "**Tests**"));
    const failedIds = new Set(details.failed_test_ids ?? inlineFailures.map((f) => f.test_id));
    const passCount = totals.tests - failedIds.size;
    if (passCount > 0) {
      lines.push(`  ${ok("✅")} ${dim(`${passCount} passing test${passCount === 1 ? "" : "s"}`)}`);
    }
    for (const id of failedIds) {
      const f = inlineFailures.find((r) => r.test_id === id);
      if (f) {
        const evFail = f.failed_evaluators.length;
        const evTotal = evFail; // We only know failed evaluators here
        lines.push(
          `  ${err("❌")} ${bold(id)}  ${err(`${evFail} failed evaluator${evFail === 1 ? "" : "s"}`)}${
            f.turns.length > 0
              ? dim(`  · ${f.turns.length} turn${f.turns.length === 1 ? "" : "s"}`)
              : ""
          }`,
        );
        // Inline a tiny preview when expanded view isn't available — just
        // the first failed evaluator's score.
        if (f.failed_evaluators[0]?.id) {
          const first = f.failed_evaluators[0];
          lines.push(
            dim(
              `       ▌ ${first.id} score=${first.score ?? "?"}${
                first.explainability ? ` · ${clipLine(first.explainability, 60)}` : ""
              }`,
            ),
          );
        }
        void evTotal;
      } else {
        lines.push(`  ${err("❌")} ${bold(id)}`);
      }
    }
  }

  // Drill-down hint
  if (totals.test_fail > 0) {
    lines.push("");
    lines.push(
      `${accent("💡 Drill:")} ${code(`agentscript_eval get_failure run_id=${details.run_id} test_id=<id>`)}`,
    );
  }

  void ansi;
  return lines.join("\n");
}

function formatFailureCard(
  failure: FailureRecord,
  theme: Theme | undefined,
  _ansi: boolean,
): string {
  const fg = (token: Parameters<Theme["fg"]>[0], s: string): string =>
    theme ? theme.fg(token, s) : s;
  const bold = (s: string): string => (theme ? theme.bold(s) : `**${s}**`);
  const dim = (s: string): string => fg("dim", s);
  const ok = (s: string): string => fg("success", s);
  const err = (s: string): string => fg("error", s);
  const accent = (s: string): string => fg("accent", s);
  const code = (s: string): string => fg("mdCode", s);

  const lines: string[] = [];
  lines.push(err(bold(`❌ ${failure.test_id}`)));

  // Failed evaluators
  if (failure.failed_evaluators.length > 0) {
    lines.push("");
    lines.push(bold("Failed evaluators"));
    for (const ev of failure.failed_evaluators) {
      const score = typeof ev.score === "number" ? err(`score=${ev.score.toFixed(2)}`) : "";
      const expected = ev.expected_value
        ? `expected ${code(JSON.stringify(ev.expected_value))}`
        : "";
      const actual = ev.actual_value ? `got ${code(JSON.stringify(ev.actual_value))}` : "";
      const expl = ev.explainability ? dim(`— ${clipLine(ev.explainability, 90)}`) : "";
      const tail = [expected, actual, expl].filter(Boolean).join(" · ");
      lines.push(`  ${err("▌")} ${code(ev.id ?? "?")}  ${score}  ${tail}`);
    }
  }

  // Step errors
  if (failure.step_errors.length > 0) {
    lines.push("");
    lines.push(bold("Step errors"));
    for (const e of failure.step_errors) {
      lines.push(
        `  ${err("⚠")} ${dim(`[${e.id ?? "?"}]`)} ${clipLine(e.error_message ?? "", 200)}`,
      );
    }
  }

  // Per-turn cards
  for (const t of failure.turns) {
    lines.push("");
    const planTag = t.plan_id ? code(t.plan_id.slice(0, 8) + "…") : "";
    const lat = t.latency_ms !== undefined ? dim(fmtMs(t.latency_ms)) : "";
    const topic = t.topic ? dim(`topic=${code(t.topic)}`) : "";
    const head = [bold(`Turn ${t.turn_id}`), planTag ? `plan=${planTag}` : "", lat, topic].filter(
      Boolean,
    );
    lines.push(dim(`─── `) + head.join(dim(" · ")) + dim(` ───`));
    if (t.utterance) {
      lines.push(`  ${accent("👤")} ${dim(`"${clipLine(t.utterance, 120)}"`)}`);
    }
    if (t.agent_response) {
      lines.push(`  ${ok("🤖")} ${clipLine(t.agent_response, 200)}`);
    }
    // Mini timeline strip — reuse the digest.timeline rows from the eval
    // digest. Since the eval API doesn't expose a fine-grained timeline,
    // this typically renders as: ▶ → 🧠 → 💬
    if (t.digest?.timeline?.length) {
      const strip = t.digest.timeline
        .map((r) => {
          const style = styleForStep(r.t);
          return `${fg(style.color, style.glyph)} ${dim(stepLabel(r.t))}`;
        })
        .join(dim(" → "));
      lines.push("  " + strip);
    }
    // State variables (only the ones that look interesting)
    if (t.state_variables && Object.keys(t.state_variables).length > 0) {
      const kvs = Object.entries(t.state_variables)
        .map(([k, v]) => `${code(k)}: ${dim(String(v))}`)
        .join(", ");
      lines.push(`  ${dim("vars:")} { ${kvs} }`);
    }
  }

  // Trace pointers
  if (failure.trace_files && failure.trace_files.length > 0) {
    lines.push("");
    lines.push(dim(`📄 traces: ${failure.trace_files.join(" · ")}`));
  }

  return lines.join("\n");
}

function parseInlineFailures(content: unknown[] | undefined): FailureRecord[] {
  const text = getFirstText(content);
  if (!text) return [];
  // Run text shape: "<headline>\n\n<JSON blob>". Find the first '{' and parse.
  const idx = text.indexOf("{");
  if (idx === -1) return [];
  try {
    const parsed = JSON.parse(text.slice(idx));
    if (parsed && Array.isArray(parsed.failures)) {
      return parsed.failures as FailureRecord[];
    }
  } catch {
    /* not parseable — fall back to no inline failures */
  }
  return [];
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

// Re-export rowDetail so external slash commands building their own
// failure renderer don't duplicate the per-step formatter.
export { rowDetail };
