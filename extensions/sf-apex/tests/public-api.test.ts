/* SPDX-License-Identifier: Apache-2.0 */
import { build } from "esbuild";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Check } from "typebox/value";
import { TestLevel, TestService } from "@salesforce/apex-node";
import * as connections from "../../../lib/common/sf-conn/index.ts";
import {
  apexActions,
  apexInputSchema,
  apexInputSchemas,
  apexDetailsSchemas,
  createApexArtifactWriter,
  executeApex,
  callApex,
  createApexClient,
  invokeApex,
} from "../public.ts";

const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
describe("Apex public API", () => {
  it("bundles without Pi runtime, native adapters, or startup connections", async () => {
    const result = await build({
      entryPoints: ["extensions/sf-apex/public.ts"],
      bundle: true,
      packages: "external",
      platform: "node",
      format: "esm",
      write: false,
      metafile: true,
    });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs).not.toContain("extensions/sf-apex/lib/operations.ts");

    expect(inputs.some((p) => /pi-paths|sf-apex-tool|lsp-client|\/artifacts\.ts/.test(p))).toBe(
      false,
    );
    expect(result.outputFiles[0].text).not.toMatch(/@earendil-works|@mariozechner/);
  });
  it("has one typed schema per action and rejects missing action requirements", () => {
    expect(Object.keys(apexInputSchemas)).toEqual(Object.keys(apexActions));
    expect(Object.keys(apexDetailsSchemas)).toEqual(Object.keys(apexActions));
    for (const action of ["diagnose.file", "anon.run", "log.analyze", "log.get", "test.run"])
      expect(Check(apexInputSchema, { action })).toBe(false);
    expect(Check(apexInputSchema, { action: "test.run", tests: [] })).toBe(false);
    expect(Check(apexInputSchema, { action: "author.plan", limit: "bad" })).toBe(false);
    expect(Check(apexInputSchema, { action: "test.run", class_names: ["ExampleTest"] })).toBe(true);
    expect(Check(apexInputSchema, { action: "diagnose.file", file: "Example.cls" })).toBe(true);
  });
  it("runs local actions without connecting and writes only under the supplied artifact root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "apex-public-"));
    dirs.push(root);
    const connect = vi.fn();
    const ctx = {
      cwd: root,
      state: {},
      artifacts: createApexArtifactWriter(root, { private: true }),
      connect,
    };
    const plan = await executeApex({ action: "author.plan", target: "Example.cls" }, ctx);
    const log = await executeApex(
      { action: "log.analyze", body: "12:00:00.0 (100)|USER_DEBUG|[1]|DEBUG|hello" },
      ctx,
    );
    expect(plan.details.ok).toBe(true);
    expect(Check(apexDetailsSchemas["author.plan"], plan.details)).toBe(true);
    expect(Check(apexDetailsSchemas["log.analyze"], log.details)).toBe(true);
    const artifact = (log.details.artifacts as Array<{ path: string }>)[0];
    expect(artifact.path.startsWith(root + path.sep)).toBe(true);
    expect((await stat(artifact.path)).mode & 0o777).toBe(0o600);
    expect(connect).not.toHaveBeenCalled();
  });
  it("preserves native diagnostic evidence without claiming domain success", async () => {
    const result = await executeApex(
      { action: "diagnose.file", file: "Example.cls" },
      {
        cwd: "/workspace",
        state: {},
        artifacts: createApexArtifactWriter("/unused"),
        connect: vi.fn(),
        diagnostics: async () => ({
          diagnostics: [
            {
              severity: 1,
              message: "broken",
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            },
          ],
        }),
      },
    );
    expect(result.details).toMatchObject({ ok: true, status: "error", counts: { errors: 1 } });
    expect(result.details.digest).toMatchObject({ status: "fail" });
    expect(Check(apexDetailsSchemas["diagnose.file"], result.details)).toBe(true);
    expect(
      Check(apexDetailsSchemas["diagnose.file"], {
        ...result.details,
        diagnostics: [
          {
            message: "broken",
            range: { start: { line: "bad", character: 0 }, end: { line: 0, character: 1 } },
          },
        ],
      }),
    ).toBe(false);
  });
  it("validates artifact paths across all action evidence schemas", () => {
    for (const schema of Object.values(apexDetailsSchemas)) {
      expect(Check(schema, { artifacts: [{ path: "/evidence/result.json", kind: "tests" }] })).toBe(
        true,
      );
      expect(Check(schema, { artifacts: [{ path: 42, kind: "tests" }] })).toBe(false);
    }
  });
});

describe("Apex headless invocation", () => {
  it.each([
    ["test.run", "abort"],
    ["test.run", "timeout"],
    ["test.rerun", "abort"],
    ["test.rerun", "timeout"],
  ] as const)("does not submit %s after %s during preparation", async (action, cancellation) => {
    const workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), "apex-cancel-")));
    dirs.push(workspace);
    const resume = path.join(workspace, "prior.json");
    await writeFile(
      resume,
      JSON.stringify({
        schemaVersion: 1,
        state: {
          tool: "sf_apex",
          cwd: workspace,
          target_org: "ExampleOrg",
          state: { lastTestSpec: { class_names: ["ExampleTest"], target_org: "ExampleOrg" } },
        },
      }),
    );
    vi.spyOn(connections, "connectSalesforce").mockResolvedValue({
      target: { apiVersion: "67.0" },
      connection: {},
    } as connections.SalesforceSession);
    let entered!: () => void;
    let release!: () => void;
    const preparing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const prepared = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(TestService.prototype, "buildAsyncPayload").mockImplementation(async () => {
      entered();
      await prepared;
      return { testLevel: TestLevel.RunSpecifiedTests, tests: [] };
    });
    const submit = vi
      .spyOn(TestService.prototype, "runTestAsynchronous")
      .mockResolvedValue({ testRunId: "707000000000000AAA" });
    const controller = new AbortController();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const result = callApex(
      action === "test.run"
        ? { action, target_org: "ExampleOrg", class_names: ["ExampleTest"] }
        : { action, target_org: "ExampleOrg" },
      {
        workspace,
        artifactDir: workspace,
        resume: action === "test.rerun" ? resume : undefined,
        allowEffects: true,
        signal: controller.signal,
        timeoutMs: 60_000,
      },
    );
    try {
      await preparing;
      if (cancellation === "abort") controller.abort();
      else vi.advanceTimersByTime(60_000);
      expect((await result).error?.code).toBe(cancellation === "abort" ? "INTERRUPTED" : "TIMEOUT");
    } finally {
      release();
      // Let the operation resume after the caller has already received cancellation.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(submit).not.toHaveBeenCalled();
  });
  it("uses action validation and per-call authorization before connecting", async () => {
    expect((await invokeApex({ action: "anon.run" })).error?.code).toBe("INPUT");
    expect((await callApex({ action: "anon.run", body: "System.debug(1);" })).error?.code).toBe(
      "AUTHORIZATION",
    );
    const controller = new AbortController();
    controller.abort();
    expect(
      (await callApex({ action: "author.plan" }, { signal: controller.signal })).error?.code,
    ).toBe("INTERRUPTED");
  });
  it("runs concurrent callers in their own workspaces without changing process.cwd", async () => {
    const before = process.cwd();
    const first = await mkdtemp(path.join(os.tmpdir(), "apex-client-a-"));
    const second = await mkdtemp(path.join(os.tmpdir(), "apex-client-b-"));
    dirs.push(first, second);
    await writeFile(path.join(first, "sample.log"), "12:00:00.0 (1)|USER_DEBUG|[1]|DEBUG|first");
    await writeFile(path.join(second, "sample.log"), "12:00:00.0 (1)|USER_DEBUG|[1]|DEBUG|second");
    const input = { action: "log.analyze" as const, file: "sample.log" };
    const results = await Promise.all(
      [first, second].map((workspace) =>
        createApexClient({ workspace, artifactDir: workspace }).call(input),
      ),
    );
    expect(
      results.map((result) => result.result?.details.log_digest?.user_debug[0].message),
    ).toEqual(["first", "second"]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(input.file).toBe("sample.log");
    expect(process.cwd()).toBe(before);
  });
});
