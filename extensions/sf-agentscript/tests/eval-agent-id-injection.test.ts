/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for runEval's agent_api_name → create_session id injection path. */

import { describe, expect, test, vi } from "vitest";
import { runEval } from "../lib/eval/orchestrator.ts";
import type { EvalSpec } from "../lib/eval/types.ts";

function fakeConn(opts?: { latestStatus?: string; latestVersion?: number }) {
  const calls: Array<{ url: string; body?: string }> = [];
  const conn = {
    instanceUrl: "https://example.my.salesforce.com",
    identity: vi.fn(async () => ({ user_id: "005USER", organization_id: "00DORG" })),
    query: vi.fn(async (soql: string) => {
      if (/FROM BotDefinition/i.test(soql)) return { records: [{ Id: "0XxBOT" }] };
      if (/FROM BotVersion/i.test(soql)) {
        const pinned = /VersionNumber=(\d+)/i.exec(soql)?.[1];
        const status = pinned
          ? (opts?.latestStatus ?? "Inactive")
          : /Status='Active'/i.test(soql)
            ? "Active"
            : (opts?.latestStatus ?? "Inactive");
        const version = pinned
          ? Number(pinned)
          : status === "Active"
            ? 3
            : (opts?.latestVersion ?? 4);
        return { records: [{ Id: `0X9V${version}`, VersionNumber: version, Status: status }] };
      }
      if (/FROM GenAiPlannerDefinition/i.test(soql)) return { records: [{ Id: "0YpPLAN" }] };
      return { records: [] };
    }),
    request: vi.fn(async (req: { url: string; body?: string }) => {
      calls.push(req);
      if (req.url.includes("/einstein/evaluation/v1/tests")) {
        return {
          results: [{ id: "route", outputs: [], evaluation_results: [], errors: [] }],
        };
      }
      throw new Error(`unexpected request ${req.url}`);
    }),
  };
  return { conn, calls };
}

const SPEC: EvalSpec = {
  tests: [
    {
      id: "route",
      steps: [
        { type: "agent.create_session", id: "cs", use_agent_api: true },
        { type: "agent.send_message", id: "sm", session_id: "{cs.session_id}", utterance: "hi" },
      ],
    },
  ],
};

describe("runEval agent id injection", () => {
  test("agent_api_name injects Active BotVersion ids by default", async () => {
    const { conn, calls } = fakeConn();
    const result = await runEval({
      conn: conn as never,
      targetOrg: "org",
      spec: SPEC,
      agentApiName: "My_Agent",
      tracesMode: "off",
      cwd: process.cwd(),
      noPersist: true,
    });

    const payload = JSON.parse(calls[0].body ?? "{}");
    expect(payload.tests[0].steps[0]).toMatchObject({
      agent_id: "0XxBOT",
      agent_version_id: "0X9V3",
      planner_id: "0YpPLAN",
    });
    expect(result.metadata.agent_id_resolution).toMatchObject({
      mode: "active",
      bot_id: "0XxBOT",
      bot_version_id: "0X9V3",
      bot_version_number: 3,
      bot_version_status: "Active",
      injected_create_session_steps: 1,
    });
  });

  test("latest mode refuses non-Active versions without acknowledgement", async () => {
    const { conn, calls } = fakeConn({ latestStatus: "Inactive", latestVersion: 4 });
    await expect(
      runEval({
        conn: conn as never,
        targetOrg: "org",
        spec: SPEC,
        agentApiName: "My_Agent",
        versionResolution: "latest",
        tracesMode: "off",
        cwd: process.cwd(),
        noPersist: true,
      }),
    ).rejects.toThrow(/acknowledge_inactive_version/);
    expect(calls).toHaveLength(0);
  });

  test("version mode pins an exact version", async () => {
    const { conn, calls } = fakeConn();
    const result = await runEval({
      conn: conn as never,
      targetOrg: "org",
      spec: SPEC,
      agentApiName: "My_Agent",
      versionResolution: "version",
      version: 7,
      tracesMode: "off",
      cwd: process.cwd(),
      noPersist: true,
    });

    const payload = JSON.parse(calls[0].body ?? "{}");
    expect(payload.tests[0].steps[0].agent_version_id).toBe("0X9V7");
    expect(result.metadata.agent_id_resolution).toMatchObject({ mode: "version" });
  });
});
