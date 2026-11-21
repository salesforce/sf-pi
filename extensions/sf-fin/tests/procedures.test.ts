/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFinSdkState } from "../../../lib/common/fin-sdk-state.ts";
import type { FinCredential } from "../lib/auth.ts";
import type { CliRunResult } from "../lib/cli-runner.ts";
import { procedureDrift } from "../lib/procedure-normalize.ts";
import { readProcedureVersions } from "../lib/sdk-gate.ts";
import {
  draftRuleIssues,
  formatValidation,
  setProcedureState,
  simulationSetRuleIssues,
  simulationTestRuleIssues,
  uploadSimulationSet,
  simulateProcedure,
  uploadProcedureDraft,
  validateProcedureFile,
} from "../lib/sdk-procedures.ts";
import type { SdkReadDeps } from "../lib/sdk-reads.ts";

const SCHEMA = path.join(import.meta.dirname, "fixtures", "procedure-schema.json");
const SENTINEL = "fin-sentinel-token-0000";
const credential: FinCredential = { token: SENTINEL, source: "pi-auth", region: "us" };
const GOOD = `id: new
name: Answer Example Questions
trigger_description: Use when a customer asks an example question.
targeting:
  channels: [web]
procedure:
  main:
    - Ask the customer what they need and store it in <write attr="temporary.need" />
    - type: decide
      condition_type: natural_language
      if: the customer still needs help
      then:
        - type: escalate
          escalate: Customer still needs help
      else:
        - Confirm the question is answered
`;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sf-fin-proc-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", dir);
  writeFinSdkState({ state: "enabled", appId: "example" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, body: string): string {
  const p = path.join(dir, name);
  writeFileSync(p, body, "utf8");
  return p;
}

function cli(stdout = "", exitCode = 0, stderr = ""): CliRunResult {
  return { exitCode, stdout, stderr, timedOut: false, truncated: false };
}

/** Enabled-workspace fetch: the SDK gate probe returns 200. */
const enabledFetch = vi.fn(
  async () => new Response(JSON.stringify({ procedures: [] }), { status: 200 }),
);

function deps(run: ReturnType<typeof vi.fn>): SdkReadDeps & { sleep: () => Promise<void> } {
  return {
    run: run as unknown as SdkReadDeps["run"],
    exec: vi.fn(),
    fetch: enabledFetch,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    appId: "example",
    sleep: async () => undefined,
  };
}

describe("validateProcedureFile", () => {
  it("accepts a schema-valid draft", () => {
    const result = validateProcedureFile(file("p.yaml", GOOD), SCHEMA);
    expect(result).toMatchObject({ ok: true, name: "Answer Example Questions", issues: [] });
  });

  it("reports schema errors with paths, and YAML syntax errors", () => {
    const bad = validateProcedureFile(
      file("bad.yaml", GOOD.replace("targeting:\n  channels: [web]\n", "") + "bogus: 1\n"),
      SCHEMA,
    );
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i) => i.message).join(" ")).toMatch(/targeting|additional/);
    const yaml = validateProcedureFile(file("yaml.yaml", "name: [unclosed\n"), SCHEMA);
    expect(yaml.issues[0]?.message).toMatch(/^YAML/);
  });

  it("enforces SF Fin draft rules: no state, version for edits", () => {
    expect(draftRuleIssues({ id: "new", state: "live" })[0]?.path).toBe("/state");
    expect(draftRuleIssues({ id: 123 })[0]?.path).toBe("/version");
    expect(draftRuleIssues({ id: 123, version: 4 })).toEqual([]);
    const withState = validateProcedureFile(file("s.yaml", `${GOOD}state: live\n`), SCHEMA);
    expect(withState.ok).toBe(false);
    expect(withState.issues.some((i) => i.path === "/state")).toBe(true);
  });

  it("warns, without failing, that api, inbox, and button_click triggers need Fin UI settings", () => {
    const schema = file(
      "open-schema.json",
      JSON.stringify({ type: "object", required: ["name"], additionalProperties: true }),
    );
    const result = validateProcedureFile(
      file("t.yaml", `${GOOD}triggers:\n  - type: api\n  - type: event\n`),
      schema,
    );
    expect(result.ok).toBe(true);
    expect(result.warnings?.map((w) => w.path)).toEqual(["/triggers/0"]);
    expect(formatValidation(result)).toContain("Fin behavior");
    expect(validateProcedureFile(file("n.yaml", GOOD), schema).warnings ?? []).toEqual([]);
  });

  it("explains a missing workspace schema", () => {
    const result = validateProcedureFile(file("p.yaml", GOOD), path.join(dir, "missing.json"));
    expect(result.issues[0]?.message).toContain("operation='download'");
  });
});

describe("uploadProcedureDraft", () => {
  it("validates first and never calls the CLI for an invalid or published file", async () => {
    const run = vi.fn(async () => cli("{}"));
    const result = await uploadProcedureDraft(credential, deps(run), {
      file: file("s.yaml", `${GOOD}state: live\n`),
      schemaPath: SCHEMA,
    });
    expect(result.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("uploads without the CLI's raw --verify and verifies semantically", async () => {
    // Fin canonicalizes on save: drops type:, collapses one-item branches,
    // turns an escalate step into text, and adds server fields.
    const saved = `id: 4242
version: 99
state: draft
agentic_switch: false
name: Answer Example Questions
trigger_description: Use when a customer asks an example question.
targeting:
  channels: [web]
procedure:
  main:
  - Ask the customer what they need and store it in <write attr="temporary.need"
    />
  - if: the customer still needs help
    then: Customer still needs help <escalate />
    else: Confirm the question is answered
`;
    const run = vi.fn(async (_args: string[], _options: unknown) =>
      cli(JSON.stringify({ id: 4242, message: "Procedure created", new_file_content: saved })),
    );
    const result = await uploadProcedureDraft(credential, deps(run), {
      file: file("p.yaml", GOOD),
      schemaPath: SCHEMA,
      note: "first draft",
    });
    expect(result).toMatchObject({ ok: true, procedureId: "4242", verified: true });
    const args = run.mock.calls[0]?.[0] as string[];
    expect(args.slice(0, 3)).toEqual(["fin", "procedures", "upload"]);
    expect(args).toEqual(expect.arrayContaining(["--json", "--note", "first draft"]));
    expect(args).not.toContain("--verify");
    expect(args).not.toContain("publish");
    expect(args.join(" ")).not.toContain(SENTINEL);
    expect(result.text).toContain("semantically identical");
    expect(result.text).toContain("State on Fin: draft");
  });

  it("explains a version mismatch with the version to use", async () => {
    const run = vi.fn(async () =>
      cli(
        "",
        1,
        JSON.stringify({
          error: { code: "error", message: "Version mismatch: expected 9, got 7" },
        }),
      ),
    );
    const result = await uploadProcedureDraft(credential, deps(run), {
      file: file("p.yaml", GOOD),
      schemaPath: SCHEMA,
    });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("set `version: 9`");
    expect(result.details).toMatchObject({ latestVersion: "9" });
  });

  it("reports real semantic drift", async () => {
    const saved = `id: 7
name: Answer Example Questions
trigger_description: Use when a customer asks an example question.
targeting:
  channels: [web]
procedure:
  main:
  - Ask the customer what they need
`;
    const run = vi.fn(async () => cli(JSON.stringify({ id: 7, new_file_content: saved })));
    const result = await uploadProcedureDraft(credential, deps(run), {
      file: file("p.yaml", GOOD),
      schemaPath: SCHEMA,
    });
    expect(result).toMatchObject({ ok: false, verified: false, procedureId: "7" });
    expect(result.text).toContain("procedure.main");
  });
});

describe("procedureDrift (semantic normalization)", () => {
  const sent = {
    id: "new",
    name: "N",
    guidance: "Be brief.\n",
    procedure: {
      main: [
        "Step one",
        {
          type: "decide",
          condition_type: "code",
          decide: [{ if: "x == 1", then: ["A"] }],
          else: ["B"],
        },
        {
          type: "decide",
          condition_type: "natural_language",
          if: "c",
          then: [{ type: "escalate", escalate: "R" }],
          else: ["D"],
        },
      ],
    },
  };
  const saved = {
    id: 1,
    version: 3,
    state: "draft",
    agentic_switch: false,
    name: "N",
    guidance: "Be brief.",
    procedure: {
      main: [
        "Step  one",
        { condition_type: "code", decide: [{ if: "x == 1", then: "A" }], else: "B" },
        { if: "c", then: "R <escalate />", else: "D" },
      ],
    },
  };

  it("treats Fin's canonical form as identical", () => {
    expect(procedureDrift(sent, saved)).toEqual([]);
  });

  it("treats the upload response's internal form as identical", () => {
    // `procedures upload` returns Fin's internal form, unlike `procedures get`:
    // instruction steps are `{ instructions, id }` objects with step ids, tools
    // carry ids, and `<read>` gains `type="attribute"`.
    const file = {
      id: 1,
      version: 2,
      name: "N",
      triggers: [],
      procedure: {
        main: [
          'Store it in <write attr="temporary.x" />.',
          'Look it up with <use action="Find thing" /> for <read attr="temporary.x" />.',
          {
            type: "decide",
            condition_type: "natural_language",
            if: "nothing was found",
            then: ["Say so.", { end: "procedure" }],
          },
          {
            type: "decide",
            decide: [{ if: "one was found", then: ["Share it."] }],
            else: ["Hand off <escalate />."],
          },
        ],
      },
    };
    const internal = {
      id: 1,
      version: 3,
      name: "N",
      procedure: {
        main: [
          { instructions: 'Store it in <write attr="temporary.x" />.', id: "a1" },
          {
            instructions:
              'Look it up with <use action="Find thing" id="t-1" /> for <read attr="temporary.x" type="attribute" />.',
            id: "a2",
          },
          {
            id: "a3",
            if: "nothing was found",
            then: [
              { instructions: "Say so.", id: "a4" },
              { end: "procedure", id: "a5" },
            ],
          },
          {
            decide: [{ if: "one was found", then: { instructions: "Share it.", id: "a6" } }],
            else: { instructions: "Hand off <escalate />.", id: "a7" },
            id: "a8",
          },
        ],
      },
    };
    expect(procedureDrift(file, internal)).toEqual([]);
    const changed = structuredClone(internal);
    (changed.procedure.main[0] as { instructions: string }).instructions = "Different.";
    expect(procedureDrift(file, changed)).toEqual(["procedure.main[0]"]);
  });

  it("still flags real changes", () => {
    const changed = structuredClone(saved);
    (changed.procedure.main[1] as { decide: Array<{ if: string }> }).decide[0]!.if = "x == 2";
    changed.name = "Other";
    expect(procedureDrift(sent, changed).sort()).toEqual([
      "name",
      "procedure.main[1].decide[0].if",
    ]);
    const dropped = structuredClone(saved);
    dropped.procedure.main.pop();
    expect(procedureDrift(sent, dropped)).toEqual(["procedure.main"]);
  });
});

describe("simulateProcedure", () => {
  it("generates, runs, polls until done, and summarizes pass/fail", async () => {
    const results: Record<string, unknown[]> = {
      r1: [{ status: "running" }, { status: "passed", assertions_results: [] }],
      r2: [
        {
          status: "failed",
          assertions_results: [
            {
              assertion_type: "agent_response",
              global: {
                status: "failed",
                assertion_results: [
                  { assertion: "reset", passed: false, thoughts: "Agent never mentioned a reset." },
                ],
              },
            },
            {
              assertion_type: "outcome",
              global: {
                status: "failed",
                reason: "Customer aborted conversation: Fin kept asking for the same number.",
              },
            },
          ],
        },
      ],
    };
    let listed = 0;
    const run = vi.fn(async (args: string[]) => {
      const [, , sub, id] = args;
      if (sub === "list") {
        listed += 1;
        // Baseline has 0 tests; after generate the set has 2.
        return cli(
          `type: simulation_set\nprocedure_id: 4242\ntests:${listed === 1 ? " []" : "\n  - id: t1\n  - id: t2"}\n`,
        );
      }
      if (sub === "generate") return cli(JSON.stringify({ status: "generated", procedure_id: id }));
      if (sub === "run")
        return cli(
          JSON.stringify({
            enqueued: [
              { run_id: "r1", test_id: "t1", simulation_name: "Happy path" },
              { run_id: "r2", test_id: "t2", simulation_name: "Escalation" },
            ],
          }),
        );
      if (sub === "result") return cli(JSON.stringify(results[id!]!.shift()));
      return cli("{}", 1);
    });
    const result = await simulateProcedure(credential, deps(run), {
      procedureId: "4242",
      generate: true,
    });
    expect(run.mock.calls.map((c) => (c[0] as string[]).slice(2, 4).join(" "))).toEqual([
      "get 4242",
      "list 4242",
      "generate 4242",
      "list 4242",
      "run 4242",
      "result r1",
      "result r1",
      "result r2",
    ]);
    expect(result.ok).toBe(false);
    expect(result.runs.map((r) => [r.name, r.passed])).toEqual([
      ["Happy path", true],
      ["Escalation", false],
    ]);
    expect(result.text).toContain("1/2 passed");
    expect(result.text).toContain("Generated 2 simulations");
    expect(result.text).toContain('agent_response "reset" failed — Agent never mentioned a reset.');
    // Fin explains an outcome failure in global.reason; surface it.
    expect(result.text).toContain(
      "outcome failed — Customer aborted conversation: Fin kept asking for the same number.",
    );
    // Runs are structured in details so failures can be read without re-running.
    expect((result.details.runs as Array<{ name: string }>).map((r) => r.name)).toEqual([
      "Happy path",
      "Escalation",
    ]);
  });

  it("retries transient network errors while polling, then gives up", async () => {
    let polls = 0;
    const run = vi.fn(async (args: string[]) => {
      const sub = args[2];
      if (sub === "list") return cli("type: simulation_set\ntests: []\n");
      if (sub === "run")
        return cli(JSON.stringify({ enqueued: [{ run_id: "r1", simulation_name: "T" }] }));
      if (sub === "result") {
        polls += 1;
        return polls <= 2
          ? cli("", 1, "Error: fetch failed")
          : cli(JSON.stringify({ status: "passed", assertions_results: [] }));
      }
      return cli("{}", 1);
    });
    const ok = await simulateProcedure(credential, deps(run), {
      procedureId: "4242",
      generate: false,
    });
    expect(ok.ok).toBe(true);
    expect(polls).toBe(3);

    const alwaysDown = vi.fn(async (args: string[]) =>
      args[2] === "run"
        ? cli(JSON.stringify({ enqueued: [{ run_id: "r1" }] }))
        : args[2] === "list"
          ? cli("tests: []\n")
          : cli("", 1, "Error: fetch failed"),
    );
    const down = await simulateProcedure(credential, deps(alwaysDown), {
      procedureId: "4242",
      generate: false,
    });
    expect(down.ok).toBe(false);
    expect(alwaysDown.mock.calls.filter((c) => (c[0] as string[])[2] === "result")).toHaveLength(4);
  });

  it("rejects non-id input and reports when no simulations exist", async () => {
    const run = vi.fn(async () => cli(JSON.stringify({ enqueued: [] })));
    expect(
      (await simulateProcedure(credential, deps(run), { procedureId: "4242; rm", generate: false }))
        .ok,
    ).toBe(false);
    expect(run).not.toHaveBeenCalled();
    const none = await simulateProcedure(credential, deps(run), {
      procedureId: "4242",
      generate: false,
    });
    expect(none.text).toContain("No simulations");
  });
});

describe("simulation sets and generation", () => {
  const SIM_SCHEMA = path.join(import.meta.dirname, "fixtures", "simulation-schema.json");
  const SET = `type: simulation_set
procedure_id: 4242
tests:
  - type: simulation_test
    procedure_id: 4242
    name: Forgot password happy path
    opening_message: I forgot my password
    assertions:
      - outcome: finished
      - agent_response: reset
`;

  it("validates each test and uploads the set with simulations upload", async () => {
    const saved =
      "type: simulation_set\nprocedure_id: 4242\ntests:\n- type: simulation_test\n  id: 9\n  name: Forgot password happy path\n";
    const run = vi.fn(async (a: string[], _o: unknown) =>
      a[2] === "list"
        ? cli("type: simulation_set\nprocedure_id: 4242\ntests: []\n")
        : cli(JSON.stringify({ id: 4242, type: "simulation_set", new_file_content: saved })),
    );
    const result = await uploadSimulationSet(credential, deps(run), {
      file: file("set.yaml", SET),
      schemaPath: SIM_SCHEMA,
    });
    expect(result).toMatchObject({ ok: true, procedureId: "4242" });
    // Reads the current tests first (duplicate guard), then uploads the set.
    expect(run.mock.calls.map((c) => (c[0] as string[]).slice(0, 4))).toEqual([
      ["fin", "simulations", "list", "4242"],
      ["fin", "simulations", "upload", expect.any(String)],
    ]);
    expect(result.text).toContain("Forgot password happy path [9]");
  });

  it("warns when tests without ids were appended as duplicates", async () => {
    const saved =
      "type: simulation_set\nprocedure_id: 4242\ntests:\n- id: 1\n  name: Same\n- id: 2\n  name: Same\n";
    const run = vi.fn(async (a: string[], _o: unknown) =>
      a[2] === "list"
        ? cli("type: simulation_set\nprocedure_id: 4242\ntests: []\n")
        : cli(JSON.stringify({ id: 4242, new_file_content: saved })),
    );
    const result = await uploadSimulationSet(credential, deps(run), {
      file: file("set.yaml", SET),
      schemaPath: SIM_SCHEMA,
    });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("appear more than once: Same");
    expect(result.details).toMatchObject({ duplicates: ["Same"] });
  });

  it("refuses id-less tests whose name already exists, before uploading anything", async () => {
    // Fin saves tests one by one, so a failed upload can leave earlier tests
    // saved; re-uploading the same file without ids would then duplicate them.
    const existing =
      "type: simulation_set\nprocedure_id: 4242\ntests:\n- type: simulation_test\n  id: 9\n  name: Forgot password happy path\n";
    const run = vi.fn(async (args: string[]) =>
      args[2] === "list" ? cli(existing) : cli(JSON.stringify({ id: 4242 })),
    );
    const result = await uploadSimulationSet(credential, deps(run), {
      file: file("set.yaml", SET),
      schemaPath: SIM_SCHEMA,
    });
    expect(result.ok).toBe(false);
    expect(result.details).toMatchObject({
      phase: "duplicates",
      matches: [{ name: "Forgot password happy path", ids: ["9"] }],
    });
    expect(result.text).toContain("id: 9");
    expect(run.mock.calls.map((c) => (c[0] as string[])[2])).toEqual(["list"]);
  });

  it("does not upload when the current tests cannot be read", async () => {
    const run = vi.fn(async (args: string[]) =>
      args[2] === "list" ? cli("", 4, "Error: not found") : cli("{}"),
    );
    const result = await uploadSimulationSet(credential, deps(run), {
      file: file("set.yaml", SET),
      schemaPath: SIM_SCHEMA,
    });
    expect(result).toMatchObject({ ok: false, details: { phase: "list" } });
    expect(run.mock.calls.map((c) => (c[0] as string[])[2])).toEqual(["list"]);
  });

  it("uploads when id-less test names are new or tests carry their ids", async () => {
    const existing =
      "type: simulation_set\nprocedure_id: 4242\ntests:\n- type: simulation_test\n  id: 9\n  name: Forgot password happy path\n";
    const saved = `${existing}`;
    const run = vi.fn(async (args: string[]) =>
      args[2] === "list"
        ? cli(existing)
        : cli(JSON.stringify({ id: 4242, new_file_content: saved })),
    );
    const withId = SET.replace(
      "  - type: simulation_test\n",
      "  - type: simulation_test\n    id: 9\n",
    );
    const result = await uploadSimulationSet(credential, deps(run), {
      file: file("set-id.yaml", withId),
      schemaPath: SIM_SCHEMA,
    });
    expect(result.ok).toBe(true);
    expect(run.mock.calls.map((c) => (c[0] as string[])[2])).toEqual(["list", "upload"]);
  });

  it("requires exactly one outcome assertion per test", () => {
    const base = { type: "simulation_test", procedure_id: 1 };
    const none = simulationTestRuleIssues({ ...base, assertions: [{ agent_response: "x" }] }, 1);
    expect(none.map((i) => i.path)).toEqual(["/assertions"]);
    expect(none[0]?.message).toContain("exactly one outcome");
    const two = simulationTestRuleIssues(
      { ...base, assertions: [{ outcome: "finished" }, { escalated_to: "DEFAULT" }] },
      1,
    );
    expect(two.map((i) => i.path)).toEqual(["/assertions"]);
    expect(
      simulationTestRuleIssues({ ...base, assertions: [{ escalated_to: "DEFAULT" }] }, 1),
    ).toEqual([]);
  });

  it("rejects single tests, temporary attribute assertions, and mismatched ids before upload", async () => {
    expect(
      simulationSetRuleIssues({ type: "simulation_test", procedure_id: "new" }).map((i) => i.path),
    ).toEqual(["/type", "/procedure_id", "/tests"]);
    expect(
      simulationTestRuleIssues(
        {
          type: "simulation_test",
          procedure_id: 1,
          assertions: [{ outcome: "finished" }, { attribute: "temporary.x", eq: "y" }],
        },
        2,
      ).map((i) => i.path),
    ).toEqual(["/procedure_id", "/assertions/1/attribute"]);
    const run = vi.fn(async () => cli("{}"));
    const bad = await uploadSimulationSet(credential, deps(run), {
      file: file(
        "bad.yaml",
        SET.replace(
          "      - agent_response: reset",
          "      - attribute: temporary.x\n        eq: y",
        ),
      ),
      schemaPath: SIM_SCHEMA,
    });
    expect(bad.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("checks every test against the workspace simulation schema", async () => {
    const run = vi.fn(async () => cli("{}"));
    const bad = await uploadSimulationSet(credential, deps(run), {
      file: file(
        "schema-bad.yaml",
        SET.replace("      - outcome: finished", "      - outcome: escalated"),
      ),
      schemaPath: SIM_SCHEMA,
    });
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain("/tests/0/assertions/0");
    expect(run).not.toHaveBeenCalled();
  });

  it("waits for generated tests to materialize, then reports none honestly", async () => {
    let lists = 0;
    const run = vi.fn(async (args: string[]) => {
      const sub = args[2];
      if (sub === "list") {
        lists += 1;
        return cli("type: simulation_set\nprocedure_id: 4242\ntests: []\n");
      }
      if (sub === "generate") return cli(JSON.stringify({ status: "completed" }));
      if (sub === "run") return cli(JSON.stringify({ enqueued: [] }));
      return cli("{}", 1);
    });
    const result = await simulateProcedure(credential, deps(run), {
      procedureId: "4242",
      generate: true,
      generateSettleMs: 9_000,
    });
    // 1 baseline + 1 after generate + 3 bounded polls (9s / 3s).
    expect(lists).toBe(5);
    expect(result.text).toContain("produced no tests");
    expect(result.text).toContain("upload_simulations");
  });
});

describe("setProcedureState (publish / pause)", () => {
  const proc = (state: string, version = 7, unpublished = false) =>
    `id: 4242\nversion: ${version}\nname: Example\nstate: ${state}\nhas_unpublished_changes: ${unpublished}\nprocedure:\n  main: [Step]\n`;
  /**
   * CLI 0.16 `publish`/`pause` call POST /fin-sdk/procedures/{id}/publish|pause
   * and return only a short status; SF Fin reads the state back with `get`.
   */
  function stateRun(current: string, savedState = "live", unpublished = false) {
    let changed = false;
    return vi.fn(async (args: string[]) => {
      if (args[2] === "get")
        return cli(changed ? proc(savedState, 8) : proc(current, 7, unpublished));
      if (args[2] === "publish" || args[2] === "pause") {
        changed = true;
        return cli(JSON.stringify({ message: "ok" }));
      }
      return cli("{}", 1);
    });
  }

  it("plans by default without changing anything", async () => {
    const run = stateRun("draft");
    const result = await setProcedureState(credential, deps(run), {
      procedureId: "4242",
      target: "live",
      execute: false,
    });
    expect(result.ok).toBe(true);
    expect(result.details).toMatchObject({ phase: "plan", from: "draft", to: "live" });
    expect(result.text).toContain("allow_mutation=true");
    expect(run.mock.calls.map((c) => (c[0] as string[])[2])).toEqual(["get"]);
  });

  it("publishes with execute, passes the note, and verifies the saved state", async () => {
    const run = stateRun("paused", "live");
    const result = await setProcedureState(credential, deps(run), {
      procedureId: "4242",
      target: "live",
      execute: true,
      note: "go live",
    });
    expect(result.ok).toBe(true);
    expect(result.details).toMatchObject({ phase: "execute", observed: "live", version: "8" });
    expect(run.mock.calls[1]?.[0]).toEqual([
      "fin",
      "procedures",
      "publish",
      "4242",
      "--json",
      "--note",
      "go live",
    ]);
    // The state is read back after the change, because 0.16 returns no saved file.
    expect(run.mock.calls.map((c) => (c[0] as string[])[2])).toEqual(["get", "publish", "get"]);
  });

  it("publishes a live procedure's unpublished draft, and pauses without a note", async () => {
    const run = stateRun("live", "live", true);
    const result = await setProcedureState(credential, deps(run), {
      procedureId: "4242",
      target: "live",
      execute: false,
    });
    expect(result.details).toMatchObject({ phase: "plan", from: "live", unpublished: true });
    expect(result.text).toContain("unpublished draft");
    const paused = stateRun("live", "paused");
    const pause = await setProcedureState(credential, deps(paused), {
      procedureId: "4242",
      target: "paused",
      execute: true,
      note: "ignored by Fin",
    });
    expect(pause.ok).toBe(true);
    expect(paused.mock.calls[1]?.[0]).toEqual(["fin", "procedures", "pause", "4242", "--json"]);
  });

  it("fails closed when Fin reports a different state after the change", async () => {
    const run = stateRun("live", "live");
    const result = await setProcedureState(credential, deps(run), {
      procedureId: "4242",
      target: "paused",
      execute: true,
    });
    expect(result.ok).toBe(false);
    expect(result.details).toMatchObject({ phase: "verify", observed: "live" });
  });

  it("is a no-op when already in the target state with nothing unpublished, and refuses to pause a draft", async () => {
    const live = stateRun("live");
    const noop = await setProcedureState(credential, deps(live), {
      procedureId: "4242",
      target: "live",
      execute: true,
    });
    expect(noop).toMatchObject({ ok: true, details: { phase: "noop" } });
    const draft = stateRun("draft");
    const refused = await setProcedureState(credential, deps(draft), {
      procedureId: "4242",
      target: "paused",
      execute: true,
    });
    expect(refused).toMatchObject({ ok: false, details: { phase: "refused" } });
    for (const run of [live, draft]) {
      expect(run.mock.calls.map((c) => (c[0] as string[])[2])).toEqual(["get"]);
    }
  });

  it("explains a generic publish failure for procedures with UI-configured triggers", async () => {
    const withApi = `id: 4242\nversion: 7\nname: Example\nstate: draft\ntriggers:\n- type: api\nprocedure:\n  main: [Step]\n`;
    const run = vi.fn(async (args: string[]) => {
      if (args[2] === "get") return cli(withApi);
      return cli(
        "",
        1,
        JSON.stringify({
          error: { code: "error", message: "An unexpected error occurred during upload" },
        }),
      );
    });
    const result = await setProcedureState(credential, deps(run), {
      procedureId: "4242",
      target: "live",
      execute: true,
    });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("An unexpected error occurred during upload");
    expect(result.text).toContain("api trigger");
    expect(result.text).toContain("Fin behavior");
    expect(result.details).toMatchObject({ phase: "execute", uiConfiguredTriggers: ["api"] });
    // The failed publish is never retried.
    expect(run.mock.calls.map((c) => (c[0] as string[])[2])).toEqual(["get", "publish"]);
  });

  it("rejects a non-numeric procedure id before any call", async () => {
    const run = stateRun("draft");
    const result = await setProcedureState(credential, deps(run), {
      procedureId: "4242; rm",
      target: "live",
      execute: true,
    });
    expect(result.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("tests the draft by default and says which version ran", async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args[2] === "get") return cli(proc("draft"));
      if (args[2] === "list") return cli("tests: []\n");
      if (args[2] === "run") return cli(JSON.stringify({ enqueued: [{ run_id: "r1" }] }));
      if (args[2] === "result") return cli(JSON.stringify({ status: "passed" }));
      return cli("{}", 1);
    });
    const draft = await simulateProcedure(credential, deps(run), {
      procedureId: "4242",
      generate: false,
    });
    expect(draft.text).not.toContain("Publish it");
    expect(draft.text).toContain("Tested the draft");
    expect(draft.details).toMatchObject({ procedureState: "draft", tested: "draft" });
    const runArgs = run.mock.calls.find((c) => (c[0] as string[])[2] === "run")?.[0] as string[];
    expect(runArgs).not.toContain("--live");

    const liveRun = vi.fn(async (args: string[]) =>
      args[2] === "get" ? cli(proc("live")) : run(args),
    );
    const live = await simulateProcedure(credential, deps(liveRun), {
      procedureId: "4242",
      generate: false,
      live: true,
    });
    expect(live.text).toContain("Tested the live version");
    const liveArgs = liveRun.mock.calls.filter((c) => (c[0] as string[])[2] === "run").at(-1)?.[0];
    expect(liveArgs).toContain("--live");
  });
});

describe("readProcedureVersions", () => {
  it("reports the separate version-history gate without enabling anything", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ errors: [{ code: "fin_sdk_not_enabled", message: "x" }] }), {
          status: 403,
        }),
    );
    const result = await readProcedureVersions(credential, "4242", { fetch });
    expect(result.state).toBe("gated");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  });
});
