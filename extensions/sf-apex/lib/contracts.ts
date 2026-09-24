/* SPDX-License-Identifier: Apache-2.0 */
/** Action-specific SDK contracts; native registration retains its compatible family schema. */
import { Type, type Static, type TSchema } from "typebox";
import { Params } from "./schema.ts";
import type { SfApexAction } from "./types.ts";

function input<A extends SfApexAction, K extends keyof typeof Params.properties>(
  action: A,
  ...keys: K[]
) {
  return Type.Object({
    ...(Object.fromEntries(keys.map((key) => [key, Params.properties[key]])) as Pick<
      typeof Params.properties,
      K
    >),
    action: Type.Literal(action),
    target_org: Params.properties.target_org,
    output_mode: Params.properties.output_mode,
  });
}
const fileTarget = Type.Union([
  Type.Object({ file: Type.String() }),
  Type.Object({ target: Type.String() }),
]);
const testTarget = Type.Union([
  Type.Object({ tests: Type.Array(Type.String(), { minItems: 1 }) }),
  Type.Object({ class_names: Type.Array(Type.String(), { minItems: 1 }) }),
  Type.Object({ suite_names: Type.Array(Type.String(), { minItems: 1 }) }),
]);
export const apexInputSchemas = {
  status: input("status", "user_id"),
  "org.preflight": input("org.preflight", "user_id"),
  "apex.search": input("apex.search", "query", "target", "test_only", "limit"),
  "test.discover": input("test.discover", "query", "target", "targets", "limit"),
  "test.plan": input("test.plan", "query", "target", "targets", "limit"),
  "test.suites": input("test.suites", "include_members"),
  "coverage.summary": input(
    "coverage.summary",
    "target",
    "targets",
    "class_names",
    "org_wide",
    "include_uncovered_lines",
    "threshold_percent",
  ),
  "author.plan": input("author.plan", "target", "targets", "intent"),
  "diagnose.file": Type.Intersect([input("diagnose.file", "file", "target"), fileTarget]),
  "apex.source.get": input("apex.source.get", "target", "targets", "class_names", "apex_ids"),
  "trace.start": input("trace.start", "user_id", "duration_minutes"),
  "trace.stop": input("trace.stop", "user_id"),
  "trace.status": input("trace.status", "user_id"),
  "log.latest": input("log.latest", "user_id"),
  "log.get": Type.Intersect([input("log.get"), Type.Object({ log_id: Type.String() })]),
  "log.analyze": Type.Intersect([
    input("log.analyze", "file", "body"),
    Type.Union([Type.Object({ file: Type.String() }), Type.Object({ body: Type.String() })]),
  ]),
  "log.watch": input(
    "log.watch",
    "user_id",
    "duration_minutes",
    "wait_seconds",
    "poll_interval_seconds",
  ),
  "anon.run": Type.Intersect([
    input("anon.run", "allow_mutation"),
    Type.Object({ body: Type.String() }),
  ]),
  "test.run": Type.Intersect([
    input(
      "test.run",
      "tests",
      "class_names",
      "suite_names",
      "include_coverage",
      "wait_seconds",
      "report_formats",
    ),
    testTarget,
  ]),
  "test.result": input(
    "test.result",
    "run_id",
    "include_coverage",
    "wait_seconds",
    "report_formats",
  ),
  "test.rerun": input("test.rerun", "wait_seconds"),
} satisfies Record<SfApexAction, TSchema>;

export const apexInputSchema = Type.Unsafe<ApexInput>(
  Type.Intersect([Params, Type.Union(Object.values(apexInputSchemas))]),
);
export type ApexInput<A extends SfApexAction = SfApexAction> = {
  [K in SfApexAction]: Static<(typeof apexInputSchemas)[K]>;
}[A];

const record = Type.Record(Type.String(), Type.Unknown());
const records = Type.Array(record);
const strings = Type.Array(Type.String());
const number = Type.Number();
const optional = Type.Optional;
const artifact = Type.Object({ path: Type.String(), kind: Type.String() });
const commonDetails = { artifacts: optional(Type.Array(artifact)) };
const position = Type.Object({
  line: Type.Integer({ minimum: 0 }),
  character: Type.Integer({ minimum: 0 }),
});
const diagnostic = Type.Object({
  message: Type.String(),
  range: Type.Object({ start: position, end: position }),
  severity: optional(
    Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3), Type.Literal(4)]),
  ),
  source: optional(Type.String()),
  code: optional(Type.Union([Type.String(), number])),
});
const log = Type.Object({
  log_id: optional(Type.String()),
  operation: optional(Type.String()),
  status: optional(Type.String()),
  start_time: optional(Type.String()),
  duration_ms: optional(number),
  log_length: optional(number),
  timeline: Type.Array(
    Type.Object({
      icon: Type.String(),
      kind: Type.String(),
      label: Type.String(),
      detail: Type.String(),
      offset_ms: optional(number),
      raw: optional(Type.String()),
    }),
  ),
  user_debug: Type.Array(
    Type.Object({
      line: optional(number),
      level: optional(Type.String()),
      message: Type.String(),
      raw: Type.String(),
    }),
  ),
  exceptions: Type.Array(
    Type.Object({
      type: optional(Type.String()),
      message: optional(Type.String()),
      raw: Type.String(),
    }),
  ),
  fatal_errors: strings,
  limits: Type.Record(Type.String(), Type.Object({ used: number, limit: number })),
  counts: Type.Object({
    user_debug: number,
    exceptions: number,
    fatal_errors: number,
    soql: optional(number),
    dml: optional(number),
    cpu_ms: optional(number),
    heap_bytes: optional(number),
  }),
});
const logData = Type.Object(
  {
    ...commonDetails,
    log_digest: optional(log),
    log: optional(record),
    log_id: optional(Type.String()),
  },
  { additionalProperties: true },
);
const traceData = Type.Object(
  {
    ...commonDetails,
    user_id: optional(Type.String()),
    trace_flag_ids: optional(strings),
    stopped_trace_flag_ids: optional(strings),
    active_trace_flags: optional(records),
    debug_level_id: optional(Type.String()),
    expires_at: optional(Type.String()),
  },
  { additionalProperties: true },
);
const candidate = Type.Object(
  {
    Id: optional(Type.String()),
    Name: Type.String(),
    NamespacePrefix: optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: true },
);
const testData = Type.Object(
  {
    ...commonDetails,
    async_job_id: optional(Type.String()),
    summary: optional(Type.Object({ total: number, passing: number, failing: number })),
    test_result_summary: optional(
      Type.Object(
        {
          outcome: optional(Type.String()),
          testRunId: optional(Type.String()),
          testsRan: optional(number),
          passing: optional(number),
          failing: optional(number),
        },
        { additionalProperties: true },
      ),
    ),
    tests_sample: optional(records),
    setup_sample: optional(records),
    codecoverage_sample: optional(records),
    counts: optional(Type.Object({ tests: number, setup: number, codecoverage: number })),
    include_coverage: optional(Type.Boolean()),
    timed_out: optional(Type.Boolean()),
    report_artifacts: optional(Type.Array(artifact)),
  },
  { additionalProperties: true },
);

/** Schemas describe domain data; error outcomes may contain only partial evidence. */
export const apexDetailsSchemas = {
  status: Type.Object(
    {
      ...commonDetails,
      api_version: optional(Type.String()),
      user_id: optional(Type.String()),
      active_trace_flags: optional(records),
    },
    { additionalProperties: true },
  ),
  "org.preflight": Type.Object(
    {
      ...commonDetails,
      api_version: optional(Type.String()),
      user_id: optional(Type.String()),
      active_trace_flags: optional(records),
      apex_class_probe: optional(number),
      recent_test_jobs: optional(records),
    },
    { additionalProperties: true },
  ),
  "apex.search": Type.Object(
    {
      ...commonDetails,
      query: optional(Type.String()),
      classes: optional(records),
      triggers: optional(records),
    },
    { additionalProperties: true },
  ),
  "test.discover": Type.Object(
    {
      ...commonDetails,
      hints: optional(strings),
      candidates: optional(Type.Array(candidate)),
      flow_tests_omitted: optional(number),
      discovery_mode: optional(Type.String()),
    },
    { additionalProperties: true },
  ),
  "test.plan": Type.Object(
    {
      ...commonDetails,
      hints: optional(strings),
      candidates: optional(Type.Array(candidate)),
      primary: optional(candidate),
    },
    { additionalProperties: true },
  ),
  "test.suites": Type.Object(
    {
      ...commonDetails,
      suites: optional(
        Type.Array(
          Type.Object({ id: Type.String(), name: Type.String(), members: optional(records) }),
        ),
      ),
      counts: optional(Type.Object({ suites: number, members: number })),
    },
    { additionalProperties: true },
  ),
  "coverage.summary": Type.Object(
    {
      ...commonDetails,
      targets: optional(strings),
      org_wide: optional(Type.Object({ percent_covered: number })),
      threshold_percent: optional(number),
      coverage: optional(
        Type.Array(
          Type.Object({
            apex_id: Type.String(),
            name: Type.String(),
            covered: number,
            uncovered: number,
            total: number,
            pct: number,
            type: optional(Type.String()),
            covered_lines: optional(Type.Array(number)),
            uncovered_lines: optional(Type.Array(number)),
          }),
        ),
      ),
      counts: optional(Type.Object({ targets: number, below_threshold: number })),
    },
    { additionalProperties: true },
  ),
  "author.plan": Type.Object(
    {
      ...commonDetails,
      targets: optional(strings),
      intent: optional(Type.String()),
      likely_tests: optional(strings),
    },
    { additionalProperties: true },
  ),
  "diagnose.file": Type.Object(
    {
      ...commonDetails,
      file: optional(Type.String()),
      status: optional(Type.String()),
      counts: optional(Type.Object({ errors: number, warnings: number, total: number })),
      diagnostics: optional(Type.Array(diagnostic)),
      unavailable: optional(
        Type.Object({
          language: Type.String(),
          available: Type.Boolean(),
          detail: Type.String(),
          source: optional(Type.String()),
          command: optional(Type.String()),
        }),
      ),
    },
    { additionalProperties: true },
  ),
  "apex.source.get": Type.Object(
    {
      ...commonDetails,
      targets: optional(strings),
      sources: optional(
        Type.Array(
          Type.Object({
            id: Type.String(),
            name: Type.String(),
            full_name: Type.String(),
            type: Type.String(),
            status: optional(Type.String()),
            body_length: number,
            hidden: Type.Boolean(),
            empty: Type.Boolean(),
            artifact: optional(artifact),
          }),
        ),
      ),
    },
    { additionalProperties: true },
  ),
  "trace.start": traceData,
  "trace.stop": traceData,
  "trace.status": traceData,
  "log.latest": logData,
  "log.get": logData,
  "log.analyze": logData,
  "log.watch": logData,
  "anon.run": Type.Object(
    {
      ...commonDetails,
      result: optional(
        Type.Object({
          compiled: Type.Boolean(),
          success: Type.Boolean(),
          line: optional(number),
          column: optional(number),
          compileProblem: optional(Type.String()),
          exceptionMessage: optional(Type.String()),
          exceptionStackTrace: optional(Type.String()),
          logs: Type.String(),
        }),
      ),
      risk: optional(Type.Object({ mutating: Type.Boolean(), reasons: strings })),
      log_digest: optional(log),
    },
    { additionalProperties: true },
  ),
  "test.run": testData,
  "test.result": testData,
  "test.rerun": testData,
} satisfies Record<SfApexAction, TSchema>;

export type ApexDetails<A extends SfApexAction = SfApexAction> = {
  [K in SfApexAction]: Static<(typeof apexDetailsSchemas)[K]>;
}[A];
