/* SPDX-License-Identifier: Apache-2.0 */
/** Headless Apex invocation policy shared by the SDK and CLI. Native Pi uses executeApex. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Check } from "typebox/value";
import { apexInputSchema, type ApexInput, type ApexDetails } from "./contracts.ts";
import { apexActions } from "./schema.ts";
import { executeApex, type ApexExecutionContext } from "./execute.ts";
import { createApexArtifactWriter } from "./artifact-writer.ts";
import { createApexDiagnosticsClient } from "./diagnostics-client.ts";
import { apexErrorResult } from "./errors.ts";
import type { SfApexAction, SfApexParams, SfApexSessionState, ToolResult } from "./types.ts";

export interface ApexCallOptions {
  workspace?: string;
  artifactDir?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  allowEffects?: boolean;
  resume?: string;
}
export interface ApexClientOptions extends Pick<
  ApexCallOptions,
  "workspace" | "artifactDir" | "timeoutMs"
> {
  targetOrg?: string;
}
export type ApexCallErrorCode =
  "INPUT" | "UNSUPPORTED" | "AUTHORIZATION" | "OPERATION" | "TIMEOUT" | "INTERRUPTED";
export type ApexToolResult<A extends SfApexAction = SfApexAction> = Omit<ToolResult, "details"> & {
  details: ApexDetails<A> & { ok?: boolean; kind?: string; [key: string]: unknown };
};
export type ApexCallResult<A extends SfApexAction = SfApexAction> = {
  schemaVersion: 1;
  ok: boolean;
  tool: "sf_apex";
} & (
  | { action: A; runId: string; runFile: string; result: ApexToolResult<A>; error?: never }
  | {
      action?: string;
      error: { code: ApexCallErrorCode; message: string };
      result?: never;
    }
);
export interface ApexClient {
  call<A extends SfApexAction>(
    input: ApexInput<A> & { action: A },
    options?: ApexCallOptions,
  ): Promise<ApexCallResult<A>>;
}
class CallError extends Error {
  constructor(
    readonly code: ApexCallErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Typed callers and dynamic callers use exactly the same runtime validation and policy. */
export function callApex<A extends SfApexAction>(
  input: ApexInput<A> & { action: A },
  options?: ApexCallOptions,
): Promise<ApexCallResult<A>> {
  return invokeApex(input, options) as Promise<ApexCallResult<A>>;
}
export function createApexClient(options: ApexClientOptions = {}): ApexClient {
  const { targetOrg, ...defaults } = { ...options };
  return {
    call<A extends SfApexAction>(
      input: ApexInput<A> & { action: A },
      options?: ApexCallOptions,
    ): Promise<ApexCallResult<A>> {
      return invokeApex(
        { ...input, target_org: input.target_org ?? targetOrg },
        { ...defaults, ...options },
      ) as Promise<ApexCallResult<A>>;
    },
  };
}

/** For JSON/agent inputs; no connection or LSP is created until a validated action needs it. */
export async function invokeApex(
  rawInput: unknown,
  options: ApexCallOptions = {},
): Promise<ApexCallResult> {
  options = { ...options };
  const controller = new AbortController();
  const abort = () =>
    controller.abort(
      new CallError(
        "INTERRUPTED",
        "Execution interrupted. Remote work already submitted may still be running.",
      ),
    );
  const diagnostics = createApexDiagnosticsClient({ signal: controller.signal });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  let action: SfApexAction;
  try {
    let input: SfApexParams;
    try {
      input = structuredClone(rawInput) as SfApexParams;
    } catch {
      throw new CallError("INPUT", "Input must be a JSON object.");
    }
    action = input?.action;
    if (!Check(apexInputSchema, input))
      throw new CallError(
        "INPUT",
        "Input does not match the Apex schema. Use tools describe for required fields and allowed values.",
      );
    const timeoutMs = options.timeoutMs ?? 120000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000)
      throw new CallError("INPUT", "timeoutMs must be an integer from 1 to 3600000.");
    if (options.allowEffects !== undefined && typeof options.allowEffects !== "boolean")
      throw new CallError("INPUT", "allowEffects must be a boolean.");
    const capability = apexActions[input.action];
    if (capability.effects && options.allowEffects !== true)
      throw new CallError(
        "AUTHORIZATION",
        "This action requires allowEffects: true (CLI: --allow-effects) for this invocation.",
      );
    if (capability.requiresPreviousTest && !options.resume)
      throw new CallError("INPUT", "This action requires a resume run file from a prior call.");
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    controller.signal.throwIfAborted();
    timer = setTimeout(
      () =>
        controller.abort(
          new CallError(
            "TIMEOUT",
            "Execution timed out. Remote work already submitted may still be running.",
          ),
        ),
      timeoutMs,
    );
    const interrupted = new Promise<never>((_, reject) => {
      abortHandler = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", abortHandler, { once: true });
    });
    return await Promise.race([
      run(input, options, controller.signal, diagnostics.diagnose),
      interrupted,
    ]);
  } catch (error) {
    return {
      schemaVersion: 1,
      ok: false,
      tool: "sf_apex",
      action,
      error:
        error instanceof CallError
          ? { code: error.code, message: error.message }
          : {
              code: "OPERATION",
              message:
                "Apex execution failed. Check the input, workspace, credentials, and prerequisites.",
            },
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    if (abortHandler) controller.signal.removeEventListener("abort", abortHandler);
    // LSP cleanup completes before the SDK returns or the CLI exits, including cancellation.
    await diagnostics.dispose();
  }
}

async function run(
  input: SfApexParams,
  options: ApexCallOptions,
  signal: AbortSignal,
  diagnostics: ApexExecutionContext["diagnostics"],
): Promise<ApexCallResult> {
  let cwd: string;
  try {
    cwd = await realpath(options.workspace ?? process.cwd());
    if (!(await stat(cwd)).isDirectory()) throw new Error();
  } catch {
    throw new CallError("INPUT", "workspace must be an existing directory.");
  }
  let state: SfApexSessionState = {};
  if (options.resume) {
    if (!input.target_org)
      throw new CallError("INPUT", "Resume requires the same explicit target_org on both calls.");
    try {
      const record = JSON.parse(await readFile(options.resume, "utf8"));
      const previous = record.state;
      if (
        record.schemaVersion !== 1 ||
        previous.tool !== "sf_apex" ||
        previous.cwd !== cwd ||
        previous.target_org !== input.target_org ||
        !previous.state ||
        typeof previous.state !== "object" ||
        Array.isArray(previous.state)
      )
        throw new Error();
      state = previous.state;
    } catch {
      throw new CallError(
        "INPUT",
        "Resume file must match this tool, workspace, and explicit target_org.",
      );
    }
  }
  signal.throwIfAborted();
  const runId = randomUUID();
  const artifactDir = path.join(
    path.resolve(options.artifactDir ?? path.join(os.tmpdir(), "sf-pi-apex")),
    runId,
  );
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  signal.throwIfAborted();
  const params = { ...input };
  if (params.action === "log.analyze" && params.file) params.file = path.resolve(cwd, params.file);
  let result: ToolResult;
  try {
    result = await executeApex(params, {
      cwd,
      signal,
      state,
      diagnostics,
      artifacts: createApexArtifactWriter(path.join(artifactDir, "sf-apex"), {
        private: true,
        signal,
      }),
      async connect(options) {
        const session = await (
          await import("../../../lib/common/sf-conn/index.ts")
        ).connectSalesforce(options);
        return {
          ...session,
          identity: (options) => session.identity({ ...options, signal }),
          request: (input) => session.request({ ...input, signal }),
          continueRequest: (input) => session.continueRequest({ ...input, signal }),
          query: (input) => session.query({ ...input, signal }),
        };
      },
    });
  } catch (error) {
    signal.throwIfAborted();
    result = apexErrorResult(params, error);
  }
  signal.throwIfAborted();
  const runFile = path.join(artifactDir, "run.json");
  await writeFile(
    `${runFile}.tmp`,
    JSON.stringify({
      schemaVersion: 1,
      state: { tool: "sf_apex", cwd, target_org: input.target_org ?? null, state },
    }) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  signal.throwIfAborted();
  await rename(`${runFile}.tmp`, runFile);
  signal.throwIfAborted();
  return {
    schemaVersion: 1,
    ok: apexSucceeded(result),
    tool: "sf_apex",
    action: input.action,
    runId,
    runFile,
    result: result as ApexToolResult,
  };
}

/** Native ok means evidence was retrieved; caller success also requires a passing outcome. */
function apexSucceeded(result: ToolResult): boolean {
  if (result.details.ok === false) return false;
  if (result.details.kind === "diagnostics")
    return result.details.status !== "error" && result.details.status !== "unavailable";
  if (result.details.kind === "anonymous_apex") {
    const outcome = result.details.result as { compiled?: boolean; success?: boolean } | undefined;
    return outcome?.compiled === true && outcome.success === true;
  }
  if (result.details.kind === "apex_test") {
    const summary = result.details.summary as { failing?: number } | undefined;
    const outcome = (result.details.test_result_summary as { outcome?: string } | undefined)
      ?.outcome;
    if ((summary?.failing ?? 0) > 0 || /^(failed|aborted)$/i.test(outcome ?? "")) return false;
  }
  return true;
}
