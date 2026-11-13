/* SPDX-License-Identifier: Apache-2.0 */
/** Central evaluator capability and display metadata for eval result interpretation. */

export type EvaluatorCapability = "live_proven" | "client_recognized" | "candidate";
export type EvaluatorFamily = "assertion" | "scoring" | "unknown";

export interface EvaluatorCatalogEntry {
  type: string;
  label: string;
  family: EvaluatorFamily;
  capability: EvaluatorCapability;
  defaultMetricName?: string;
  defaultThreshold?: number;
  /**
   * Operators the live Evaluation API accepts for this evaluator. The list is
   * the enum from the API's own HTTP 422 validation message, so the evaluator
   * is live-proven only for these operators. Anything else is rejected before
   * a network call.
   */
  allowedOperators?: readonly string[];
}

const ENTRIES: readonly EvaluatorCatalogEntry[] = [
  {
    type: "evaluator.string_assertion",
    label: "String assertion",
    family: "assertion",
    capability: "live_proven",
    defaultMetricName: "string_assertion",
    allowedOperators: [
      "equals",
      "contains",
      "startswith",
      "endswith",
      "regex_match",
      "not_contains",
      "not_equals",
    ],
  },
  {
    type: "evaluator.numeric_assertion",
    label: "Numeric assertion",
    family: "assertion",
    capability: "live_proven",
    allowedOperators: [
      "equals",
      "greater_than_or_equal",
      "greater_than",
      "less_than",
      "less_than_or_equal",
      "not_equals",
    ],
  },
  {
    type: "evaluator.list_assertion",
    label: "List assertion",
    family: "assertion",
    capability: "live_proven",
    // `contains` is a string_assertion operator; list_assertion rejects it.
    allowedOperators: [
      "exact_match_with_order",
      "exact_match_without_order",
      "includes_items",
      "superset",
      "item_in",
      "not_equals",
      "not_contains",
    ],
  },
  {
    type: "evaluator.bot_response_rating",
    label: "Bot response rating",
    family: "assertion",
    capability: "live_proven",
  },
  {
    type: "evaluator.text_alignment",
    label: "Text alignment",
    family: "scoring",
    capability: "live_proven",
    defaultMetricName: "base.cosine_similarity",
    defaultThreshold: 0.3,
  },
  {
    type: "evaluator.hallucination_detection",
    label: "Hallucination detection",
    family: "scoring",
    capability: "live_proven",
    defaultMetricName: "hallucination_detection",
  },
  {
    type: "evaluator.citation_recall",
    label: "Citation recall",
    family: "scoring",
    capability: "live_proven",
    defaultMetricName: "citation_recall",
  },
  {
    type: "evaluator.answer_faithfulness",
    label: "Answer faithfulness",
    family: "scoring",
    capability: "live_proven",
    defaultMetricName: "answer_faithfulness",
  },
  {
    type: "evaluator.text_quality",
    label: "Text quality",
    family: "scoring",
    capability: "client_recognized",
    defaultThreshold: 0.8,
  },
] as const;

const BY_TYPE = new Map(ENTRIES.map((entry) => [entry.type, entry]));

export const EVALUATOR_CATALOG = ENTRIES;
export const SCORING_EVALUATORS = new Set(
  ENTRIES.filter((entry) => entry.family === "scoring" && entry.capability === "live_proven").map(
    (entry) => entry.type,
  ),
);
export const ASSERTION_EVALUATORS = new Set(
  ENTRIES.filter(
    (entry) =>
      entry.family === "assertion" &&
      entry.capability === "live_proven" &&
      entry.type !== "evaluator.bot_response_rating",
  ).map((entry) => entry.type),
);
export const DEFAULT_METRIC_NAMES = Object.fromEntries(
  ENTRIES.flatMap((entry) =>
    entry.defaultMetricName ? [[entry.type, entry.defaultMetricName] as const] : [],
  ),
) as Readonly<Record<string, string>>;

/** The live-accepted operators for `type`, or undefined when the catalog has none. */
export function allowedOperatorsFor(type: string | undefined): readonly string[] | undefined {
  return BY_TYPE.get(type ?? "")?.allowedOperators;
}

export function evaluatorCatalogEntry(type: string | undefined): EvaluatorCatalogEntry {
  const normalized = type ?? "";
  return (
    BY_TYPE.get(normalized) ?? {
      type: normalized || "unknown",
      label: normalized || "Unknown evaluator",
      family: "unknown",
      capability: "candidate",
    }
  );
}
