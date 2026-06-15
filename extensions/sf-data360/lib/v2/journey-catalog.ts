/* SPDX-License-Identifier: Apache-2.0 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Data360V2ToolName } from "./action-types.ts";

export type JourneyConfidence = "high" | "medium" | "low";

export interface JourneyActionRef {
  tool: Data360V2ToolName;
  action: string;
}

export interface Data360JourneyDefinition {
  name: string;
  summary: string;
  utterances: string[];
  phases: string[];
  requiredInputs: string[];
  planAction: string;
  runAction: string;
  verification: string[];
  availableActions: JourneyActionRef[];
  suggestedQuestions: string[];
}

export interface IntentPlanResult {
  journey: Data360JourneyDefinition;
  confidence: JourneyConfidence;
  missingInputs: string[];
  targetTool: Data360V2ToolName;
  targetAction: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JOURNEY_CATALOG_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "registry",
  "v2",
  "journey-catalog.json",
);

let cache: Data360JourneyDefinition[] | undefined;

export function getData360Journeys(): Data360JourneyDefinition[] {
  cache ??= JSON.parse(readFileSync(JOURNEY_CATALOG_PATH, "utf8")) as Data360JourneyDefinition[];
  return cache;
}

export function findData360Journey(name: string): Data360JourneyDefinition | undefined {
  return getData360Journeys().find((journey) => journey.name === name.trim());
}

export function planData360Intent(utterance: string): IntentPlanResult {
  const terms = tokenize(utterance);
  const scored = getData360Journeys()
    .map((journey) => ({ journey, score: scoreJourney(journey, terms) }))
    .sort((a, b) => b.score - a.score || a.journey.name.localeCompare(b.journey.name));
  const best = scored[0];
  if (!best || best.score === 0) {
    const fallback = findData360Journey("make_data_usable") ?? getData360Journeys()[0];
    return {
      journey: fallback,
      confidence: "low",
      missingInputs: fallback.requiredInputs,
      targetTool: "data360_orchestrate",
      targetAction: "journey.describe",
    };
  }
  return {
    journey: best.journey,
    confidence: best.score >= 3 ? "high" : best.score >= 2 ? "medium" : "low",
    missingInputs: best.journey.requiredInputs,
    targetTool:
      best.journey.name === "agent_behavior_investigation"
        ? "data360_observe"
        : "data360_orchestrate",
    targetAction:
      best.journey.name === "agent_behavior_investigation" ? "actions.search" : "journey.describe",
  };
}

function scoreJourney(journey: Data360JourneyDefinition, terms: string[]): number {
  const haystack = [journey.name, journey.summary, ...journey.utterances, ...journey.phases]
    .join(" ")
    .toLowerCase();
  return terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length > 2);
}
