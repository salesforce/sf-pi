/* SPDX-License-Identifier: Apache-2.0 */
/** Native Anonymous Apex execution with risk classification and log capture. */

import type { Connection } from "@salesforce/core";
import { apiVersion, currentUserId, requestJson } from "./api.ts";
import { artifactTimestamp, writeApexArtifact } from "./artifacts.ts";
import { buildApexDigest } from "./digest.ts";
import { fetchAndAnalyzeLog, waitForLog } from "./logs.ts";
import { fail, ok } from "./result.ts";
import { startTrace } from "./trace.ts";
import type { SfApexParams, SfApexSessionState, ToolResult } from "./types.ts";

export async function runAnonymous(
  conn: Connection,
  params: SfApexParams,
  state?: SfApexSessionState,
): Promise<ToolResult> {
  if (!params.body) return fail("body is required for anon.run.", { kind: "anonymous_apex" });
  const risk = classifyAnonymousApex(params.body);
  if (risk.mutating && !params.allow_mutation) {
    return fail(
      "Anonymous Apex appears mutating. Pass allow_mutation=true only when intentional.",
      {
        kind: "anonymous_apex",
        risk,
        recover_via: { action: "anon.run", allow_mutation: true },
      },
    );
  }

  const startedAt = new Date();
  await startTrace(conn, params, state);
  const v = apiVersion(conn);
  const encoded = encodeURIComponent(params.body);
  const result = await requestJson<Record<string, unknown>>(
    conn,
    "GET",
    `/services/data/v${v}/tooling/executeAnonymous/?anonymousBody=${encoded}`,
  );
  const stamp = artifactTimestamp(startedAt);
  const sourceArtifact = await writeApexArtifact("anonymous", `${stamp}.apex`, params.body);
  const resultArtifact = await writeApexArtifact("anonymous", `${stamp}.result.json`, result);

  let logResult: ToolResult | undefined;
  try {
    const logs = await waitForLog(
      conn,
      params.user_id ?? (await currentUserId(conn)),
      startedAt,
      30_000,
    );
    if (logs[0]) logResult = await fetchAndAnalyzeLog(conn, logs[0], state, params);
  } catch {
    // A missing log should not hide the executeAnonymous result.
  }

  const success = result.success === true;
  const artifacts = [
    sourceArtifact,
    resultArtifact,
    ...((logResult?.details?.artifacts as unknown[]) ?? []),
  ];
  const logDigest = logResult?.details?.log_digest as
    | {
        counts?: {
          exceptions?: number;
          user_debug?: number;
          soql?: number;
          dml?: number;
          cpu_ms?: number;
        };
        timeline?: Array<{ icon: string; label: string; detail: string; offset_ms?: number }>;
        log_id?: string;
      }
    | undefined;
  return ok(
    [
      `Anonymous Apex ${success ? "succeeded" : "failed"}.`,
      result.compileProblem ? `Compile problem: ${result.compileProblem}` : undefined,
      result.exceptionMessage ? `Exception: ${result.exceptionMessage}` : undefined,
      logResult?.content?.[0]?.text,
    ]
      .filter(Boolean)
      .join("\n\n"),
    {
      kind: "anonymous_apex",
      result,
      risk,
      artifacts,
      log: logResult?.details,
      digest: buildApexDigest({
        action: params.action,
        kind: "anonymous_apex",
        status: success ? "pass" : "fail",
        icon: "⚡",
        title: `Anonymous Apex Report · ${success ? "succeeded" : "failed"}`,
        orgAlias: params.target_org,
        apiVersion: v,
        apiCalls: [
          {
            method: "GET",
            path: "/tooling/executeAnonymous",
            detail: `body=${params.body.length} chars · mutating=${risk.mutating ? "yes" : "no"}`,
          },
          {
            method: "GET",
            path: "/tooling/query ApexLog",
            detail: "find generated log · since=start",
          },
          {
            method: "GET",
            path: "/tooling/sobjects/ApexLog/Body",
            detail: `id=${shortId(logDigest?.log_id)}`,
          },
        ],
        meta: logDigest?.log_id ? [`log=${logDigest.log_id.slice(0, 8)}…`] : undefined,
        summaryRows: [
          {
            icon: success ? "✅" : "❌",
            label: "Outcome",
            value: success ? "executed successfully" : "execution failed",
          },
          {
            icon: risk.mutating ? "⚠️" : "🛡️",
            label: "Risk",
            value: risk.mutating ? `mutating · ${risk.reasons.join(", ")}` : "non-mutating probe",
          },
          result.compileProblem
            ? { icon: "🧯", label: "Compile", value: String(result.compileProblem) }
            : undefined,
          result.exceptionMessage
            ? { icon: "🔥", label: "Exception", value: String(result.exceptionMessage) }
            : undefined,
        ].filter((row): row is { icon: string; label: string; value: string } => Boolean(row)),
        sections: logDigest?.timeline?.length
          ? [
              {
                icon: "⏱️",
                title: "Log Timeline",
                rows: logDigest.timeline.slice(0, 5).map((event) => ({
                  icon: event.icon,
                  label: event.offset_ms === undefined ? event.label : `+${event.offset_ms}ms`,
                  value: `${event.label} · ${event.detail}`,
                })),
              },
            ]
          : undefined,
        signalRows: [
          { icon: "🔥", label: "Exceptions", value: String(logDigest?.counts?.exceptions ?? 0) },
          { icon: "💬", label: "Debug", value: `${logDigest?.counts?.user_debug ?? 0} line(s)` },
          { icon: "🔢", label: "SOQL", value: String(logDigest?.counts?.soql ?? 0) },
          { icon: "📝", label: "DML", value: String(logDigest?.counts?.dml ?? 0) },
          { icon: "⏱️", label: "CPU", value: `${logDigest?.counts?.cpu_ms ?? 0}ms` },
        ],
        evidenceRows: [
          logDigest?.log_id ? { icon: "🧾", label: "Log", value: logDigest.log_id } : undefined,
          { icon: "📁", label: "Saved", value: artifactSummary(artifacts) },
        ].filter((row): row is { icon: string; label: string; value: string } => Boolean(row)),
        nextRows: [
          {
            icon: "🧭",
            label: "Recommend",
            value: success
              ? "run targeted tests or inspect latest log"
              : "fix compile/runtime issue and rerun anon.run",
          },
        ],
      }),
    },
  );
}

function shortId(value: string | undefined): string {
  if (!value) return "unknown";
  return value.length > 10 ? `${value.slice(0, 3)}…${value.slice(-4)}` : value;
}

function artifactSummary(artifacts: unknown[]): string {
  if (artifacts.length === 0) return "none";
  const kinds = [
    ...new Set(
      artifacts
        .map((artifact) =>
          artifact &&
          typeof artifact === "object" &&
          typeof (artifact as { kind?: unknown }).kind === "string"
            ? String((artifact as { kind: string }).kind)
            : undefined,
        )
        .filter((kind): kind is string => Boolean(kind)),
    ),
  ];
  return `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}${kinds.length ? ` · ${kinds.join(" + ")}` : ""}`;
}

export function classifyAnonymousApex(body: string): { mutating: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ["DML keyword", /\b(insert|update|upsert|delete|undelete|merge)\b/i],
    ["Database DML", /\bDatabase\s*\.\s*(insert|update|upsert|delete|undelete|merge)\b/i],
    ["async enqueue", /\bSystem\s*\.\s*enqueueJob\b|\bDatabase\s*\.\s*executeBatch\b/i],
  ];
  for (const [reason, pattern] of checks) if (pattern.test(body)) reasons.push(reason);
  return { mutating: reasons.length > 0, reasons };
}
