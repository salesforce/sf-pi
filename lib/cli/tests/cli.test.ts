/* SPDX-License-Identifier: Apache-2.0 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm, stat, symlink, mkdir, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSfApexTool } from "../../../extensions/sf-apex/lib/sf-apex-tool.ts";
import { apexToolSchema as Params, apexActions } from "../../../extensions/sf-apex/public.ts";
import { buildApexCli } from "../../../scripts/build-cli.mjs";
import { buildApexPackage } from "../../../scripts/build-apex.mjs";

const exec = promisify(execFile);
const binary = path.resolve("packages/cli/dist/sf-pi.js");
let workspace: string;
let artifacts: string;
let fixtureBinary: string;

async function call(
  args: string[],
  options: { stdin?: string; fixture?: string; interrupt?: "SIGINT" | "SIGTERM" } = {},
) {
  return new Promise<{ code: number | null; json: any; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [options.fixture ? fixtureBinary : binary, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, APEX_TEST_OUTCOME: options.fixture },
    });
    let stdout = "";
    let stderr = "";
    let interrupted = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (options.interrupt && !interrupted && stderr.includes("fixture-ready")) {
        interrupted = true;
        child.kill(options.interrupt);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        resolve({ code, json: JSON.parse(stdout), stderr });
      } catch {
        reject(new Error(`Invalid CLI JSON: ${stdout}\n${stderr}`));
      }
    });
    child.stdin.end(options.stdin);
  });
}

function invoke(input: unknown, extra: string[] = [], fixture?: string) {
  return call(
    [
      "call",
      "sf_apex",
      "--input",
      JSON.stringify(input),
      "--workspace",
      workspace,
      "--artifact-dir",
      artifacts,
      ...extra,
    ],
    { fixture },
  );
}

beforeAll(async () => {
  await exec(process.execPath, ["scripts/build-cli.mjs"]);
  workspace = await mkdtemp(path.join(os.tmpdir(), "sf-apex-cli-test-"));
  artifacts = path.join(workspace, "artifacts");
  await writeFile(
    path.join(workspace, "sample.log"),
    "12:00:00.0 (1)|EXECUTION_STARTED\n12:00:00.0 (2)|USER_DEBUG|[1]|DEBUG|apex-cli-proof\n12:00:00.0 (3)|EXECUTION_FINISHED",
  );
  await symlink(
    path.resolve("node_modules"),
    path.join(workspace, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await writeFile(path.join(workspace, "package.json"), '{"type":"module"}');
  const outdir = path.join(workspace, "fixture-cli");
  fixtureBinary = path.join(outdir, "sf-pi.js");
  const packageDir = path.join(workspace, "fixture-apex");
  await mkdir(packageDir);
  await cp("packages/apex/package.json", path.join(packageDir, "package.json"));
  await buildApexPackage({
    packageDir,
    plugins: [
      {
        name: "synthetic-salesforce",
        setup(build) {
          build.onResolve({ filter: /common\/sf-conn\/index\.ts$/ }, () => ({
            path: "session",
            namespace: "fixture",
          }));
          build.onResolve({ filter: /^@salesforce\/apex-node$/ }, () => ({
            path: "tests",
            namespace: "fixture",
          }));
          build.onLoad({ filter: /^session$/, namespace: "fixture" }, () => ({
            contents: `
      function requireSignal(input) { if (!input.signal) throw new Error('Missing cancellation signal'); }
      export async function connectSalesforce(options) {
        requireSignal(options);
        return {
          target: { apiVersion: '67.0' },
          connection: { accessToken: 'fixture-placeholder', getAuthInfoFields: () => ({ orgId: '00D000000000000AAA' }) },
          identity: async (input) => { requireSignal(input); return { user_id: '005000000000000AAA' }; },
          query: async (input) => {
            requireSignal(input);
            return { records: input.soql.includes('AsyncApexJob') ? [{ Status: 'Completed' }] : [], totalSize: 0, done: true, truncated: false };
          },
          request: async (input) => {
            requireSignal(input);
            if (process.env.APEX_TEST_OUTCOME === 'hang') {
              console.error('fixture-ready');
              return new Promise(() => setInterval(() => {}, 1000));
            }
            const mode = process.env.APEX_TEST_OUTCOME;
            const compiled = mode !== 'compile';
            const success = compiled && mode !== 'runtime';
            return { status: 200, body: '<result><compiled>' + compiled + '</compiled><success>' + success + '</success>' +
              (compiled ? (success ? '' : '<exceptionMessage>Fixture exception</exceptionMessage>') : '<compileProblem>Unexpected token</compileProblem>') + '</result>' };
          },
        };
      }
    `,
          }));
          build.onLoad({ filter: /^tests$/, namespace: "fixture" }, () => ({
            contents: `
      export const TestLevel = { RunSpecifiedTests: 'RunSpecifiedTests' };
      export const ResultFormat = { markdown: 'markdown', junit: 'junit', tap: 'tap', text: 'text', json: 'json' };
      function result() {
        const failed = process.env.APEX_TEST_OUTCOME === 'failed';
        return { summary: { testRunId: '707000000000000AAA', testsRan: 1, passing: failed ? 0 : 1, failing: failed ? 1 : 0, outcome: failed ? 'Failed' : 'Passed' },
          tests: [{ methodName: 'testExample', outcome: failed ? 'Fail' : 'Pass', message: failed ? 'Fixture assertion failed' : undefined }] };
      }
      export class TestService {
        async buildAsyncPayload() { return { tests: [{ className: 'ExampleTest' }] }; }
        async runTestAsynchronous(_payload, _coverage, queued) { return queued ? { testRunId: '707000000000000AAA' } : result(); }
        async reportAsyncResults() { return result(); }
      }
    `,
          }));
        },
      },
    ],
  });
  await buildApexCli({ outdir });
  await mkdir(path.join(outdir, "node_modules/@sf-pi"), { recursive: true });
  await symlink(
    packageDir,
    path.join(outdir, "node_modules/@sf-pi/apex"),
    process.platform === "win32" ? "junction" : "dir",
  );
}, 30000);

afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe("Apex-only CLI", () => {
  it("matches the unchanged native Apex schema and covers every native action", () => {
    const registerTool = vi.fn();
    registerSfApexTool({ registerTool } as unknown as ExtensionAPI);
    const native = registerTool.mock.calls[0][0];
    expect(JSON.parse(JSON.stringify(Params))).toEqual(
      JSON.parse(JSON.stringify(native.parameters)),
    );
    expect(Object.keys(apexActions).sort()).toEqual(
      [...native.parameters.properties.action.enum].sort(),
    );
  });

  it(
    "discovers only Apex, rejects removed tools and bundles no other extension or Pi runtime",
    { timeout: 20000 },
    async () => {
      const listed = await call(["tools", "list", "--available", "--json"]);
      expect(listed.code).toBe(0);
      expect(listed.json.tools.map((tool: any) => tool.name)).toEqual(["sf_apex"]);
      for (const tool of ["sf_lwc", "sf_flow", "sf_soql", "data360_query"]) {
        expect((await call(["call", tool, "--input", "{}"])).code).toBe(3);
        expect((await call(["tools", "describe", tool])).code).toBe(3);
      }
      const described = await call(["tools", "describe", "sf_apex", "--json"]);
      expect(described.json.inputSchema.allOf[1].anyOf).toHaveLength(21);
      expect(Object.keys(described.json.actionDetailsSchemas)).toHaveLength(21);
      expect(described.json.actions["test.run"]).toMatchObject({ available: true, effects: true });
      expect(described.json.actions["diagnose.file"].available).toBe(true);
      expect((await stat(described.json.guidePath)).isFile()).toBe(true);
      const cliMeta = JSON.parse(await readFile("packages/cli/dist/metafile.json", "utf8"));
      expect(Object.keys(cliMeta.inputs).every((file) => file.startsWith("lib/cli/"))).toBe(true);
      expect(
        Object.values(cliMeta.outputs).flatMap((output: any) => output.imports),
      ).toContainEqual(expect.objectContaining({ path: "@sf-pi/apex", external: true }));
      const meta = await readFile("packages/apex/dist/metafile.json", "utf8");
      expect(meta).not.toMatch(
        /@earendil-works\/|pi-paths\.ts|sf-apex-tool\.ts|extensions\/sf-(?:lwc|flow|soql|data360)\//,
      );
      expect(meta).toContain("extensions/sf-apex/lib/artifact-writer.ts");
      expect(meta).toContain("extensions/sf-lsp/lib/client-engine.ts");
      expect(meta).not.toContain("extensions/sf-apex/lib/artifacts.ts");
    },
  );

  it(
    "rejects malformed input and unauthorized effects and reports unavailable diagnostics",
    { timeout: 20000 },
    async () => {
      expect((await call(["call", "sf_apex", "--input", "-"], { stdin: "{" })).code).toBe(2);
      expect((await invoke({ action: "unknown" })).code).toBe(2);
      expect((await invoke({ action: "author.plan", limit: "bad" })).code).toBe(2);
      expect((await invoke({ action: "diagnose.file", file: "missing.cls" })).code).toBe(5);
      for (const action of [
        "trace.start",
        "trace.stop",
        "log.watch",
        "anon.run",
        "test.run",
        "test.rerun",
      ])
        expect(
          (
            await invoke({
              action,
              body: "System.debug(1);",
              class_names: ["ExampleTest"],
              allow_mutation: true,
            })
          ).code,
        ).toBe(4);
      expect((await invoke({ action: "test.rerun" }, ["--allow-effects"])).code).toBe(2);
    },
  );

  it(
    "runs planning and workspace-relative log analysis with isolated, private artifacts",
    { timeout: 20000 },
    async () => {
      expect(
        (await invoke({ action: "author.plan", intent: "Create a focused service" })).code,
      ).toBe(0);
      const result = await invoke({ action: "log.analyze", file: "sample.log" });
      expect(result.code).toBe(0);
      expect(result.json.result.details.log_digest.user_debug[0].message).toBe("apex-cli-proof");
      const artifact = result.json.result.details.artifacts[0];
      expect(artifact.path.startsWith(artifacts + path.sep)).toBe(true);
      expect((await stat(artifact.path)).mode & 0o777).toBe(0o600);
      expect((await stat(path.dirname(result.json.runFile))).mode & 0o777).toBe(0o700);
      expect((await stat(result.json.runFile)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(artifact.path, "utf8")).counts.user_debug).toBe(1);
      const second = await invoke({ action: "log.analyze", file: "sample.log" });
      expect(second.json.runFile).not.toBe(result.json.runFile);
      expect(second.json.result.details.artifacts[0].path).not.toBe(artifact.path);
      expect((await invoke({ action: "log.analyze", file: "missing.log" })).code).toBe(5);
    },
  );

  it("accepts stdin and input-file JSON", { timeout: 20000 }, async () => {
    const input = JSON.stringify({ action: "author.plan", intent: "Plan a service" });
    const file = path.join(workspace, "input.json");
    await writeFile(file, input);
    expect(
      (
        await call(["call", "sf_apex", "--input", "-", "--artifact-dir", artifacts], {
          stdin: input,
        })
      ).code,
    ).toBe(0);
    expect(
      (await call(["call", "sf_apex", "--input-file", file, "--artifact-dir", artifacts])).code,
    ).toBe(0);
  });

  it(
    "returns failure exits for anonymous compile/runtime failures without changing native evidence",
    { timeout: 20000 },
    async () => {
      for (const mode of ["compile", "runtime"]) {
        const result = await invoke(
          { action: "anon.run", body: "System.debug('example');" },
          ["--allow-effects"],
          mode,
        );
        expect(result.code).toBe(5);
        expect(result.json.ok).toBe(false);
        expect(result.json.result.details.ok).toBe(true);
        expect(result.json.result.details.result.success).toBe(false);
        expect((await stat(result.json.result.details.artifacts[0].path)).isFile()).toBe(true);
      }
      expect(
        (
          await invoke(
            { action: "anon.run", body: "System.debug('example');" },
            ["--allow-effects"],
            "passed",
          )
        ).code,
      ).toBe(0);
      expect(
        (
          await invoke(
            { action: "anon.run", body: "insert new Account();" },
            ["--allow-effects"],
            "passed",
          )
        ).code,
      ).toBe(5);
    },
  );

  it(
    "keeps passing/queued tests successful and fails completed tests through run, result and rerun",
    { timeout: 20000 },
    async () => {
      const input = { action: "test.run", class_names: ["ExampleTest"], target_org: "ExampleOrg" };
      const failed = await invoke(input, ["--allow-effects"], "failed");
      expect(failed.code).toBe(5);
      expect(failed.json.result.details.summary.failing).toBe(1);
      const resumed = ["--resume", failed.json.runFile];
      expect(
        (await invoke({ action: "test.result", target_org: "ExampleOrg" }, resumed, "failed")).code,
      ).toBe(5);
      expect(
        (await invoke({ action: "test.rerun", target_org: "ExampleOrg" }, resumed, "passed")).code,
      ).toBe(4);
      expect(
        (
          await invoke(
            { action: "test.rerun", target_org: "ExampleOrg" },
            [...resumed, "--allow-effects"],
            "passed",
          )
        ).code,
      ).toBe(0);
      expect(
        (await invoke({ action: "test.result", target_org: "AnotherOrg" }, resumed, "passed")).code,
      ).toBe(2);
      expect((await invoke({ action: "test.result" }, resumed, "passed")).code).toBe(2);
      const other = path.join(workspace, "other");
      await mkdir(other);
      expect(
        (
          await invoke(
            { action: "test.result", target_org: "ExampleOrg" },
            [...resumed, "--workspace", other],
            "passed",
          )
        ).code,
      ).toBe(2);
      const queued = await invoke({ ...input, wait_seconds: 0 }, ["--allow-effects"], "passed");
      expect(queued.code).toBe(0);
      expect(queued.json.result.details.async_job_id).toBe("707000000000000AAA");
      expect(queued.json.result.details.summary).toBeUndefined();
    },
  );

  it(
    "passes cancellation to requests and exits promptly on timeout",
    { timeout: 20000 },
    async () => {
      expect((await invoke({ action: "status" }, [], "passed")).code).toBe(0);
      const started = Date.now();
      const timed = await invoke(
        { action: "anon.run", body: "System.debug('example');" },
        ["--allow-effects", "--timeout-ms", "500"],
        "hang",
      );
      expect(timed.code).toBe(124);
      expect(timed.json.error.code).toBe("TIMEOUT");
      expect(Date.now() - started).toBeLessThan(10000);
    },
  );

  it("cleans obsolete bundle files on rebuild", { timeout: 20000 }, async () => {
    const outdir = path.join(workspace, "stale-build");
    await mkdir(path.join(outdir, "assets/sf-data360"), { recursive: true });
    await writeFile(path.join(outdir, "obsolete.js"), "obsolete");
    await buildApexCli({ outdir });
    await expect(stat(path.join(outdir, "obsolete.js"))).rejects.toThrow();
    await expect(stat(path.join(outdir, "assets/sf-data360"))).rejects.toThrow();
  });

  it(
    "returns a structured interrupted exit for SIGINT and SIGTERM",
    { timeout: 20000 },
    async () => {
      for (const interrupt of ["SIGINT", "SIGTERM"] as const) {
        const result = await call(
          [
            "call",
            "sf_apex",
            "--input",
            JSON.stringify({ action: "anon.run", body: "System.debug('example');" }),
            "--allow-effects",
            "--timeout-ms",
            "5000",
            "--workspace",
            workspace,
            "--artifact-dir",
            artifacts,
          ],
          { fixture: "hang", interrupt },
        );
        expect(result.code).toBe(130);
        expect(result.json.error.code).toBe("INTERRUPTED");
        expect(result.json.runFile).toBeUndefined();
      }
    },
  );
});
