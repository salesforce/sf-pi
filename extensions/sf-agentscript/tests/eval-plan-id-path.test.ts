/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pin the planId field path against the eval API's current wire shape.
 *
 * The eval API places planId at `planner_response.sessionProperties.planId`,
 * NOT at `planner_response.lastExecution.message.planId` (which only carries
 * a `messageType` + `id` + `feedbackId` for `InformResponseMessage` — the
 * common case). Earlier code looked at the wrong field, returned 0 plan
 * keys, and silently fetched 0 traces per run. Same bug in the upstream
 * Python harness.
 *
 * Fixture pulled from a real `agentscript_eval action='run'` against the
 * Vivint-DevInt org on 2026-05-14 (sanitized — only structural shape kept).
 */

import { describe, expect, test } from "vitest";
import { collectPlanKeys } from "../lib/eval/trace-client.ts";
import type { EvalApiResponse } from "../lib/eval/types.ts";

const REAL_RESPONSE_SHAPE: EvalApiResponse = {
  results: [
    {
      id: "trace_probe",
      outputs: [
        {
          type: "agent.create_session",
          id: "session",
          session_id: "b9d1c3c1-5dd9-47db-9157-369e26e5cc93",
        },
        {
          type: "agent.send_message",
          id: "turn1",
        },
        {
          type: "agent.get_state",
          id: "state1",
          response: {
            planner_response: {
              sessionProperties: {
                planId: "89d1fc1e-601d-4879-b081-c310203eeba5",
                sessionId: "b9d1c3c1-5dd9-47db-9157-369e26e5cc93",
              },
              lastExecution: {
                topic: "account_validation",
                message: {
                  // Note: NO planId here — only id + feedbackId for InformResponseMessage.
                  messageType: "InformResponseMessage",
                  id: "616eda4f-f12b-49d8-b564-1775deba81eb",
                  feedbackId: "cfa9817d-679f-4681-bc9f-880b1fd7c6b1",
                },
              },
            },
          } as never,
        },
      ],
      evaluation_results: [
        // one passing evaluator
        { id: "x", is_pass: true, score: 1.0 },
      ],
      errors: [],
    },
  ],
};

describe("collectPlanKeys (planId field path regression)", () => {
  test("reads planId from sessionProperties (the real path the API uses)", () => {
    const keys = collectPlanKeys(REAL_RESPONSE_SHAPE, { onlyFailed: false });
    expect(keys).toEqual([
      {
        testId: "trace_probe",
        sessionId: "b9d1c3c1-5dd9-47db-9157-369e26e5cc93",
        planId: "89d1fc1e-601d-4879-b081-c310203eeba5",
      },
    ]);
  });

  test("falls back to lastExecution.message.planId for the older response shape", () => {
    const legacy: EvalApiResponse = {
      results: [
        {
          id: "legacy",
          outputs: [
            {
              type: "agent.create_session",
              id: "session",
              session_id: "sid-legacy",
            },
            {
              type: "agent.get_state",
              id: "state",
              response: {
                planner_response: {
                  // sessionProperties absent
                  lastExecution: {
                    message: { planId: "pid-legacy", messageType: "old" },
                  },
                },
              } as never,
            },
          ],
          evaluation_results: [],
          errors: [{ id: "x", error_message: "fail" }],
        },
      ],
    };
    const keys = collectPlanKeys(legacy);
    expect(keys).toEqual([{ testId: "legacy", sessionId: "sid-legacy", planId: "pid-legacy" }]);
  });

  test("onlyFailed=true skips passing tests but the planId path still resolves", () => {
    // REAL_RESPONSE_SHAPE has all evaluators passing, so onlyFailed=true → empty.
    expect(collectPlanKeys(REAL_RESPONSE_SHAPE, { onlyFailed: true })).toEqual([]);
  });
});
