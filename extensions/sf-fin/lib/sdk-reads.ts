/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fin-as-code read operations: `manifest` and `download`.
 *
 * Using SF Fin's Fin SDK actions enables the Fin SDK by default. Before the
 * first CLI call, `ensureFinSdkEnabled` probes the manifest directly. When the
 * workspace is not enabled, it performs the explicit `POST /fin-sdk/enable`,
 * verifies it, records the state, and only then runs the CLI, so the CLI never
 * reaches its own silent auto-enable path. SF Guardrail treats a first call on
 * a not-yet-enabled workspace as a workspace mutation (auto-approved under
 * Power Tool Mode); later reads on an enabled workspace stay prompt-free.
 */
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { readFinSdkState, writeFinSdkState } from "../../../lib/common/fin-sdk-state.ts";
import type { ExecFn } from "../../../lib/common/sf-environment/detect.ts";
import type { FinCredential } from "./auth.ts";
import {
  classifyCliResult,
  readCliErrorMessage,
  runFinCli,
  type CliRunOptions,
  type CliRunResult,
} from "./cli-runner.ts";
import { enableFinSdk, probeFinSdk, type FetchFn, type FinSdkProbe } from "./sdk-gate.ts";

export interface SdkReadDeps {
  run(args: string[], options: CliRunOptions): Promise<CliRunResult>;
  exec: ExecFn;
  fetch?: FetchFn;
  now(): Date;
  appId?: string;
}

export function createSdkReadDeps(exec: ExecFn, appId?: string): SdkReadDeps {
  return { run: runFinCli, exec, now: () => new Date(), appId };
}

export interface EnsureResult {
  ok: boolean;
  /** True when this call performed the enable. */
  enabledNow: boolean;
  message: string;
  probe?: FinSdkProbe;
}

export async function ensureFinSdkEnabled(
  credential: FinCredential,
  deps: Pick<SdkReadDeps, "fetch" | "now" | "appId">,
  signal?: AbortSignal,
): Promise<EnsureResult> {
  const probe = await probeFinSdk(credential, { fetch: deps.fetch, signal });
  const checkedAt = deps.now().toISOString();
  if (probe.state === "enabled") {
    writeFinSdkState({ ...readFinSdkState(), state: "enabled", appId: deps.appId, checkedAt });
    return { ok: true, enabledNow: false, message: "Fin SDK is enabled.", probe };
  }
  if (probe.state === "error") {
    return {
      ok: false,
      enabledNow: false,
      message: `Fin SDK probe failed: ${probe.message}`,
      probe,
    };
  }
  const result = await enableFinSdk(credential, { fetch: deps.fetch, signal });
  if (!result.ok) {
    writeFinSdkState({ state: "not_enabled", appId: deps.appId, checkedAt });
    return { ok: false, enabledNow: false, message: result.message, probe: result.after };
  }
  writeFinSdkState({ state: "enabled", appId: deps.appId, checkedAt, enabledBySfFinAt: checkedAt });
  return {
    ok: true,
    enabledNow: true,
    message: "Fin SDK was not enabled for this workspace; SF Fin enabled and verified it.",
    probe: result.after,
  };
}

export interface ManifestSummary {
  workspace?: { name?: string; appIdCode?: string };
  counts: Record<string, number>;
  items: Record<string, Array<{ id?: string; name?: string; state?: string }>>;
}

export function summarizeManifest(raw: unknown): ManifestSummary {
  const manifest = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ws = (
    manifest.workspace && typeof manifest.workspace === "object" ? manifest.workspace : {}
  ) as Record<string, unknown>;
  const counts: Record<string, number> = {};
  const items: ManifestSummary["items"] = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (!Array.isArray(value)) continue;
    counts[key] = value.length;
    items[key] = value.slice(0, 25).map((entry) => {
      const record = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const str = (v: unknown) =>
        typeof v === "string" || typeof v === "number" ? String(v) : undefined;
      return {
        id: str(record.id),
        name: str(record.name ?? record.title),
        state: str(record.state),
      };
    });
  }
  return {
    workspace: {
      name: typeof ws.name === "string" ? ws.name : undefined,
      appIdCode: typeof ws.app_id_code === "string" ? ws.app_id_code : undefined,
    },
    counts,
    items,
  };
}

export type SdkReadResult =
  | { ok: true; enabledNow: boolean; text: string; details: Record<string, unknown> }
  | { ok: false; enabledNow: boolean; text: string; details: Record<string, unknown> };

export async function readManifest(
  credential: FinCredential,
  deps: SdkReadDeps,
  signal?: AbortSignal,
): Promise<SdkReadResult> {
  const ensured = await ensureFinSdkEnabled(credential, deps, signal);
  if (!ensured.ok)
    return { ok: false, enabledNow: false, text: ensured.message, details: { phase: "enable" } };

  const result = await deps.run(["fin", "manifest", "--json"], { credential, signal });
  if (classifyCliResult(result) !== "ok") {
    return {
      ok: false,
      enabledNow: ensured.enabledNow,
      text: readCliErrorMessage(result) ?? "intercom fin manifest failed.",
      details: { phase: "manifest", outcome: classifyCliResult(result) },
    };
  }
  let summary: ManifestSummary;
  try {
    summary = summarizeManifest(JSON.parse(result.stdout));
  } catch {
    return {
      ok: false,
      enabledNow: ensured.enabledNow,
      text: "The Fin CLI returned an unparseable manifest.",
      details: { phase: "manifest" },
    };
  }
  const lines = [
    ensured.enabledNow ? `🔓 ${ensured.message}` : undefined,
    `Fin SDK manifest — ${summary.workspace?.name ?? "workspace"}`,
    ...Object.entries(summary.counts).map(([key, count]) => `- ${key}: ${count}`),
    ...Object.entries(summary.items)
      .filter(([, list]) => list.length > 0)
      .flatMap(([key, list]) => [
        "",
        `${key}:`,
        ...list.map(
          (item) =>
            `  • ${item.name ?? "(unnamed)"}${item.id ? ` [${item.id}]` : ""}${item.state ? ` · ${item.state}` : ""}`,
        ),
      ]),
  ].filter((line): line is string => line !== undefined);
  return {
    ok: true,
    enabledNow: ensured.enabledNow,
    text: lines.join("\n"),
    details: { phase: "manifest", summary },
  };
}

export async function downloadResources(
  credential: FinCredential,
  deps: SdkReadDeps,
  outputDir: string,
  signal?: AbortSignal,
): Promise<SdkReadResult> {
  const ensured = await ensureFinSdkEnabled(credential, deps, signal);
  if (!ensured.ok)
    return { ok: false, enabledNow: false, text: ensured.message, details: { phase: "enable" } };

  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const zipPath = path.join(outputDir, "fin-resources.zip");
  const extractDir = path.join(outputDir, "resources");
  const result = await deps.run(["fin", "download", "--output", zipPath], {
    credential,
    signal,
    timeoutMs: 120_000,
  });
  if (classifyCliResult(result) !== "ok") {
    return {
      ok: false,
      enabledNow: ensured.enabledNow,
      text: readCliErrorMessage(result) ?? "intercom fin download failed.",
      details: { phase: "download", outcome: classifyCliResult(result) },
    };
  }

  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true, mode: 0o700 });
  const unzip = await deps.exec("unzip", ["-q", "-o", zipPath, "-d", extractDir], {
    timeout: 60_000,
  });
  if (unzip.code !== 0) {
    return {
      ok: false,
      enabledNow: ensured.enabledNow,
      text: `Downloaded ${zipPath}, but extraction failed: ${unzip.stderr.trim() || "unzip error"}.`,
      details: { phase: "extract", zipPath },
    };
  }
  const files = listFiles(extractDir);
  const lines = [
    ensured.enabledNow ? `🔓 ${ensured.message}` : undefined,
    `Downloaded Fin SDK resources: ${files.length} file${files.length === 1 ? "" : "s"}`,
    `ZIP: ${zipPath}`,
    `Extracted: ${extractDir}`,
    ...files.slice(0, 50).map((file) => `  • ${file.path} (${file.bytes} B)`),
    files.length > 50 ? `  … ${files.length - 50} more` : undefined,
  ].filter((line): line is string => line !== undefined);
  return {
    ok: true,
    enabledNow: ensured.enabledNow,
    text: lines.join("\n"),
    details: { phase: "download", zipPath, extractDir, files: files.slice(0, 200) },
  };
}

function listFiles(root: string): Array<{ path: string; bytes: number }> {
  const out: Array<{ path: string; bytes: number }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else out.push({ path: path.relative(root, full), bytes: stat.size });
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
