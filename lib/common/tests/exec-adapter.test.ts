/* SPDX-License-Identifier: Apache-2.0 */
/**
 * buildExecFn routes `.cmd` wrappers through the shared Windows resolver, so
 * every ExecFn consumer (SF CLI detection, startup probes, doctors) launches
 * shell-free on Windows and stays unchanged elsewhere.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildExecFn } from "../exec-adapter.ts";
import { clearWindowsSpawnCache } from "../windows-spawn.ts";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const originalPath = process.env.PATH;
let root: string;

function fakePi() {
  const exec = vi.fn(async () => ({ stdout: "ok", stderr: "", code: 0, killed: false }));
  return { pi: { exec } as unknown as ExtensionAPI, exec };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "sf-pi-exec-adapter-"));
  clearWindowsSpawnCache();
});

afterEach(() => {
  if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  process.env.PATH = originalPath;
  rmSync(root, { recursive: true, force: true });
  clearWindowsSpawnCache();
});

describe("buildExecFn", () => {
  it("passes commands through unchanged off Windows", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const { pi, exec } = fakePi();
    await buildExecFn(pi, "/work")("sf", ["--version"], { timeout: 5 });
    expect(exec).toHaveBeenCalledWith("sf", ["--version"], { timeout: 5, cwd: "/work" });
  });

  // Uses the real file system, so it needs real Windows paths; the injected-FS
  // cases in windows-spawn.test.ts cover the resolver on every runner.
  it.runIf(process.platform === "win32")(
    "runs an npm .cmd wrapper's entry with node on Windows",
    async () => {
      const entry = path.join(root, "node_modules", "hunkdiff", "bin", "hunk.cjs");
      mkdirSync(path.dirname(entry), { recursive: true });
      writeFileSync(entry, "");
      writeFileSync(
        path.join(root, "hunk.cmd"),
        '"%_prog%"  "%dp0%\\node_modules\\hunkdiff\\bin\\hunk.cjs" %*\r\n',
      );
      process.env.PATH = root;
      const { pi, exec } = fakePi();
      await buildExecFn(pi)("hunk", ["--version"]);
      const [command, args] = exec.mock.calls[0] as unknown as [string, string[]];
      expect(command).toBe(process.execPath);
      expect(args.at(-1)).toBe("--version");
      expect(args[0]?.toLowerCase().endsWith("hunk.cjs")).toBe(true);
    },
  );
});
