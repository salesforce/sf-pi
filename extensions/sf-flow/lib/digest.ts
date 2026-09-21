/* SPDX-License-Identifier: Apache-2.0 */
/** Flow Run Digest builders for compact model output and rich human cards. */

import type {
  DigestRow,
  FlowArtifact,
  FlowRunDigest,
  FlowRunSection,
  SfFlowAction,
  ToolResult,
} from "./types.ts";

export function row(icon: string, label: string, value: unknown): DigestRow {
  return {
    icon,
    label,
    value: value === undefined || value === null || value === "" ? "—" : String(value),
  };
}

export function section(icon: string, title: string, rows: DigestRow[]): FlowRunSection {
  return { icon, title, rows };
}

export function buildFlowDigest(input: {
  action: SfFlowAction;
  kind: string;
  status: FlowRunDigest["status"];
  icon: string;
  title: string;
  org?: FlowRunDigest["org"];
  meta?: string[];
  rail?: FlowRunDigest["rail"];
  sections?: FlowRunSection[];
  topology?: FlowRunDigest["topology"];
  artifacts?: FlowArtifact[];
  next_step?: string;
}): FlowRunDigest {
  return { ...input, sections: input.sections ?? [] };
}

export function toolResultFromDigest(
  digest: FlowRunDigest,
  details: Record<string, unknown> = {},
): ToolResult {
  return {
    content: [{ type: "text", text: compactText(digest) }],
    details: {
      ok: digest.status !== "fail",
      ...details,
      digest,
    },
  };
}

export function compactText(digest: FlowRunDigest): string {
  const meta = digest.meta?.length ? ` · ${digest.meta.join(" · ")}` : "";
  const lines = [`${digest.status.toUpperCase()}: ${digest.title}${meta}`];
  for (const section of digest.sections.slice(0, 3)) {
    for (const item of section.rows.slice(0, 4)) lines.push(`${item.label}: ${item.value}`);
  }
  if (digest.artifacts?.length) lines.push(`Artifacts: ${digest.artifacts.length}`);
  if (digest.next_step) lines.push(`Next: ${digest.next_step}`);
  return lines.join("\n");
}
