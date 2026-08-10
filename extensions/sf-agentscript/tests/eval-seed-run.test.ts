/* SPDX-License-Identifier: Apache-2.0 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let postedTests: unknown[] = [];

vi.mock("../lib/eval/eval-client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/eval/eval-client.ts")>();
  return {
    ...actual,
    callEval: vi.fn(async (_headers, tests) => {
      postedTests = tests as unknown[];
      return {
        status: 200,
        body: {
          results: [
            {
              id: "shipping",
              evaluation_results: [
                { id: "response", type: "evaluator.string_assertion", is_pass: true },
              ],
            },
          ],
        },
        endpoint: "",
      };
    }),
  };
});

import { runEval } from "../lib/eval/orchestrator.ts";
import type { EvalSpec } from "../lib/eval/types.ts";

let base: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "sf-agentscript-seed-run-"));
  postedTests = [];
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("eval SOQL seed preflight", () => {
  test("persists unresolved source but posts only the resolved wire spec", async () => {
    const source = seededSpec();
    const request = vi.fn(async (_input: { url: string }) => ({
      records: [{ Id: "0Mw000000000001AAA", CaseId: "500000000000001AAA" }],
    }));
    const conn = {
      instanceUrl: "https://example.invalid",
      version: "66.0",
      identity: async () => ({
        user_id: "005000000000001",
        organization_id: "00D000000000001",
      }),
      request,
    };

    const result = await runEval({
      conn: conn as never,
      targetOrg: "test-org",
      cwd: base,
      runBase: base,
      runId: "seeded",
      tracesMode: "off",
      spec: source,
      specPath: "tests/agentforce/Demo.eval.json",
    });

    expect(result.metadata.evidence_verdict).toBe("passed");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0].url).toContain("/query?q=");
    expect(
      JSON.parse(await readFile(path.join(base, "seeded", "spec.source.snapshot.json"), "utf8")),
    ).toEqual(source);
    const executed = JSON.parse(
      await readFile(path.join(base, "seeded", "spec.executed.snapshot.json"), "utf8"),
    );
    expect(executed.seed_profiles).toBeUndefined();
    expect(executed.tests[0].seed_profile).toBeUndefined();
    expect(executed.tests[0].steps[1].context_variables).toEqual([
      { name: "RoutableId", type: "Text", value: "0Mw000000000001AAA" },
      { name: "case_id", type: "Text", value: "500000000000001AAA" },
      { name: "verified_check", type: "Text", value: "true" },
    ]);
    expect(postedTests).toEqual(executed.tests);
  });
});

function seededSpec(): EvalSpec {
  return {
    seed_profiles: {
      verified_messaging: {
        soql: "SELECT Id, CaseId FROM MessagingSession WHERE Status = 'Active' ORDER BY LastModifiedDate DESC LIMIT 1",
        context_variables: [
          { name: "RoutableId", type: "Text", field: "Id" },
          { name: "case_id", type: "Text", field: "CaseId" },
          { name: "verified_check", type: "Text", value: "true" },
        ],
      },
    },
    tests: [
      {
        id: "shipping",
        seed_profile: "verified_messaging",
        steps: [
          { type: "agent.create_session", id: "session", agent_id: "0Xx", agent_version_id: "0X9" },
          { type: "agent.send_message", id: "turn", utterance: "Where is my shipment?" },
          {
            type: "evaluator.string_assertion",
            id: "response",
            actual: "{turn.response}",
            expected: "shipment",
          },
        ],
      },
    ],
  };
}
