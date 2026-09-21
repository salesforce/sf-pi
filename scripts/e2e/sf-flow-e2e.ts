/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Bounded live E2E for sf-flow. Check-only validation saves no metadata.
 *
 * Usage:
 *   npm run e2e:sf-flow -- --org <alias> --workspace <sfdx-project> --file <workspace.flow-meta.xml>
 *   npm run e2e:sf-flow -- --org <alias> --file <file> --flow <FlowApiName>
 *   npm run e2e:sf-flow -- --org <alias> --file <file> --test <FlowApiName.TestName>
 *   npm run e2e:sf-flow -- --org <alias> --file <file> --run-first-discovered-test [--async-test]
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { connectSalesforce } from "../../lib/common/sf-conn/index.ts";
import { resolveFlowFile } from "../../extensions/sf-flow/lib/analyzer.ts";
import { diagnoseFile, orgPreflight, status } from "../../extensions/sf-flow/lib/operations.ts";
import {
  discoverFlowTests,
  getFlowTestResult,
  planFlowTests,
  rerunFlowTests,
  runFlowTests,
} from "../../extensions/sf-flow/lib/flow-tests.ts";
import type {
  FlowRunDigest,
  SfFlowSessionState,
  ToolResult,
} from "../../extensions/sf-flow/lib/types.ts";
import { validateFlowCheck } from "../../extensions/sf-flow/lib/validation.ts";

interface Args {
  org?: string;
  workspace?: string;
  file?: string;
  flow?: string;
  test?: string;
  runFirstDiscoveredTest?: boolean;
  asyncTest?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--org") args.org = argv[++index];
    else if (argv[index] === "--workspace") args.workspace = argv[++index];
    else if (argv[index] === "--file") args.file = argv[++index];
    else if (argv[index] === "--flow") args.flow = argv[++index];
    else if (argv[index] === "--test") args.test = argv[++index];
    else if (argv[index] === "--run-first-discovered-test") args.runFirstDiscoveredTest = true;
    else if (argv[index] === "--async-test") args.asyncTest = true;
  }
  return args;
}

function digest(result: ToolResult): FlowRunDigest {
  const value = result.details.digest as FlowRunDigest | undefined;
  if (!value) throw new Error(`Missing Flow Run Digest: ${result.content[0]?.text ?? "unknown"}`);
  return value;
}

function assertStatus(
  label: string,
  result: ToolResult,
  allowed: FlowRunDigest["status"][],
): FlowRunDigest {
  const value = digest(result);
  if (!allowed.includes(value.status)) {
    throw new Error(
      `${label} expected ${allowed.join("/")}, got ${value.status}: ${result.content[0]?.text}`,
    );
  }
  console.log(`✅ ${label}: ${value.status} · ${value.title}`);
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.org || !args.file) {
    throw new Error(
      "Usage: npm run e2e:sf-flow -- --org <alias> [--workspace <sfdx-project>] --file <workspace.flow-meta.xml>",
    );
  }
  const session = await connectSalesforce({ cwd: process.cwd(), targetOrg: args.org, fresh: true });
  const state: SfFlowSessionState = {};
  const prepared = await prepareFlowForTarget(
    args.file,
    session.target.apiVersion,
    args.workspace ?? process.cwd(),
  );

  try {
    assertStatus("status", status(session, { action: "status", target_org: args.org }), ["pass"]);
    assertStatus(
      "org.preflight",
      await orgPreflight(session, { action: "org.preflight", target_org: args.org }),
      ["pass", "warning"],
    );
    assertStatus(
      "diagnose.file",
      await diagnoseFile({ action: "diagnose.file", file: prepared.file }, prepared.cwd),
      ["pass", "warning"],
    );
    assertStatus(
      "validate.check",
      await validateFlowCheck(
        { action: "validate.check", file: prepared.file, target_org: args.org },
        prepared.cwd,
        session,
      ),
      ["pass"],
    );

    const discovered = await discoverFlowTests(
      { action: "test.discover", target_org: args.org, limit: 25 },
      session,
    );
    assertStatus("test.discover", discovered, ["pass", "warning"]);
    const candidates = discovered.details.candidates as
      Array<{ flow_name?: string; test_names?: string[] }> | undefined;
    const discoveredFlow = args.runFirstDiscoveredTest ? candidates?.[0]?.flow_name : undefined;
    if (args.runFirstDiscoveredTest && !discoveredFlow) {
      console.log("⚠️ No discovered Flow test candidate was available for the opted-in test run.");
    }

    if (args.flow || args.test || discoveredFlow) {
      const targetFlow = args.flow ?? discoveredFlow;
      assertStatus(
        "test.plan",
        await planFlowTests(
          {
            action: "test.plan",
            target_org: args.org,
            flow_names: targetFlow ? [targetFlow] : undefined,
            limit: 25,
          },
          session,
        ),
        ["pass"],
      );
      const run = await runFlowTests(
        {
          action: "test.run",
          target_org: args.org,
          flow_names: targetFlow ? [targetFlow] : undefined,
          tests: args.test ? [args.test] : undefined,
          wait_seconds: args.asyncTest ? 0 : 120,
          report_formats: ["json", "markdown"],
        },
        session,
        state,
      );
      const runDigest = assertStatus("test.run", run, ["pass", "info"]);
      if (runDigest.status === "info" && state.last_test_run_id) {
        assertStatus(
          "test.result",
          await getFlowTestResult(
            {
              action: "test.result",
              target_org: args.org,
              run_id: state.last_test_run_id,
              wait_seconds: 120,
            },
            session,
            state,
          ),
          ["pass"],
        );
      }

      const rerun = await rerunFlowTests(
        { action: "test.rerun", target_org: args.org },
        session,
        state,
      );
      const rerunDigest = assertStatus("test.rerun", rerun, ["pass", "info"]);
      if (rerunDigest.status === "info" && state.last_test_run_id) {
        assertStatus(
          "test.result after rerun",
          await getFlowTestResult(
            {
              action: "test.result",
              target_org: args.org,
              run_id: state.last_test_run_id,
              wait_seconds: 120,
            },
            session,
            state,
          ),
          ["pass"],
        );
      }
    }

    console.log("SF Flow E2E passed.");
  } finally {
    await prepared.cleanup();
  }
}

async function prepareFlowForTarget(
  fileInput: string,
  targetApiVersion: string,
  workspace: string,
) {
  const resolved = await resolveFlowFile(fileInput, workspace);
  const source = await readFile(resolved.absolute, "utf8");
  const match = /<apiVersion>([^<]+)<\/apiVersion>/.exec(source);
  const sourceVersion = Number.parseFloat(match?.[1] ?? "0");
  const targetVersion = Number.parseFloat(targetApiVersion);
  if (!Number.isFinite(sourceVersion) || sourceVersion <= targetVersion) {
    return { cwd: workspace, file: fileInput, cleanup: async () => {} };
  }
  const root = await mkdtemp(path.join(tmpdir(), "sf-flow-e2e-"));
  const filename = path.basename(resolved.absolute);
  await writeFile(
    path.join(root, filename),
    source.replace(
      /<apiVersion>[^<]+<\/apiVersion>/,
      `<apiVersion>${targetApiVersion}</apiVersion>`,
    ),
  );
  console.log(
    `ℹ️ Staged a temporary API ${targetApiVersion} copy because the source uses API ${match?.[1]}.`,
  );
  return {
    cwd: root,
    file: filename,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

await main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
