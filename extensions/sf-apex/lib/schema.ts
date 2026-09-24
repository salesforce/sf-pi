/* SPDX-License-Identifier: Apache-2.0 */
/** Shared Apex input schema and execution prerequisites. */
import { Type } from "typebox";
import type { SfApexParams } from "./types.ts";

function stringEnum<T extends string>(values: readonly T[], options?: { description: string }) {
  return Type.Unsafe<T>({ type: "string", enum: [...values], ...options });
}

const Action = stringEnum(
  [
    "status",
    "org.preflight",
    "apex.search",
    "test.discover",
    "test.plan",
    "test.suites",
    "coverage.summary",
    "author.plan",
    "diagnose.file",
    "apex.source.get",
    "trace.start",
    "trace.stop",
    "trace.status",
    "log.latest",
    "log.get",
    "log.analyze",
    "log.watch",
    "anon.run",
    "test.run",
    "test.result",
    "test.rerun",
  ] as const,
  { description: "SF Apex lifecycle action." },
);

export const Params = Type.Object({
  action: Action,
  target_org: Type.Optional(Type.String({ description: "Salesforce org alias or username." })),
  target: Type.Optional(Type.String({ description: "Primary Apex file/class target." })),
  targets: Type.Optional(Type.Array(Type.String(), { description: "Apex file/class targets." })),
  query: Type.Optional(Type.String({ description: "Search query for apex.search/test.discover." })),
  test_only: Type.Optional(
    Type.Boolean({ description: "Restrict apex.search to likely test classes." }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Discovery result limit. Default 25, max 100." }),
  ),
  intent: Type.Optional(Type.String({ description: "Authoring intent for author.plan." })),
  file: Type.Optional(
    Type.String({ description: "Local file path for diagnose.file or log.analyze." }),
  ),
  body: Type.Optional(Type.String({ description: "Anonymous Apex body or raw Apex log body." })),
  log_id: Type.Optional(Type.String({ description: "ApexLog Id for log.get." })),
  user_id: Type.Optional(Type.String({ description: "Tooling User Id to trace/read logs for." })),
  duration_minutes: Type.Optional(
    Type.Number({ description: "Trace duration. Default 30, max 120." }),
  ),
  wait_seconds: Type.Optional(
    Type.Number({ description: "Wait window for log.watch/test polling." }),
  ),
  poll_interval_seconds: Type.Optional(
    Type.Number({ description: "Polling interval for log.watch." }),
  ),
  allow_mutation: Type.Optional(
    Type.Boolean({ description: "Required for mutation-like Anonymous Apex." }),
  ),
  include_coverage: Type.Optional(
    Type.Boolean({ description: "Collect Apex coverage evidence with test.run/test.result." }),
  ),
  include_uncovered_lines: Type.Optional(
    Type.Boolean({
      description: "Include covered/uncovered line arrays in coverage.summary artifacts.",
    }),
  ),
  include_members: Type.Optional(
    Type.Boolean({ description: "Include suite membership rows in test.suites." }),
  ),
  org_wide: Type.Optional(
    Type.Boolean({ description: "Include org-wide Apex coverage in coverage.summary." }),
  ),
  threshold_percent: Type.Optional(
    Type.Number({ description: "Coverage threshold signal only; does not fail runs." }),
  ),
  tests: Type.Optional(
    Type.Array(Type.String(), {
      description: "Targeted tests as ClassName or ClassName.methodName.",
    }),
  ),
  class_names: Type.Optional(
    Type.Array(Type.String(), { description: "Targeted Apex test class names." }),
  ),
  suite_names: Type.Optional(
    Type.Array(Type.String(), { description: "Existing Apex test suite names to run." }),
  ),
  apex_ids: Type.Optional(
    Type.Array(Type.String(), { description: "ApexClass/ApexTrigger ids for apex.source.get." }),
  ),
  report_formats: Type.Optional(
    Type.Array(stringEnum(["markdown", "junit", "tap", "text", "json"] as const), {
      description: "Optional Apex test report artifact formats.",
    }),
  ),
  run_id: Type.Optional(Type.String({ description: "AsyncApexJob id from test.run." })),
  output_mode: Type.Optional(
    stringEnum(["summary", "inline", "file_only"] as const, {
      description: "Reserved output mode for future richer output.",
    }),
  ),
});

export const apexActions: Record<
  SfApexParams["action"],
  { available: boolean; reason?: string; effects?: boolean; requiresPreviousTest?: boolean }
> = {
  status: { available: true },
  "org.preflight": { available: true },
  "apex.search": { available: true },
  "test.discover": { available: true },
  "test.plan": { available: true },
  "test.suites": { available: true },
  "coverage.summary": { available: true },
  "author.plan": { available: true },
  "diagnose.file": { available: true },
  "apex.source.get": { available: true },
  "trace.start": { available: true, effects: true },
  "trace.stop": { available: true, effects: true },
  "trace.status": { available: true },
  "log.latest": { available: true },
  "log.get": { available: true },
  "log.analyze": { available: true },
  "log.watch": { available: true, effects: true },
  "anon.run": { available: true, effects: true },
  "test.run": { available: true, effects: true },
  "test.result": { available: true },
  "test.rerun": { available: true, effects: true, requiresPreviousTest: true },
};
