/* SPDX-License-Identifier: Apache-2.0 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { createApexDiagnosticsClient } from "../public.ts";

const roots: string[] = [];
const providers: ReturnType<typeof createApexDiagnosticsClient>[] = [];
afterEach(async () => {
  await Promise.all(providers.splice(0).map((p) => p.dispose()));
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function setup(mode: string, signal?: AbortSignal) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "apex-lsp-"));
  roots.push(cwd);
  const file = path.join(cwd, "Example.cls");
  const pidFile = path.join(cwd, "pid");
  await writeFile(file, "public class Example {}");
  const provider = createApexDiagnosticsClient({
    signal,
    initializeTimeoutMs: 400,
    shutdownTimeoutMs: 100,
    launch: async () => ({
      language: "apex",
      source: "fixture",
      detail: mode,
      command: process.execPath,
      args: [fileURLToPath(new URL("./fixtures/lsp-server.mjs", import.meta.url)), mode, pidFile],
    }),
  });
  providers.push(provider);
  return { provider, cwd, file, pidFile };
}
async function expectStopped(pidFile: string) {
  const pid = Number(await readFile(pidFile, "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
}
describe("headless Apex LSP", () => {
  it("reports a broken stdin without an unhandled rejection in the consumer process", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "apex-lsp-consumer-"));
    roots.push(cwd);
    const file = path.join(cwd, "Example.cls");
    const pidFile = path.join(cwd, "pid");
    const consumer = path.join(cwd, "consumer.mjs");
    const server = fileURLToPath(new URL("./fixtures/lsp-server.mjs", import.meta.url));
    await writeFile(file, "public class Example {}");
    await symlink(
      path.resolve("node_modules"),
      path.join(cwd, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
          import { createApexDiagnosticsClient } from './extensions/sf-apex/public.ts';
          const [cwd, file, pidFile, server] = process.argv.slice(2);
          const provider = createApexDiagnosticsClient({
            initializeTimeoutMs: 400, shutdownTimeoutMs: 100,
            launch: async () => ({ language: 'apex', source: 'fixture', detail: 'closed stdin',
              command: process.execPath, args: [server, 'closed-stdin', pidFile] }),
          });
          try { console.log(JSON.stringify(await provider.diagnose(file, cwd, 100))); }
          finally { await provider.dispose(); }
        `,
      },
      outfile: consumer,
      bundle: true,
      packages: "external",
      platform: "node",
      format: "esm",
    });
    try {
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        ["--unhandled-rejections=strict", consumer, cwd, file, pidFile, server],
        { timeout: 5000 },
      );
      expect(JSON.parse(stdout).unavailable?.available).toBe(false);
      expect(stderr).not.toContain("EPIPE");
      await expectStopped(pidFile);
    } finally {
      // Clean up the fixture even if a regression kills the consumer before its finally runs.
      const pid = Number(await readFile(pidFile, "utf8").catch(() => ""));
      if (pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // The provider normally already reaped the fixture.
        }
      }
    }
  });
  it.each(["clean", "error", "hang-shutdown"])(
    "reads %s evidence and reaps its process",
    async (mode) => {
      const { provider, cwd, file, pidFile } = await setup(mode);
      const result = await provider.diagnose(file, cwd, 400);
      expect(result.unavailable).toBeUndefined();
      expect(result.diagnostics).toHaveLength(mode === "error" ? 1 : 0);
      await provider.dispose();
      await expectStopped(pidFile);
    },
  );
  it.each(["silent", "stale", "exit", "hang-init"])(
    "reports %s as unavailable, never clean",
    async (mode) => {
      const { provider, cwd, file, pidFile } = await setup(mode);
      const result = await provider.diagnose(file, cwd, 100);
      expect(result.unavailable?.available).toBe(false);
      await provider.dispose();
      await expectStopped(pidFile);
    },
  );
  it("kills initialization on cancellation", async () => {
    const controller = new AbortController();
    const { provider, cwd, file, pidFile } = await setup("hang-init", controller.signal);
    const result = provider.diagnose(file, cwd, 100).catch((error) => error);
    await expect.poll(async () => readFile(pidFile, "utf8").catch(() => "")).not.toBe("");
    controller.abort(new Error("cancelled"));
    expect(await result).toMatchObject({ message: "cancelled" });
    await provider.dispose();
    await expectStopped(pidFile);
  });
  it("reports a missing executable without leaking a client", async () => {
    const { cwd, file } = await setup("clean");
    const provider = createApexDiagnosticsClient({
      launch: async () => ({
        language: "apex",
        source: "fixture",
        detail: "missing",
        command: path.join(cwd, "missing-java"),
        args: [],
      }),
      shutdownTimeoutMs: 50,
    });
    providers.push(provider);
    expect((await provider.diagnose(file, cwd, 100)).unavailable?.detail).toContain("ENOENT");
    await provider.dispose();
  });
});
