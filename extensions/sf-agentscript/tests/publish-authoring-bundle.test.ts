/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Regression: published agents must show up in Agent Script Studio.
 *
 * The Studio UI gates on the presence of an AiAuthoringBundle metadata
 * record AND its `.agent` source file (the bundle's two-file payload).
 * Our publish flow uses @salesforce/source-deploy-retrieve to deploy the
 * bundle directory exactly the way `sf agent publish authoring-bundle`
 * does: ComponentSet.fromSource(bundleDir).deploy({ usernameOrConnection }).
 *
 * These tests run the full publishAgent path against a fake connection +
 * a fake SDR deploy hook (vi.mock) so the deploy bytes don't leave the
 * machine. We assert:
 *   - <target> is injected into the on-disk bundle-meta.xml before deploy
 *   - the original bundle-meta.xml is restored after deploy (success OR
 *     failure)
 *   - PublishResult.authoring_bundle reports created:true on success
 *   - failures inside SDR are surfaced on PublishResult.authoring_bundle.error
 *   - missing bundleDir → bundle deploy is skipped with a clear error
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let workDir: string;
let publishAgent: typeof import("../lib/lifecycle.ts").publishAgent;

const CLEAN_SOURCE = `config:
    agent_name: "My_Agent"
    description: "Test agent"
    agent_type: "AgentforceEmployeeAgent"

system:
    instructions: |
        Be concise.

topic main_topic:
    description: "Primary topic."

start_agent main:
    description: "Entry point."
    transition to @topic.main_topic
`;

const INITIAL_META = `<?xml version="1.0" encoding="UTF-8"?>
<AiAuthoringBundle xmlns="http://soap.sforce.com/2006/04/metadata">
  <bundleType>AGENT</bundleType>
</AiAuthoringBundle>
`;

// Hooks set by individual tests so we can assert what SDR receives + control
// the deploy outcome (success/failure).
let lastFromSourceArg: string | undefined;
let lastDeployOptions: unknown;
let nextDeployResponse: { success: boolean; problem?: string } = { success: true };

vi.mock("@salesforce/source-deploy-retrieve", () => ({
  ComponentSet: {
    fromSource: (arg: string) => {
      lastFromSourceArg = arg;
      return {
        deploy: async (options: unknown) => {
          lastDeployOptions = options;
          return {
            pollStatus: async () => ({
              response: nextDeployResponse.success
                ? { success: true }
                : {
                    success: false,
                    details: {
                      componentFailures: [{ problem: nextDeployResponse.problem ?? "boom" }],
                    },
                  },
            }),
          };
        },
      };
    },
  },
}));

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-bundle-"));
  // Reset hook state and pull a fresh import every test so the SDR mock is
  // applied predictably. The mocked module is module-scoped, so we just need
  // to import it here.
  lastFromSourceArg = undefined;
  lastDeployOptions = undefined;
  nextDeployResponse = { success: true };
  publishAgent = (await import("../lib/lifecycle.ts")).publishAgent;
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

interface FakeConn {
  query: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
}

function fakeConnection(opts: {
  existingBotId?: string;
  publishResp: { status: number; body: unknown };
  versionRow?: { DeveloperName?: string; VersionNumber?: number };
}): FakeConn {
  return {
    query: vi.fn(async (soql: string) => {
      if (/FROM BotDefinition WHERE DeveloperName/i.test(soql)) {
        return { records: opts.existingBotId ? [{ Id: opts.existingBotId }] : [] };
      }
      if (/FROM BotVersion WHERE Id/i.test(soql)) {
        return { records: opts.versionRow ? [opts.versionRow] : [] };
      }
      return { records: [] };
    }),
    request: vi.fn(async (req: { url: string; body?: string }) => {
      if (req.url.endsWith("/authoring/scripts")) {
        return {
          status: "success",
          compiledArtifact: {
            globalConfiguration: { developerName: "My_Agent" },
            agentVersion: { developerName: "v1" },
          },
        };
      }
      if (req.url.includes("/authoring/agents")) {
        if (opts.publishResp.status >= 200 && opts.publishResp.status < 300) {
          return opts.publishResp.body;
        }
        const err = new Error("publish failed") as Error & { statusCode: number; data: unknown };
        err.statusCode = opts.publishResp.status;
        err.data = opts.publishResp.body;
        throw err;
      }
      throw new Error(`unexpected request ${req.url}`);
    }),
  };
}

async function setupBundleDir(): Promise<{ bundleDir: string; metaPath: string }> {
  const bundleDir = path.join(workDir, "My_Agent");
  await rm(bundleDir, { recursive: true, force: true });
  await writeFile(path.join(workDir, "_create_bundle_dir"), "x");
  const fs = await import("node:fs/promises");
  await fs.mkdir(bundleDir, { recursive: true });
  const metaPath = path.join(bundleDir, "My_Agent.bundle-meta.xml");
  await writeFile(metaPath, INITIAL_META, "utf8");
  await writeFile(path.join(bundleDir, "My_Agent.agent"), CLEAN_SOURCE, "utf8");
  return { bundleDir, metaPath };
}

describe("publishAgent deploys AiAuthoringBundle via SDR", () => {
  test("happy path: <target> is injected, deploy is called with bundleDir, success is reported, original meta is restored", async () => {
    const { bundleDir, metaPath } = await setupBundleDir();
    const conn = fakeConnection({
      publishResp: {
        status: 200,
        body: { botId: "0Xx_BOT", botVersionId: "0X9_VER" },
      },
      versionRow: { DeveloperName: "v3", VersionNumber: 3 },
    });

    const result = await publishAgent({
      conn: conn as never,
      agentApiName: "My_Agent",
      agentSource: CLEAN_SOURCE,
      bundleDir,
    });

    expect(lastFromSourceArg).toBe(bundleDir);
    expect(lastDeployOptions).toMatchObject({ usernameOrConnection: conn });
    expect(result.authoring_bundle).toEqual({
      full_name: "My_Agent_3",
      target: "My_Agent.v3",
      created: true,
    });
    // Original meta restored (no <target> left behind in source).
    const finalMeta = await readFile(metaPath, "utf8");
    expect(finalMeta).toBe(INITIAL_META);
    expect(finalMeta).not.toContain("<target>");
  });

  test("on SDR deploy failure, ok=true on overall publish but error captured on authoring_bundle, meta restored", async () => {
    const { bundleDir, metaPath } = await setupBundleDir();
    nextDeployResponse = { success: false, problem: "FIELD_INTEGRITY_EXCEPTION: target invalid" };
    const conn = fakeConnection({
      publishResp: { status: 200, body: { botId: "0Xx", botVersionId: "0X9" } },
      versionRow: { DeveloperName: "v1", VersionNumber: 1 },
    });

    const result = await publishAgent({
      conn: conn as never,
      agentApiName: "My_Agent",
      agentSource: CLEAN_SOURCE,
      bundleDir,
    });

    expect(result.ok).toBe(true);
    expect(result.authoring_bundle?.created).toBe(false);
    expect(result.authoring_bundle?.error).toContain("FIELD_INTEGRITY_EXCEPTION");
    const finalMeta = await readFile(metaPath, "utf8");
    expect(finalMeta).toBe(INITIAL_META);
  });

  test("missing bundleDir → bundle deploy skipped with explanatory error", async () => {
    const conn = fakeConnection({
      publishResp: { status: 200, body: { botId: "0Xx", botVersionId: "0X9" } },
      versionRow: { DeveloperName: "v1", VersionNumber: 1 },
    });

    const result = await publishAgent({
      conn: conn as never,
      agentApiName: "My_Agent",
      agentSource: CLEAN_SOURCE,
    });

    expect(result.ok).toBe(true);
    expect(result.authoring_bundle?.created).toBe(false);
    expect(result.authoring_bundle?.error).toMatch(/bundleDir not provided/i);
    expect(result.authoring_bundle?.full_name).toBe("My_Agent_1");
    expect(lastFromSourceArg).toBeUndefined();
  });
});
