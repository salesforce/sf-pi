/* SPDX-License-Identifier: Apache-2.0 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  normal: {
    instanceUrl: "https://example.invalid",
    identity: async () => ({ user_id: "test-user", organization_id: "test-org" }),
  },
  named: { instanceUrl: "https://example.invalid" },
  connForAgentApi: vi.fn(),
  callEval: vi.fn(),
}));

vi.mock("../lib/agent-api-auth.ts", () => ({
  connForAgentApi: mocks.connForAgentApi,
}));
vi.mock("../lib/eval/eval-client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/eval/eval-client.ts")>()),
  callEval: mocks.callEval,
}));

import { runEval } from "../lib/eval/orchestrator.ts";

const spec = {
  tests: Array.from({ length: 6 }, (_, index) => ({
    id: `scenario-${index + 1}`,
    steps: [
      {
        type: "agent.create_session",
        id: "session",
        agent_id: "0Xx",
        agent_version_id: "0X9",
      },
    ],
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connForAgentApi.mockResolvedValue({ conn: mocks.named, cache: "miss" });
});

describe("Evaluation API auth", () => {
  it("retries an invalid org token once with a shared named-user connection", async () => {
    mocks.callEval.mockImplementation(async (conn, tests) =>
      conn === mocks.normal
        ? { status: 401, body: { errors: [{ message: "Invalid token" }] }, endpoint: "" }
        : {
            status: 200,
            body: { results: tests.map((test: { id: string }) => ({ id: test.id })) },
            endpoint: "",
          },
    );

    const result = await runEval({
      conn: mocks.normal as never,
      targetOrg: "test-org",
      cwd: process.cwd(),
      noPersist: true,
      tracesMode: "off",
      concurrency: 2,
      spec,
    });

    expect(mocks.connForAgentApi).toHaveBeenCalledOnce();
    expect(mocks.connForAgentApi).toHaveBeenCalledWith("test-org", expect.anything());
    expect(mocks.callEval.mock.calls.some(([conn]) => conn === mocks.normal)).toBe(true);
    expect(mocks.callEval.mock.calls.some(([conn]) => conn === mocks.named)).toBe(true);
    expect(result.failed_batches).toBe(0);
    expect(result.metadata.returned_tests_count).toBe(6);
  });

  it("keeps a rejected named-user retry as incomplete evidence", async () => {
    mocks.callEval.mockResolvedValue({
      status: 401,
      body: { errors: [{ message: "Invalid token" }] },
      endpoint: "",
    });

    const result = await runEval({
      conn: mocks.normal as never,
      targetOrg: "test-org",
      cwd: process.cwd(),
      noPersist: true,
      tracesMode: "off",
      spec: { tests: spec.tests.slice(0, 1) },
    });

    expect(mocks.connForAgentApi).toHaveBeenCalledOnce();
    expect(mocks.callEval).toHaveBeenCalledTimes(2);
    expect(result.failed_batches).toBe(1);
    expect(result.metadata).toMatchObject({
      execution_state: "infrastructure_failed",
      evidence_verdict: "incomplete",
      returned_tests_count: 0,
    });
  });

  it("keeps the original connection when it is accepted", async () => {
    mocks.callEval.mockImplementation(async (_conn, tests) => ({
      status: 200,
      body: { results: tests.map((test: { id: string }) => ({ id: test.id })) },
      endpoint: "",
    }));

    const result = await runEval({
      conn: mocks.normal as never,
      targetOrg: "test-org",
      cwd: process.cwd(),
      noPersist: true,
      tracesMode: "off",
      spec: { tests: spec.tests.slice(0, 1) },
    });

    expect(mocks.connForAgentApi).not.toHaveBeenCalled();
    expect(mocks.callEval).toHaveBeenCalledOnce();
    expect(mocks.callEval.mock.calls[0]?.[0]).toBe(mocks.normal);
    expect(result.failed_batches).toBe(0);
  });
});
