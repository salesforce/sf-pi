/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import { buildCodeAnalyzerExec } from "../lib/exec.ts";

function fakePi() {
  const exec = vi.fn(async () => ({ stdout: "", stderr: "", code: 0, killed: false }));
  return { exec, pi: { exec } as unknown as Parameters<typeof buildCodeAnalyzerExec>[0] };
}

function withPlatform<T>(platform: NodeJS.Platform, fn: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });
  return fn().finally(() => {
    if (original) Object.defineProperty(process, "platform", original);
  });
}

describe("buildCodeAnalyzerExec", () => {
  it("routes sf through cmd.exe on Windows", async () => {
    const { exec, pi } = fakePi();
    await withPlatform("win32", async () => {
      await buildCodeAnalyzerExec(pi)("sf", ["--version"], { timeout: 1000 });
    });
    expect(exec).toHaveBeenCalledWith(
      "cmd.exe",
      ["/d", "/c", "sf", "--version"],
      expect.objectContaining({ timeout: 1000 }),
    );
  });

  it("leaves sf unchanged on non-Windows platforms", async () => {
    const { exec, pi } = fakePi();
    await withPlatform("linux", async () => {
      await buildCodeAnalyzerExec(pi)("sf", ["--version"]);
    });
    expect(exec).toHaveBeenCalledWith("sf", ["--version"], expect.anything());
  });

  it("leaves other commands unchanged on Windows", async () => {
    const { exec, pi } = fakePi();
    await withPlatform("win32", async () => {
      await buildCodeAnalyzerExec(pi)("java", ["-version"]);
    });
    expect(exec).toHaveBeenCalledWith("java", ["-version"], expect.anything());
  });
});
