/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the .agent-vs-BotVersion divergence detector. Drives the
 * function with a fake Connection + a real temp file with a known mtime
 * skew. Used as a soft preflight on agentscript_lifecycle action='activate'
 * (Issue 6) so the LLM and human catch the "edited source, deployed via
 * sf project deploy, BotDefinition wasn't updated" footgun.
 */

import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { checkBundleVsBotDivergence } from "../lib/lifecycle-divergence.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-div-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

interface QueryFixture {
  match: string | RegExp;
  records: unknown[];
}

function fakeConn(fixtures: QueryFixture[]) {
  return {
    query: async <T>(soql: string): Promise<{ records: T[] }> => {
      for (const f of fixtures) {
        const m = typeof f.match === "string" ? soql.includes(f.match) : f.match.test(soql);
        if (m) return { records: f.records as T[] };
      }
      throw new Error(`No fixture matched SOQL: ${soql}`);
    },
  } as unknown as Parameters<typeof checkBundleVsBotDivergence>[0];
}

async function writeAgentWithMtime(name: string, mtimeMs: number): Promise<string> {
  const filePath = path.join(workDir, name);
  await writeFile(filePath, 'config:\n  agent_name: "X"\n', "utf8");
  const t = mtimeMs / 1000;
  await utimes(filePath, t, t);
  return filePath;
}

describe("checkBundleVsBotDivergence", () => {
  test("uses bounded SOQL transport for authenticated divergence probes", async () => {
    const filePath = await writeAgentWithMtime("Auth.agent", Date.now() - 5 * 60 * 1000);
    const query = vi.fn(async () => {
      throw new Error("raw conn.query should not be used for authenticated divergence probes");
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const soql = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
      const records = soql.includes("FROM BotDefinition")
        ? [{ Id: "0Xx_BOT_ID" }]
        : soql.includes("FROM BotVersion")
          ? [{ VersionNumber: 3, CreatedDate: new Date().toISOString() }]
          : [];
      return new Response(JSON.stringify({ records, totalSize: records.length }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const r = await checkBundleVsBotDivergence(
        {
          accessToken: "JWT",
          instanceUrl: "https://example.my.salesforce.com",
          getApiVersion: () => "67.0",
          getConnectionOptions: () => ({
            accessToken: "JWT",
            instanceUrl: "https://example.my.salesforce.com",
          }),
          query,
        } as unknown as Parameters<typeof checkBundleVsBotDivergence>[0],
        "Demo_Greeter",
        filePath,
      );

      expect(r.ok).toBe(true);
      expect(query).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("file mtime > latest BotVersion CreatedDate → diverged=true with the iterate-via-publish hint", async () => {
    // Bot was created 10 min ago; .agent was edited 1 min ago.
    const versionMs = Date.now() - 10 * 60 * 1000;
    const fileMs = Date.now() - 1 * 60 * 1000;
    const filePath = await writeAgentWithMtime("X.agent", fileMs);
    const conn = fakeConn([
      {
        match: "FROM BotDefinition WHERE DeveloperName='Demo_Greeter'",
        records: [{ Id: "0Xx_BOT_ID" }],
      },
      {
        match: "FROM BotVersion WHERE BotDefinitionId",
        records: [{ VersionNumber: 3, CreatedDate: new Date(versionMs).toISOString() }],
      },
    ]);
    const r = await checkBundleVsBotDivergence(conn, "Demo_Greeter", filePath);
    expect(r.ok).toBe(true);
    expect(r.diverged).toBe(true);
    expect(r.latest_version_number).toBe(3);
    expect(r.detail).toMatch(/v3/);
    // The hint must call out 'sf project deploy' specifically.
    expect(r.detail).toMatch(/sf project deploy/);
    expect(r.detail).toMatch(/agentscript_lifecycle action='publish'/);
  });

  test("file mtime < latest BotVersion CreatedDate → diverged=false", async () => {
    const versionMs = Date.now();
    const fileMs = versionMs - 5 * 60 * 1000;
    const filePath = await writeAgentWithMtime("Y.agent", fileMs);
    const conn = fakeConn([
      {
        match: "FROM BotDefinition WHERE DeveloperName='Demo_Greeter'",
        records: [{ Id: "0Xx_BOT_ID" }],
      },
      {
        match: "FROM BotVersion WHERE BotDefinitionId",
        records: [{ VersionNumber: 5, CreatedDate: new Date(versionMs).toISOString() }],
      },
    ]);
    const r = await checkBundleVsBotDivergence(conn, "Demo_Greeter", filePath);
    expect(r.ok).toBe(true);
    expect(r.diverged).toBe(false);
    expect(r.detail).toMatch(/in sync/);
  });

  test("BotDefinition not found → ok=false, helpful detail, no crash", async () => {
    const filePath = await writeAgentWithMtime("Z.agent", Date.now());
    const conn = fakeConn([
      {
        match: "FROM BotDefinition WHERE DeveloperName='Ghost'",
        records: [],
      },
    ]);
    const r = await checkBundleVsBotDivergence(conn, "Ghost", filePath);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/No BotDefinition for 'Ghost'/);
  });

  test("missing .agent file → ok=false, never throws", async () => {
    const conn = fakeConn([]);
    const r = await checkBundleVsBotDivergence(conn, "X", path.join(workDir, "missing.agent"));
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/Cannot stat/);
  });
});
