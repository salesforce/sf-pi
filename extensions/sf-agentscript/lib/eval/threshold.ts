/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Evaluator post-processing.
 *
 * Two custom semantics ported from the a prior Python harness:
 *
 * 1. `_thrNN` id encoding for `evaluator.text_quality` and
 *    `evaluator.text_alignment`:
 *      - These evaluators return `is_pass: null` plus a 0..1 `score`.
 *      - We encode the threshold in the evaluator id (e.g. `..._thr40` ⇒ 0.40).
 *      - This pass folds the threshold into a concrete `is_pass` so all
 *        downstream aggregation logic is uniform.
 *      - When no `_thrNN` is encoded: text_quality defaults to 0.80,
 *        text_alignment defaults to 0.30 (matches the original harness).
 *
 * 2. `__optN` OR-group collapse:
 *      - Multiple evaluators with ids `<base>__opt0`, `<base>__opt1`, …
 *        collapse into one synthetic group evaluator named `<base>` that
 *        passes iff any member passed.
 *      - Used for "any-of" assertions where the agent could legitimately
 *        say one of several phrasings.
 *
 * Both passes preserve the original evaluator's id, type, and explainability
 * for debugging.
 */

import type { EvalResult } from "./types.ts";

const SCORING_TYPES = new Set(["evaluator.text_quality", "evaluator.text_alignment"]);

const DEFAULT_THRESHOLDS: Record<string, number> = {
  "evaluator.text_quality": 0.8,
  "evaluator.text_alignment": 0.3,
};

const THR_RE = /_thr(\d+)$/;
const OPT_RE = /^(.+)__opt\d+$/;

export function applyScoreThreshold(ev: EvalResult): EvalResult {
  if (ev.is_pass !== null && ev.is_pass !== undefined) return ev;

  const etype = ev.type ?? "";
  if (!SCORING_TYPES.has(etype)) return ev;

  const score = ev.score;
  if (score === null || score === undefined) {
    return {
      ...ev,
      is_pass: false,
      explainability: `${ev.explainability ?? ""} [no score returned]`.trim(),
    };
  }

  const id = ev.id ?? "";
  const m = THR_RE.exec(id);
  const threshold = m ? parseInt(m[1], 10) / 100 : (DEFAULT_THRESHOLDS[etype] ?? 0.5);
  const passed = score >= threshold;

  const verdict = passed ? "PASS" : "FAIL";
  const head = `score=${score.toFixed(2)} vs threshold=${threshold.toFixed(2)} → ${verdict}`;
  const tail = ev.explainability ? `  |  ${ev.explainability}` : "";

  return { ...ev, is_pass: passed, explainability: head + tail };
}

export function groupEvaluators(evals: EvalResult[]): EvalResult[] {
  const thresholded = evals.map(applyScoreThreshold);
  const groups = new Map<string, EvalResult[]>();
  const singletons: EvalResult[] = [];

  for (const e of thresholded) {
    const m = OPT_RE.exec(e.id ?? "");
    if (m) {
      const arr = groups.get(m[1]) ?? [];
      arr.push(e);
      groups.set(m[1], arr);
    } else {
      singletons.push(e);
    }
  }

  const out: EvalResult[] = [...singletons];
  for (const [gid, members] of groups.entries()) {
    const anyPass = members.some((m) => m.is_pass === true);
    const details = members
      .map((m) => {
        const opt = (m.id ?? "").split("__opt").pop();
        return `${opt}=${m.is_pass ? "Y" : "N"}`;
      })
      .join(", ");
    out.push({
      id: gid,
      is_pass: anyPass,
      score: anyPass ? 1.0 : 0.0,
      type: "evaluator.string_assertion (group)",
      explainability: `one-of match: ${details}`,
    });
  }
  return out;
}
