/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Deploy a synthesized PermissionSet metadata XML to the target org via
 * `@salesforce/source-deploy-retrieve`. No `sf project deploy` subprocess.
 *
 * The synthesizer (custom-ps.ts) emits the XML as a string; this module
 * stages it under a temp directory in the SDR-friendly layout
 * (`<root>/permissionsets/<name>.permissionset-meta.xml`), invokes
 * ComponentSet.fromSource(...).deploy(), and cleans up the temp dir
 * regardless of outcome.
 *
 * Pattern mirrors the AiAuthoringBundle deploy already in lib/lifecycle.ts.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Connection } from "@salesforce/core";
import type { ComponentSet as ComponentSetType } from "@salesforce/source-deploy-retrieve";

let sdrPromise: Promise<{ ComponentSet: typeof ComponentSetType }> | undefined;
async function loadSdr() {
  sdrPromise ??= import("@salesforce/source-deploy-retrieve").then(({ ComponentSet }) => ({
    ComponentSet,
  }));
  return sdrPromise;
}

export interface DeployPermissionSetInput {
  developer_name: string;
  /** Already-rendered PermissionSet metadata XML. */
  xml: string;
}

export interface DeployPermissionSetOptions {
  /** Bound SDR deploy start; default intentionally shorter than SDR's 60-minute poll. */
  deployStartTimeoutMs?: number;
  /** Bound SDR deploy poll; default intentionally shorter than SDR's 60-minute poll. */
  deployPollTimeoutMs?: number;
  /** Caller cancellation signal from the Pi tool runtime. */
  signal?: AbortSignal;
}

export interface DeployPermissionSetResult {
  ok: boolean;
  /** Deploy job Id from SDR (mirrors the metadata-deploy id). */
  job_id?: string;
  /** Error message when ok=false. */
  error?: string;
  /** First component failure (if any) — surfaced as the most useful diagnostic. */
  first_problem?: string;
}

const PERMISSION_SET_DEPLOY_START_TIMEOUT_MS = 120_000;
const PERMISSION_SET_DEPLOY_POLL_TIMEOUT_MS = 120_000;
const PERMISSION_SET_DEPLOY_POLL_FREQUENCY_MS = 1_000;

async function withTimeout<T>(
  factory: () => Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
  onStop?: () => void | Promise<void>,
): Promise<T> {
  if (signal?.aborted) throw new Error(`${label} aborted before it started`);

  let timer: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined;
  let stopped = false;
  const stop = (reject: (reason?: unknown) => void, error: Error): void => {
    if (stopped) return;
    stopped = true;
    void onStop?.();
    reject(error);
  };
  try {
    return await Promise.race([
      factory(),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => stop(reject, new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        if (signal) {
          abortHandler = () => stop(reject, new Error(`${label} aborted`));
          signal.addEventListener("abort", abortHandler, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

/**
 * Stage `xml` to a temp directory, deploy via SDR, clean up on the way out.
 * Idempotent at the platform level: PermissionSet deploys overwrite the
 * existing record when it already exists.
 */
export async function deployPermissionSet(
  conn: Connection,
  input: DeployPermissionSetInput,
  options: DeployPermissionSetOptions = {},
): Promise<DeployPermissionSetResult> {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "sf-agentscript-ps-"));
  const psDir = path.join(tmpRoot, "permissionsets");
  await mkdir(psDir, { recursive: true });
  const fileName = `${input.developer_name}.permissionset-meta.xml`;
  const filePath = path.join(psDir, fileName);
  try {
    await writeFile(filePath, input.xml, "utf8");
    const { ComponentSet } = await loadSdr();
    const componentSet = ComponentSet.fromSource(tmpRoot);
    const deployStartTimeoutMs =
      options.deployStartTimeoutMs ?? PERMISSION_SET_DEPLOY_START_TIMEOUT_MS;
    const deployPollTimeoutMs =
      options.deployPollTimeoutMs ?? PERMISSION_SET_DEPLOY_POLL_TIMEOUT_MS;
    const deployJob = await withTimeout(
      () => componentSet.deploy({ usernameOrConnection: conn }),
      deployStartTimeoutMs,
      "PermissionSet deploy start",
      options.signal,
    );
    const deployResult = await withTimeout(
      () =>
        deployJob.pollStatus(
          PERMISSION_SET_DEPLOY_POLL_FREQUENCY_MS,
          Math.ceil(deployPollTimeoutMs / 1000),
        ),
      deployPollTimeoutMs,
      "PermissionSet deploy poll",
      options.signal,
      () => deployJob.cancel?.(),
    );
    const success = deployResult.response?.success === true;
    if (success) {
      return { ok: true, job_id: deployResult.response?.id };
    }
    const failures = (deployResult.response?.details?.componentFailures ?? []) as
      unknown | unknown[];
    const failArr = Array.isArray(failures) ? failures : [failures];
    const firstProblem = (failArr[0] as { problem?: string } | undefined)?.problem ?? "unknown";
    return {
      ok: false,
      job_id: deployResult.response?.id,
      first_problem: firstProblem,
      error: `PermissionSet deploy failed: ${firstProblem}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      await rm(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}
