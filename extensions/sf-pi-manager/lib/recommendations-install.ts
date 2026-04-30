/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Thin wrapper around `pi install` / `pi remove`.
 *
 * We shell out rather than importing pi internals because the CLI is pi's
 * supported public surface for package management. Users can re-run the same
 * command by hand if we fail, which keeps recovery obvious.
 *
 * The wrapper is side-effect-free except for spawning the subprocess and is
 * tested by injecting a fake spawn implementation.
 */
import { spawn as realSpawn, type ChildProcess } from "node:child_process";

export type InstallScope = "global" | "project";

export interface InstallRunResult {
  success: boolean;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
}

/**
 * Minimal interface we need from spawn. Tests pass a stub that emits
 * canned stdout/stderr and a close event without launching a process.
 */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string },
) => Pick<ChildProcess, "stdout" | "stderr" | "on">;

export interface InstallOptions {
  cwd: string;
  /** Override for tests. Defaults to node:child_process spawn. */
  spawn?: SpawnFn;
  /** The pi CLI binary. Override for tests or alt installs. Defaults to "pi". */
  piBin?: string;
}

/** Run `pi install <source>` with the requested scope. */
export function installPackage(
  source: string,
  scope: InstallScope,
  options: InstallOptions,
): Promise<InstallRunResult> {
  const args = scope === "project" ? ["install", "-l", source] : ["install", source];
  return runPi(args, options);
}

/** Run `pi remove <source>` with the requested scope. */
export function removePackage(
  source: string,
  scope: InstallScope,
  options: InstallOptions,
): Promise<InstallRunResult> {
  const args = scope === "project" ? ["remove", "-l", source] : ["remove", source];
  return runPi(args, options);
}

function runPi(args: readonly string[], options: InstallOptions): Promise<InstallRunResult> {
  const piBin = options.piBin ?? "pi";
  const spawn = options.spawn ?? (realSpawn as unknown as SpawnFn);
  const command = `${piBin} ${args.join(" ")}`;

  return new Promise((resolve) => {
    let child: ReturnType<SpawnFn>;
    try {
      child = spawn(piBin, args, { cwd: options.cwd });
    } catch (error) {
      resolve({
        success: false,
        command,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: Error) => {
      resolve({
        success: false,
        command,
        exitCode: null,
        signal: null,
        stdout,
        stderr: stderr || error.message,
      });
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      resolve({
        success: code === 0,
        command,
        exitCode: code,
        signal,
        stdout,
        stderr,
      });
    });
  });
}
