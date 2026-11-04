/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Explicit Fin SDK gate.
 *
 * The Fin CLI silently calls `POST /fin-sdk/enable` and retries whenever a
 * `fin …` command receives `403 fin_sdk_not_enabled`. SF Fin never lets that
 * happen implicitly:
 *
 * - `probeFinSdk` reads `GET /fin-sdk/manifest` directly, with no retry or
 *   enablement, and reports enabled / not_enabled / error.
 * - `enableFinSdk` performs the one explicit `POST /fin-sdk/enable`. The
 *   agent-facing call is SF Guardrail-mediated before it runs.
 * - Read commands that go through the CLI (`fin manifest`, `fin download`)
 *   run only after the probe reports `enabled`, so the CLI's auto-enable path
 *   can never fire.
 *
 * The token is sent only as the Authorization header and never logged.
 */
import type { FinCredential } from "./auth.ts";
import { redactSecret } from "./cli-runner.ts";
import type { FinRegion } from "./types.ts";

const REQUEST_TIMEOUT_MS = 15_000;
export const FIN_SDK_GATE_CODE = "fin_sdk_not_enabled";

const API_BASE_URLS: Record<FinRegion, string> = {
  us: "https://api.intercom.io",
  eu: "https://api.eu.intercom.io",
  au: "https://api.au.intercom.io",
};

export type FinSdkState = "enabled" | "not_enabled" | "error";

export interface FinSdkProbe {
  state: FinSdkState;
  status?: number;
  code?: string;
  message?: string;
  /** Manifest section sizes when enabled (e.g. procedures: 0). */
  counts?: Record<string, number>;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export async function probeFinSdk(
  credential: FinCredential,
  options: { fetch?: FetchFn; signal?: AbortSignal } = {},
): Promise<FinSdkProbe> {
  const res = await request("GET", "/fin-sdk/manifest", credential, options);
  if (res.ok === false) return { state: "error", message: res.message };
  const { status, json } = res;
  if (status === 200 && json && typeof json === "object" && !Array.isArray(json)) {
    const counts = Object.fromEntries(
      Object.entries(json as Record<string, unknown>)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [key, (value as unknown[]).length]),
    );
    return { state: "enabled", status, counts };
  }
  const error = firstError(json);
  if (status === 403 && error?.code === FIN_SDK_GATE_CODE) {
    return { state: "not_enabled", status, code: error.code, message: error.message };
  }
  return {
    state: "error",
    status,
    code: error?.code,
    message: redactSecret(error?.message ?? `Unexpected HTTP ${status}.`, credential.token),
  };
}

export interface FinSdkEnableResult {
  ok: boolean;
  status?: number;
  message: string;
  after?: FinSdkProbe;
}

export async function enableFinSdk(
  credential: FinCredential,
  options: { fetch?: FetchFn; signal?: AbortSignal } = {},
): Promise<FinSdkEnableResult> {
  const before = await probeFinSdk(credential, options);
  if (before.state === "enabled") {
    return {
      ok: true,
      status: before.status,
      message: "Fin SDK is already enabled.",
      after: before,
    };
  }
  if (before.state === "error") {
    return { ok: false, status: before.status, message: `Fin SDK probe failed: ${before.message}` };
  }
  const res = await request("POST", "/fin-sdk/enable", credential, options, {});
  if (res.ok === false) return { ok: false, message: res.message };
  if (res.status < 200 || res.status >= 300) {
    const error = firstError(res.json);
    return {
      ok: false,
      status: res.status,
      message: redactSecret(
        `Enable failed (HTTP ${res.status})${error?.code ? ` ${error.code}` : ""}${error?.message ? `: ${error.message}` : ""}.`,
        credential.token,
      ),
    };
  }
  const after = await probeFinSdk(credential, options);
  return after.state === "enabled"
    ? { ok: true, status: res.status, message: "Fin SDK enabled and verified.", after }
    : {
        ok: false,
        status: res.status,
        message: `Enable returned HTTP ${res.status}, but the manifest still reports ${after.state}.`,
        after,
      };
}

async function request(
  method: "GET" | "POST",
  path: string,
  credential: FinCredential,
  options: { fetch?: FetchFn; signal?: AbortSignal },
  body?: unknown,
): Promise<{ ok: true; status: number; json: unknown } | { ok: false; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await (options.fetch ?? fetch)(`${API_BASE_URLS[credential.region]}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${credential.token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { ok: true, status: res.status, json };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: redactSecret(`Request to Fin failed: ${message}`, credential.token),
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function firstError(json: unknown): { code?: string; message?: string } | undefined {
  if (!json || typeof json !== "object") return undefined;
  const errors = (json as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || !errors[0] || typeof errors[0] !== "object") return undefined;
  const first = errors[0] as Record<string, unknown>;
  return {
    code: typeof first.code === "string" ? first.code : undefined,
    message: typeof first.message === "string" ? first.message : undefined,
  };
}
