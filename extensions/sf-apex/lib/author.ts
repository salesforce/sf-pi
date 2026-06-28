/* SPDX-License-Identifier: Apache-2.0 */
/** Lightweight Apex authoring guidance. */

import path from "node:path";
import { buildApexDigest } from "./digest.ts";
import { ok } from "./result.ts";
import type { SfApexParams, ToolResult } from "./types.ts";

export async function authorPlan(params: SfApexParams): Promise<ToolResult> {
  const targets = [...(params.targets ?? []), ...(params.target ? [params.target] : [])].filter(
    Boolean,
  );
  const likelyTests = targets.flatMap((target) => likelyTestNames(target));
  return ok(
    [
      "Apex authoring plan:",
      targets.length ? `- Target files: ${targets.join(", ")}` : "- Target files: not specified",
      params.intent ? `- Intent: ${params.intent}` : undefined,
      likelyTests.length ? `- Likely tests: ${[...new Set(likelyTests)].join(", ")}` : undefined,
      "- Edit source with normal Pi file tools.",
      "- Then run sf_apex diagnose.file.",
      "- Then run sf_apex test.run for targeted classes/methods.",
      "- Use sf_apex log.latest or log.watch when runtime behavior is unclear.",
    ]
      .filter(Boolean)
      .join("\n"),
    {
      kind: "author_plan",
      targets,
      intent: params.intent,
      likely_tests: [...new Set(likelyTests)],
      recommended_skills: ["generating-apex", "generating-apex-test", "running-apex-tests"],
      digest: buildApexDigest({
        action: params.action,
        kind: "author_plan",
        status: "info",
        icon: "🧭",
        title: "Apex Lifecycle Flight Plan",
        mode: "Local planning",
        apiCalls: [{ method: "LOCAL", path: "filename heuristics", detail: "likely test names" }],
        sections: [
          {
            icon: "🎯",
            title: "Mission",
            rows: [
              { icon: "🎯", label: "Goal", value: params.intent ?? "not specified" },
              {
                icon: "📄",
                label: "Targets",
                value: targets.length ? compactList(targets) : "not specified",
              },
              {
                icon: "🧪",
                label: "Test hints",
                value: likelyTests.length ? compactList([...new Set(likelyTests)]) : "not inferred",
              },
            ],
          },
          {
            icon: "🛣️",
            title: "Route",
            rows: [
              { icon: "1️⃣", label: "Edit", value: "normal Pi file tools" },
              { icon: "2️⃣", label: "Gate", value: "sf_apex diagnose.file" },
              { icon: "3️⃣", label: "Test", value: "sf_apex test.run targeted classes" },
              { icon: "4️⃣", label: "Observe", value: "sf_apex log.latest / log.watch if unclear" },
            ],
          },
          {
            icon: "🛡️",
            title: "Guardrails",
            rows: [
              { icon: "⚡", label: "Native", value: "prefer sf_apex over raw sf CLI" },
              { icon: "🎯", label: "Scope", value: "smallest useful test set first" },
              { icon: "🧹", label: "Cleanup", value: "stop trace when done" },
            ],
          },
        ],
        nextRows: [
          { icon: "🧭", label: "Recommend", value: "edit target, then run Apex File Gate" },
        ],
      }),
    },
  );
}

function compactList(values: string[]): string {
  const visible = values.slice(0, 3).join(", ");
  return values.length > 3 ? `${visible}, +${values.length - 3} more` : visible;
}

function likelyTestNames(target: string): string[] {
  const base = path.basename(target).replace(/\.(cls|trigger)$/i, "");
  if (!base) return [];
  const names = [`${base}Test`, `${base}_Test`];
  if (base.endsWith("Service")) names.push(`${base.replace(/Service$/, "")}ServiceTest`);
  if (base.endsWith("Trigger")) names.push(`${base}HandlerTest`, `${base}_Test`);
  return [...new Set(names)];
}
