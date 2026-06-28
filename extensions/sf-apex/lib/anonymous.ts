/* SPDX-License-Identifier: Apache-2.0 */
/** Native Anonymous Apex execution with risk classification and log capture. */

import type { Connection } from "@salesforce/core";
import { apiVersion } from "./api.ts";
import { executeAnonymousSoap } from "./anonymous-soap.ts";
import { artifactTimestamp, writeApexArtifact } from "./artifacts.ts";
import { buildApexDigest } from "./digest.ts";
import { parseApexLog } from "./log-parser.ts";
import { fail, ok } from "./result.ts";
import type { ApexLogDigest, SfApexParams, ToolResult } from "./types.ts";

export async function runAnonymous(conn: Connection, params: SfApexParams): Promise<ToolResult> {
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

  const v = apiVersion(conn);
  const result = await executeAnonymousSoap(conn, params.body);
  const stamp = artifactTimestamp();
  const sourceArtifact = await writeApexArtifact("anonymous", `${stamp}.apex`, params.body);
  const resultArtifact = await writeApexArtifact("anonymous", `${stamp}.result.json`, result);
  const artifacts = [sourceArtifact, resultArtifact];
  let logDigest: ApexLogDigest | undefined;
  if (result.logs) {
    const logArtifact = await writeApexArtifact("logs", `${stamp}.log`, result.logs);
    logDigest = parseApexLog(result.logs, {
      operation: "Anonymous Apex",
      status: result.success ? "Success" : "Failed",
    });
    const digestArtifact = await writeApexArtifact("logs", `${stamp}.digest.json`, logDigest);
    artifacts.push(logArtifact, digestArtifact);
  }

  const success = result.success === true;
  return ok(
    [
      `Anonymous Apex ${success ? "succeeded" : "failed"}.`,
      result.compileProblem ? `Compile problem: ${result.compileProblem}` : undefined,
      result.exceptionMessage ? `Exception: ${result.exceptionMessage}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n"),
    {
      kind: "anonymous_apex",
      result,
      risk,
      artifacts,
      log_digest: logDigest,
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
            method: "POST",
            path: "/services/Soap/s/{version}/{orgId}",
            detail: `executeAnonymous · body=${params.body.length} chars · mutating=${risk.mutating ? "yes" : "no"}`,
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
            ? {
                icon: "🧯",
                label: "Compile",
                value: `${result.line ?? "?"}:${result.column ?? "?"} · ${result.compileProblem}`,
              }
            : undefined,
          result.exceptionMessage
            ? { icon: "🔥", label: "Exception", value: String(result.exceptionMessage) }
            : undefined,
        ].filter((row): row is { icon: string; label: string; value: string } => Boolean(row)),
        sections: [
          ...rootCauseSection(result, logDigest),
          ...(logDigest?.timeline?.length
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
            : [
                {
                  icon: "⏱️",
                  title: "Log Timeline",
                  rows: [
                    {
                      icon: "⚪",
                      label: "Log",
                      value: "SOAP response did not include a debug log body",
                    },
                  ],
                },
              ]),
        ],
        signalRows: [
          { icon: "🔥", label: "Exceptions", value: String(logDigest?.counts?.exceptions ?? 0) },
          { icon: "💬", label: "Debug", value: `${logDigest?.counts?.user_debug ?? 0} line(s)` },
          { icon: "🔢", label: "SOQL", value: String(logDigest?.counts?.soql ?? 0) },
          { icon: "📝", label: "DML", value: String(logDigest?.counts?.dml ?? 0) },
          { icon: "⏱️", label: "CPU", value: `${logDigest?.counts?.cpu_ms ?? 0}ms` },
        ],
        evidenceRows: [
          {
            icon: result.logs ? "🧾" : "⚪",
            label: "Log",
            value: result.logs ? "inline SOAP debug log" : "not returned",
          },
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

function rootCauseSection(
  result: {
    compileProblem?: string;
    exceptionMessage?: string;
    exceptionStackTrace?: string;
  },
  logDigest: ApexLogDigest | undefined,
) {
  if (!result.compileProblem && !result.exceptionMessage && !logDigest?.exceptions[0]) return [];
  const exception = logDigest?.exceptions[0];
  return [
    {
      icon: "🔥",
      title: "Root Cause",
      rows: [
        result.compileProblem
          ? { icon: "🧯", label: "Compile", value: result.compileProblem }
          : undefined,
        result.exceptionMessage
          ? { icon: "🔥", label: "Exception", value: result.exceptionMessage }
          : undefined,
        exception?.type ? { icon: "🏷️", label: "Type", value: exception.type } : undefined,
        exception?.message ? { icon: "💬", label: "Message", value: exception.message } : undefined,
        result.exceptionStackTrace
          ? { icon: "📍", label: "Stack", value: firstLine(result.exceptionStackTrace) }
          : undefined,
      ].filter((row): row is { icon: string; label: string; value: string } => Boolean(row)),
    },
  ];
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0] ?? value;
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
