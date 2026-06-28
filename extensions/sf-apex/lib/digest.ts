/* SPDX-License-Identifier: Apache-2.0 */
/** Shared Apex Run Digest builders for compact LLM output + rich human cards. */

import type {
  ApexApiCallRailItem,
  ApexArtifact,
  ApexRunDigest,
  ApexRunSection,
  DigestRow,
  SfApexAction,
} from "./types.ts";

export interface BuildApexDigestInput {
  action: SfApexAction;
  kind: string;
  status: ApexRunDigest["status"];
  icon: string;
  title: string;
  orgAlias?: string;
  apiVersion?: string;
  userId?: string;
  meta?: string[];
  apiCalls?: ApexApiCallRailItem[];
  summaryRows?: DigestRow[];
  signalRows?: DigestRow[];
  evidenceRows?: DigestRow[];
  nextRows?: DigestRow[];
  mode?: string;
  sections?: ApexRunSection[];
  artifacts?: ApexArtifact[];
}

const NATIVE_MODE_ROW: DigestRow = {
  icon: "⚡",
  label: "Mode",
  value: "API-native · Salesforce Core + Tooling REST",
};

export function buildApexDigest(input: BuildApexDigestInput): ApexRunDigest {
  const sections: ApexRunSection[] = [];
  if (input.summaryRows?.length) {
    sections.push({ icon: "🧾", title: "Summary", rows: input.summaryRows });
  }
  sections.push(...(input.sections ?? []));
  if (input.signalRows?.length) {
    sections.push({ icon: "📊", title: "Signals", rows: input.signalRows });
  }
  const evidenceRows = [
    input.mode ? { ...NATIVE_MODE_ROW, value: input.mode } : NATIVE_MODE_ROW,
    ...(input.evidenceRows ?? []),
  ];
  sections.push({ icon: "🔎", title: "Evidence", rows: evidenceRows });
  if (input.nextRows?.length) {
    sections.push({ icon: "➡️", title: "Next", rows: input.nextRows });
  }

  return {
    action: input.action,
    kind: input.kind,
    status: input.status,
    icon: input.icon,
    title: input.title,
    org:
      input.orgAlias || input.apiVersion || input.userId
        ? { alias: input.orgAlias, api_version: input.apiVersion, user_id: input.userId }
        : undefined,
    meta: input.meta?.filter(Boolean),
    api_calls: input.apiCalls,
    sections,
    artifacts: input.artifacts,
  };
}

export function artifactRows(artifacts: unknown): DigestRow[] {
  if (!Array.isArray(artifacts)) return [];
  return artifacts
    .map((artifact): DigestRow | undefined => {
      if (!artifact || typeof artifact !== "object") return undefined;
      const path = (artifact as { path?: unknown }).path;
      const kind = (artifact as { kind?: unknown }).kind;
      if (typeof path !== "string") return undefined;
      return { icon: "📁", label: typeof kind === "string" ? kind : "Artifact", value: path };
    })
    .filter((row): row is DigestRow => Boolean(row));
}

export function boolWord(value: boolean): string {
  return value ? "yes" : "no";
}

export function plural(count: number, singular: string, pluralWord = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

export function formatMs(ms: number | undefined): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return undefined;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
