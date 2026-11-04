/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fin-as-code procedure lifecycle: validate (local), draft upload, simulate.
 *
 * - `validateProcedureFile` parses the YAML and checks it against the
 *   workspace's own `.fin/schema/procedure.json` (from `sdk download`), plus
 *   SF Fin draft rules. No network.
 * - `uploadProcedureDraft` refuses files that set `state` (so nothing is
 *   published by upload), refuses edits without `version`, validates first,
 *   then runs `intercom fin procedures upload --verify` after the Fin SDK gate.
 * - `simulateProcedure` runs `simulations generate` (optional), `run`, and
 *   polls `result` for each enqueued run.
 *
 * Every CLI call goes through `runFinCli` (token in child env only) and only
 * after `ensureFinSdkEnabled`, so the CLI's silent SDK auto-enable never fires.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import * as JsonSchema from "typebox/schema";
import { parse, parseDocument } from "yaml";
import { procedureDrift } from "./procedure-normalize.ts";
import type { FinCredential } from "./auth.ts";
import { classifyCliResult, readCliErrorMessage, type CliRunResult } from "./cli-runner.ts";
import { ensureFinSdkEnabled, type SdkReadDeps } from "./sdk-reads.ts";

const SIMULATION_POLL_MS = 3_000;
const SIMULATION_MAX_WAIT_MS = 180_000;
/** `generate` returns before tests are materialized; wait this long for them. */
const GENERATE_SETTLE_MS = 60_000;
const MAX_TRANSIENT_POLL_ERRORS = 3;

interface SchemaError {
  keyword: string;
  instancePath: string;
  message?: string;
  params?: { additionalProperties?: string[] };
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ProcedureValidation {
  ok: boolean;
  file: string;
  name?: string;
  id?: string | number;
  issues: ValidationIssue[];
  schemaPath?: string;
}

/** Locate the downloaded workspace schema: `<sdk dir>/resources/.fin/schema/procedure.json`. */
export function procedureSchemaPath(sdkDir: string): string {
  return path.join(sdkDir, "resources", ".fin", "schema", "procedure.json");
}

export function simulationSchemaPath(sdkDir: string): string {
  return path.join(sdkDir, "resources", ".fin", "schema", "simulation.json");
}

export function validateProcedureFile(file: string, schemaPath: string): ProcedureValidation {
  return validateYamlFile(file, schemaPath, draftRuleIssues);
}

/**
 * A `simulation_set` file: `{ type: simulation_set, procedure_id, tests: [...] }`.
 * The public Fin CLI accepts sets only; each test is checked against the
 * workspace `simulation.json` (which describes one `simulation_test`).
 */
export function validateSimulationSetFile(file: string, schemaPath: string): ProcedureValidation {
  const set = validateYamlFile(file, undefined, simulationSetRuleIssues);
  if (!set.ok || !existsSync(schemaPath)) {
    return existsSync(schemaPath)
      ? set
      : {
          ...set,
          ok: false,
          issues: [
            ...set.issues,
            {
              path: "/",
              message:
                "Workspace schema not found. Run sf_fin action='sdk' operation='download' first.",
            },
          ],
        };
  }
  const doc = parse(readFileSync(file, "utf8")) as { tests?: unknown[]; procedure_id?: unknown };
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Parameters<
    typeof JsonSchema.Check
  >[0];
  const issues: ValidationIssue[] = [];
  (doc.tests ?? []).forEach((test, index) => {
    if (!JsonSchema.Check(schema, test)) {
      for (const issue of schemaIssues(schema, test).slice(0, 5)) {
        issues.push({
          path: `/tests/${index}${issue.path === "/" ? "" : issue.path}`,
          message: issue.message,
        });
      }
    }
    issues.push(
      ...simulationTestRuleIssues(test, doc.procedure_id).map((issue) => ({
        path: `/tests/${index}${issue.path}`,
        message: issue.message,
      })),
    );
  });
  return { ...set, ok: issues.length === 0, issues, schemaPath };
}

export function simulationSetRuleIssues(record: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (record.type !== "simulation_set") {
    issues.push({
      path: "/type",
      message:
        "Use `type: simulation_set` with a `tests:` list (the public CLI accepts sets only).",
    });
  }
  if (!isNumericId(record.procedure_id)) {
    issues.push({
      path: "/procedure_id",
      message:
        "Set procedure_id to the numeric id returned by sdk upload (upload the procedure first).",
    });
  }
  if (!Array.isArray(record.tests) || record.tests.length === 0) {
    issues.push({ path: "/tests", message: "Add at least one simulation_test under `tests:`." });
  }
  return issues;
}

/** Rules learned from the live API that the JSON Schema does not express. */
export function simulationTestRuleIssues(
  test: unknown,
  setProcedureId: unknown,
): ValidationIssue[] {
  const record = (test && typeof test === "object" ? test : {}) as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  if (record.type !== "simulation_test")
    issues.push({ path: "/type", message: "Each test needs `type: simulation_test`." });
  if (record.procedure_id !== undefined && String(record.procedure_id) !== String(setProcedureId)) {
    issues.push({
      path: "/procedure_id",
      message: "Test procedure_id must match the set's procedure_id.",
    });
  }
  const assertions = Array.isArray(record.assertions) ? record.assertions : [];
  if (assertions.length === 0)
    issues.push({ path: "/assertions", message: "Add at least one assertion." });
  assertions.forEach((assertion, index) => {
    const attr = (assertion as { attribute?: unknown })?.attribute;
    if (typeof attr === "string" && attr.startsWith("temporary.")) {
      issues.push({
        path: `/assertions/${index}/attribute`,
        message:
          "Fin rejects temporary attributes in attribute assertions; assert on agent_response, outcome, or escalated_to instead.",
      });
    }
  });
  return issues;
}

function isNumericId(value: unknown): boolean {
  return typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value));
}

function validateYamlFile(
  file: string,
  schemaPath: string | undefined,
  extraRules: (record: Record<string, unknown>) => ValidationIssue[],
): ProcedureValidation {
  const issues: ValidationIssue[] = [];
  if (!existsSync(file)) {
    return { ok: false, file, issues: [{ path: "/", message: "File not found." }] };
  }
  if (schemaPath !== undefined && !existsSync(schemaPath)) {
    return {
      ok: false,
      file,
      issues: [
        {
          path: "/",
          message:
            "Workspace schema not found. Run sf_fin action='sdk' operation='download' first.",
        },
      ],
    };
  }

  let doc: unknown;
  try {
    const parsed = parseDocument(readFileSync(file, "utf8"));
    if (parsed.errors.length > 0) {
      return {
        ok: false,
        file,
        schemaPath,
        issues: parsed.errors.map((e) => ({ path: "/", message: `YAML: ${e.message}` })),
      };
    }
    doc = parsed.toJS();
  } catch (error) {
    return {
      ok: false,
      file,
      schemaPath,
      issues: [{ path: "/", message: `YAML: ${String(error)}` }],
    };
  }

  // TypeBox validates raw JSON Schema, so no extra validator dependency is needed.
  if (schemaPath !== undefined) {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Parameters<
      typeof JsonSchema.Check
    >[0];
    if (!JsonSchema.Check(schema, doc)) issues.push(...schemaIssues(schema, doc));
  }

  const record = (doc && typeof doc === "object" ? doc : {}) as Record<string, unknown>;
  issues.push(...extraRules(record));
  return {
    ok: issues.length === 0,
    file,
    schemaPath,
    name: typeof record.name === "string" ? record.name : undefined,
    id: typeof record.id === "string" || typeof record.id === "number" ? record.id : undefined,
    issues,
  };
}

/** SF Fin rules on top of the schema: drafts only, versioned edits. */
export function draftRuleIssues(record: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (record.state !== undefined) {
    issues.push({
      path: "/state",
      message: "Remove `state`. SF Fin uploads drafts only; publish is a separate, explicit step.",
    });
  }
  const isNew = record.id === undefined || record.id === "new";
  if (!isNew && (record.version === undefined || record.version === null)) {
    issues.push({
      path: "/version",
      message:
        "Editing an existing procedure requires its current `version` (prevents overwriting other edits).",
    });
  }
  return issues;
}

function schemaIssues(
  schema: Parameters<typeof JsonSchema.Check>[0],
  value: unknown,
): ValidationIssue[] {
  const [, rawErrors] = JsonSchema.Errors(schema, value) as unknown as [boolean, SchemaError[]];
  // oneOf branches produce many errors; report the most specific paths first.
  const errors = [...(rawErrors ?? [])]
    .filter((e) => e.keyword !== "boolean")
    .sort((a, b) => b.instancePath.length - a.instancePath.length);
  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];
  for (const e of errors) {
    const extra = e.params?.additionalProperties?.join(", ");
    const key = `${e.instancePath}|${e.message}|${extra ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      path: e.instancePath || "/",
      message: `${e.message ?? e.keyword}${extra ? ` (${extra})` : ""}`,
    });
    if (issues.length >= 15) break;
  }
  return issues;
}

export function formatValidation(result: ProcedureValidation): string {
  if (result.ok) {
    return `✅ ${result.name ?? path.basename(result.file)} is valid against the workspace schema and SF Fin rules.`;
  }
  return [
    `❌ ${result.issues.length} issue${result.issues.length === 1 ? "" : "s"} in ${result.file}`,
    ...result.issues.map((issue) => `  ${issue.path} — ${issue.message}`),
  ].join("\n");
}

export interface UploadResult {
  ok: boolean;
  text: string;
  procedureId?: string;
  verified?: boolean;
  details: Record<string, unknown>;
}

export async function uploadProcedureDraft(
  credential: FinCredential,
  deps: SdkReadDeps,
  input: { file: string; schemaPath: string; note?: string },
  signal?: AbortSignal,
): Promise<UploadResult> {
  const validation = validateProcedureFile(input.file, input.schemaPath);
  if (!validation.ok) {
    return {
      ok: false,
      text: formatValidation(validation),
      details: { phase: "validate", issues: validation.issues },
    };
  }
  const ensured = await ensureFinSdkEnabled(credential, deps, signal);
  if (!ensured.ok) return { ok: false, text: ensured.message, details: { phase: "enable" } };

  // SF Fin verifies semantically itself (see procedure-normalize.ts); the CLI's
  // raw `--verify` reports false drift because Fin canonicalizes on save.
  const sentYaml = readFileSync(input.file, "utf8");
  const args = ["fin", "procedures", "upload", realpathSync(input.file), "--json"];
  if (input.note?.trim()) args.push("--note", input.note.trim());
  const result = await deps.run(args, { credential, signal, timeoutMs: 120_000 });
  const outcome = classifyCliResult(result);
  const response = parseJson(result.stdout);
  const procedureId = stringId(response?.id);
  if (outcome !== "ok") {
    const message = readCliErrorMessage(result) ?? "intercom fin procedures upload failed.";
    const mismatch = /version mismatch: expected (\d+), got (\d+)/i.exec(message);
    return {
      ok: false,
      procedureId,
      text: mismatch
        ? `❌ Version mismatch: the procedure was saved again since this file was written (latest ${mismatch[1]}, file ${mismatch[2]}). Review the latest copy, set \`version: ${mismatch[1]}\`, then upload again.`
        : `❌ Upload failed: ${message}`,
      details: {
        phase: "upload",
        outcome,
        procedureId,
        ...(mismatch ? { latestVersion: mismatch[1] } : {}),
      },
    };
  }

  const savedYaml =
    typeof response?.new_file_content === "string" ? response.new_file_content : undefined;
  if (!savedYaml) {
    return {
      ok: false,
      procedureId,
      text: `⚠ Uploaded${procedureId ? ` as procedure ${procedureId}` : ""}, but Fin returned no saved content to verify.`,
      details: { phase: "verify", procedureId },
    };
  }
  let drift: string[];
  try {
    drift = procedureDrift(parse(sentYaml), parse(savedYaml));
  } catch (error) {
    drift = [`(could not compare: ${error instanceof Error ? error.message : String(error)})`];
  }
  const savedDoc = parseYamlSafe(savedYaml) as Record<string, unknown> | undefined;
  const savedState = stringValue(savedDoc?.state);
  const savedVersion = stringId(savedDoc?.version);
  if (drift.length > 0) {
    return {
      ok: false,
      procedureId,
      verified: false,
      text: [
        `⚠ Uploaded${procedureId ? ` as procedure ${procedureId}` : ""}, but ${drift.length} field${drift.length === 1 ? "" : "s"} changed meaning on save:`,
        ...drift.slice(0, 20).map((p) => `  ${p}`),
        `Compare with: intercom fin procedures get ${procedureId ?? "<id>"}`,
      ].join("\n"),
      details: { phase: "verify", procedureId, drift, savedState },
    };
  }
  return {
    ok: true,
    procedureId,
    verified: true,
    text: [
      `✅ Uploaded draft "${validation.name ?? path.basename(input.file)}"${procedureId ? ` as procedure ${procedureId}` : ""}; the saved procedure is semantically identical to the file.`,
      `State on Fin: ${savedState ?? "unknown"}. It is not published; publishing remains a separate explicit step.`,
      savedVersion
        ? `Next edit: set \`id: ${procedureId}\` and \`version: ${savedVersion}\` in the file.`
        : undefined,
      ensured.enabledNow ? `🔓 ${ensured.message}` : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
    details: {
      phase: "upload",
      procedureId,
      verified: true,
      savedState,
      savedVersion,
      message: stringValue(response?.message),
    },
  };
}

function parseYamlSafe(text: string): unknown {
  try {
    return parse(text);
  } catch {
    return undefined;
  }
}

export async function uploadSimulationSet(
  credential: FinCredential,
  deps: SdkReadDeps,
  input: { file: string; schemaPath: string },
  signal?: AbortSignal,
): Promise<UploadResult> {
  const validation = validateSimulationSetFile(input.file, input.schemaPath);
  if (!validation.ok) {
    return {
      ok: false,
      text: formatValidation(validation),
      details: { phase: "validate", issues: validation.issues },
    };
  }
  const ensured = await ensureFinSdkEnabled(credential, deps, signal);
  if (!ensured.ok) return { ok: false, text: ensured.message, details: { phase: "enable" } };
  // Tests carrying an `id` update that test; tests without one are added.
  const result = await deps.run(
    ["fin", "simulations", "upload", realpathSync(input.file), "--json"],
    {
      credential,
      signal,
      timeoutMs: 120_000,
    },
  );
  const response = parseJson(result.stdout);
  if (classifyCliResult(result) !== "ok") {
    return {
      ok: false,
      text: `❌ Simulation upload failed: ${readCliErrorMessage(result) ?? "upload failed."}`,
      details: { phase: "upload" },
    };
  }
  const saved =
    typeof response?.new_file_content === "string"
      ? (parseYamlSafe(response.new_file_content) as
          { tests?: Array<{ id?: unknown; name?: unknown }> } | undefined)
      : undefined;
  const tests = (saved?.tests ?? []).map((t) => ({
    id: stringId(t.id),
    name: stringValue(t.name),
  }));
  const counts = new Map<string, number>();
  for (const t of tests) if (t.name) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  const duplicates = [...counts].filter(([, n]) => n > 1).map(([name]) => name);
  return {
    ok: true,
    procedureId: stringId(response?.id),
    text: [
      `✅ Procedure ${stringId(response?.id) ?? "?"} now has ${tests.length} simulation${tests.length === 1 ? "" : "s"}.`,
      ...tests.map((t) => `  • ${t.name ?? "(unnamed)"}${t.id ? ` [${t.id}]` : ""}`),
      duplicates.length
        ? `⚠ Tests without an \`id\` are added, not matched by name, so these now appear more than once: ${duplicates.join("; ")}. Uploads add or update tests but never delete them; include each test's \`id\` to update it in place, and remove extras in Fin.`
        : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
    details: { phase: "upload", tests, duplicates, message: stringValue(response?.message) },
  };
}

export interface SimulationRunSummary {
  runId: string;
  testId?: string;
  name?: string;
  status: string;
  passed?: boolean;
  failures?: string[];
}

export interface SimulateResult {
  ok: boolean;
  text: string;
  runs: SimulationRunSummary[];
  details: Record<string, unknown>;
}

export async function simulateProcedure(
  credential: FinCredential,
  deps: SdkReadDeps & { sleep?: (ms: number) => Promise<void> },
  input: { procedureId: string; generate: boolean; maxWaitMs?: number; generateSettleMs?: number },
  signal?: AbortSignal,
): Promise<SimulateResult> {
  if (!/^[A-Za-z0-9_-]+$/.test(input.procedureId)) {
    return {
      ok: false,
      runs: [],
      text: "procedure_id must be an exact Fin procedure id.",
      details: { phase: "input" },
    };
  }
  const ensured = await ensureFinSdkEnabled(credential, deps, signal);
  if (!ensured.ok)
    return { ok: false, runs: [], text: ensured.message, details: { phase: "enable" } };

  const call = (args: string[]) =>
    deps.run([...args, "--json"], { credential, signal, timeoutMs: 120_000 });
  const lines: string[] = [];

  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const countTests = async (): Promise<number | undefined> => {
    // `simulations list` prints the YAML simulation set (no --json form).
    const listed = await deps.run(["fin", "simulations", "list", input.procedureId], {
      credential,
      signal,
      timeoutMs: 60_000,
    });
    if (classifyCliResult(listed) !== "ok") return undefined;
    try {
      const set = parse(listed.stdout) as { tests?: unknown[] } | null;
      return Array.isArray(set?.tests) ? set.tests.length : 0;
    } catch {
      return undefined;
    }
  };

  // Fin only runs live procedures in simulations. A draft (never published)
  // produces "no procedure instructions" runs, so warn before spending runs.
  const state = await readProcedureState(credential, deps, input.procedureId, signal);
  if (state.state === "draft") {
    lines.push(
      `⚠ Procedure ${input.procedureId} is a draft. Fin only runs live procedures in simulations, so these runs will not follow its steps. Publish it with sdk operation='publish' (and pause it again afterwards) to test it.`,
    );
  }

  const before = await countTests();
  if (input.generate) {
    const generated = await call(["fin", "simulations", "generate", input.procedureId]);
    if (classifyCliResult(generated) !== "ok") {
      return failure("generate", generated, lines);
    }
    // Generation completes asynchronously; wait for new tests to appear. The
    // bound is an attempt count (not wall time) so it holds even if a clock or
    // sleep is replaced.
    const settleMs = input.generateSettleMs ?? GENERATE_SETTLE_MS;
    const maxPolls = Math.max(1, Math.ceil(settleMs / SIMULATION_POLL_MS));
    let after = await countTests();
    for (let poll = 0; (after ?? 0) <= (before ?? 0) && poll < maxPolls; poll++) {
      await sleep(SIMULATION_POLL_MS);
      after = await countTests();
    }
    const added = (after ?? 0) - (before ?? 0);
    lines.push(
      added > 0
        ? `🧪 Generated ${added} simulation${added === 1 ? "" : "s"} (${after} total).`
        : `🧪 Generation reported ${stringValue(parseJson(generated.stdout)?.status) ?? "done"} but produced no tests within ${Math.round((input.generateSettleMs ?? GENERATE_SETTLE_MS) / 1000)}s. Fin may need knowledge content to generate from; upload a hand-written simulation set with sdk operation='upload_simulations'.`,
    );
  }

  const started = await call(["fin", "simulations", "run", input.procedureId]);
  if (classifyCliResult(started) !== "ok") return failure("run", started, lines);
  const startedJson = parseJson(started.stdout) ?? {};
  const enqueued = Array.isArray(startedJson.enqueued)
    ? (startedJson.enqueued as Array<Record<string, unknown>>)
    : startedJson.run_id !== undefined
      ? [startedJson]
      : [];
  if (enqueued.length === 0) {
    lines.push(
      "No simulations to run for this procedure. Upload a set with sdk operation='upload_simulations' (or retry generate after adding knowledge content).",
    );
    return { ok: false, runs: [], text: lines.join("\n"), details: { phase: "run", enqueued: 0 } };
  }

  const deadline = Date.now() + (input.maxWaitMs ?? SIMULATION_MAX_WAIT_MS);
  const maxResultPolls = Math.ceil(
    (input.maxWaitMs ?? SIMULATION_MAX_WAIT_MS) / SIMULATION_POLL_MS,
  );
  const runs: SimulationRunSummary[] = [];
  for (const entry of enqueued) {
    const runId = stringId(entry.run_id);
    if (!runId) continue;
    let result: Record<string, unknown>;
    let polls = 0;
    let transientErrors = 0;
    for (;;) {
      const polled = await call(["fin", "simulations", "result", runId]);
      if (classifyCliResult(polled) !== "ok") {
        // A transient network error during a long poll is retried a few times.
        if (isTransient(polled) && ++transientErrors <= MAX_TRANSIENT_POLL_ERRORS) {
          await sleep(SIMULATION_POLL_MS);
          continue;
        }
        return failure("result", polled, lines);
      }
      result = parseJson(polled.stdout) ?? {};
      const status = stringValue(result.status) ?? "unknown";
      if (status !== "pending" && status !== "running") break;
      if (Date.now() > deadline || ++polls >= maxResultPolls) break;
      await sleep(SIMULATION_POLL_MS);
    }
    runs.push(summarizeRun(runId, entry, result));
  }

  const passed = runs.filter((run) => run.passed === true).length;
  const done = runs.filter((run) => run.status !== "pending" && run.status !== "running").length;
  lines.push(
    `Simulations: ${passed}/${runs.length} passed${done < runs.length ? ` · ${runs.length - done} still running` : ""}.`,
  );
  for (const run of runs) {
    const icon = run.passed === true ? "✅" : run.passed === false ? "❌" : "⏳";
    lines.push(`${icon} ${run.name ?? run.testId ?? run.runId} — ${run.status}`);
    for (const failureLine of run.failures ?? []) lines.push(`    ${failureLine}`);
  }
  return {
    ok: runs.length > 0 && passed === runs.length,
    text: lines.join("\n"),
    runs,
    details: {
      phase: "result",
      procedureId: input.procedureId,
      passed,
      total: runs.length,
      procedureState: state.state,
    },
  };
}

export type ProcedureState = "draft" | "live" | "paused";
export type ProcedureStateTarget = "live" | "paused";

/** Read a procedure's current state and version through the Fin CLI. */
export async function readProcedureState(
  credential: FinCredential,
  deps: SdkReadDeps,
  procedureId: string,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  state?: ProcedureState;
  version?: string;
  name?: string;
  error?: string;
}> {
  const result = await deps.run(["fin", "procedures", "get", procedureId], {
    credential,
    signal,
    timeoutMs: 60_000,
  });
  if (classifyCliResult(result) !== "ok") {
    return {
      ok: false,
      error: readCliErrorMessage(result) ?? "intercom fin procedures get failed.",
    };
  }
  const doc = parseYamlSafe(result.stdout) as Record<string, unknown> | undefined;
  const state = stringValue(doc?.state);
  return {
    ok: true,
    state: state === "draft" || state === "live" || state === "paused" ? state : undefined,
    version: stringId(doc?.version),
    name: stringValue(doc?.name),
  };
}

export interface StateChangeResult {
  ok: boolean;
  text: string;
  details: Record<string, unknown>;
}

/**
 * Publish (`live`) or pause a procedure. Without `execute` this only plans:
 * it reads the current state and reports the transition. With `execute` it
 * runs `intercom fin procedures publish|pause` and verifies the resulting
 * state. Fin never moves a procedure back to `draft`; `paused` is the way to
 * take a live procedure offline.
 */
export async function setProcedureState(
  credential: FinCredential,
  deps: SdkReadDeps,
  input: { procedureId: string; target: ProcedureStateTarget; execute: boolean; note?: string },
  signal?: AbortSignal,
): Promise<StateChangeResult> {
  const verb = input.target === "live" ? "publish" : "pause";
  if (!/^[0-9]+$/.test(input.procedureId)) {
    return {
      ok: false,
      text: `${verb} requires procedure_id: an exact numeric Fin procedure id.`,
      details: { phase: "input" },
    };
  }
  const ensured = await ensureFinSdkEnabled(credential, deps, signal);
  if (!ensured.ok) return { ok: false, text: ensured.message, details: { phase: "enable" } };

  const current = await readProcedureState(credential, deps, input.procedureId, signal);
  if (!current.ok || !current.state) {
    return {
      ok: false,
      text: `❌ Could not read procedure ${input.procedureId}: ${current.error ?? "no state returned."}`,
      details: { phase: "read", procedureId: input.procedureId },
    };
  }
  const label = `"${current.name ?? input.procedureId}" (${input.procedureId})`;
  const base = { procedureId: input.procedureId, from: current.state, to: input.target };
  if (current.state === input.target) {
    return {
      ok: true,
      text: `Procedure ${label} is already ${current.state}; nothing to change.`,
      details: { phase: "noop", ...base },
    };
  }
  if (input.target === "paused" && current.state === "draft") {
    return {
      ok: false,
      text: `Procedure ${label} is a draft, which is already unpublished; pausing applies only to a live procedure.`,
      details: { phase: "refused", ...base },
    };
  }
  const effect =
    input.target === "live"
      ? "Fin will start using it for matching customer conversations on its targeted channels."
      : "Fin will stop using it for customer conversations. It can be published again later; it cannot return to draft.";
  if (!input.execute) {
    return {
      ok: true,
      text: [
        `Plan: ${verb} procedure ${label} — ${current.state} → ${input.target}.`,
        effect,
        `To proceed, call sf_fin action='sdk' operation='${verb}' procedure_id='${input.procedureId}' allow_mutation=true (SF Guardrail mediates it).`,
      ].join("\n"),
      details: { phase: "plan", ...base, version: current.version },
    };
  }

  const args = ["fin", "procedures", verb, input.procedureId, "--json"];
  if (input.note?.trim()) args.push("--note", input.note.trim());
  const result = await deps.run(args, { credential, signal, timeoutMs: 120_000 });
  if (classifyCliResult(result) !== "ok") {
    return {
      ok: false,
      text: `❌ ${verb} failed: ${readCliErrorMessage(result) ?? `intercom fin procedures ${verb} failed.`}`,
      details: { phase: "execute", ...base },
    };
  }
  const saved = parseYamlSafe(stringValue(parseJson(result.stdout)?.new_file_content) ?? "") as
    Record<string, unknown> | undefined;
  const after = stringValue(saved?.state);
  const version = stringId(saved?.version);
  if (after !== input.target) {
    return {
      ok: false,
      text: `⚠ Fin accepted the ${verb} request for ${label}, but reports state ${after ?? "unknown"} instead of ${input.target}. Check it with sdk operation='manifest'.`,
      details: { phase: "verify", ...base, observed: after, version },
    };
  }
  return {
    ok: true,
    text: [
      `✅ Procedure ${label} is now ${after} (was ${current.state}).`,
      effect,
      version
        ? `Next edit: set \`version: ${version}\` in the file; leave \`state\` out so uploads keep the current state.`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
    details: { phase: "execute", ...base, observed: after, version },
  };
}

function summarizeRun(
  runId: string,
  entry: Record<string, unknown>,
  result: Record<string, unknown>,
): SimulationRunSummary {
  const status = stringValue(result.status) ?? "unknown";
  const passed =
    status === "passed" ? true : status === "failed" || status === "error" ? false : undefined;
  const failures: string[] = [];
  const assertions = Array.isArray(result.assertions_results) ? result.assertions_results : [];
  for (const raw of assertions as Array<Record<string, unknown>>) {
    const global = (raw?.global && typeof raw.global === "object" ? raw.global : {}) as Record<
      string,
      unknown
    >;
    if (stringValue(global.status) !== "failed") continue;
    const type = stringValue(raw.assertion_type) ?? "assertion";
    const details = Array.isArray(global.assertion_results)
      ? (global.assertion_results as Array<Record<string, unknown>>)
      : [];
    const failed = details.filter((d) => d.passed === false);
    if (failed.length === 0) {
      failures.push(`${type} failed`);
      continue;
    }
    for (const d of failed) {
      const what = stringValue(d.assertion);
      const why = stringValue(d.thoughts);
      failures.push(
        `${type}${what ? ` "${what}"` : ""} failed${why ? ` — ${why.slice(0, 240)}` : ""}`,
      );
    }
  }
  const reason = stringValue(result.failure_reason) ?? stringValue(result.error);
  if (reason) failures.push(reason.slice(0, 300));
  return {
    runId,
    testId: stringId(entry.test_id ?? result.test_id),
    name: stringValue(entry.simulation_name) ?? stringValue(result.simulation_name),
    status,
    passed,
    failures,
  };
}

function isTransient(result: CliRunResult): boolean {
  if (result.timedOut) return true;
  const text = `${result.stderr}\n${result.stdout}`;
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network/i.test(text);
}

function failure(phase: string, result: CliRunResult, lines: string[]): SimulateResult {
  lines.push(`❌ simulations ${phase} failed: ${readCliErrorMessage(result) ?? "unknown error"}`);
  return {
    ok: false,
    runs: [],
    text: lines.join("\n"),
    details: { phase, outcome: classifyCliResult(result) },
  };
}

function parseJson(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function stringId(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
