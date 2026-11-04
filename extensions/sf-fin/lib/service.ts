/* SPDX-License-Identifier: Apache-2.0 */
/**
 * One implementation of doctor, install, and debug shared by the `/sf-fin`
 * command, Manager actions, the `sf_fin` tool, and `/sf-pi doctor`.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionDoctorReport } from "../../../lib/common/doctor/registry.ts";
import type { ExecFn } from "../../../lib/common/sf-environment/detect.ts";
import {
  armVerbose,
  buildDebugBundle,
  createFinDebugStore,
  disarmVerbose,
  takeVerboseRun,
  writeTraceArtifact,
} from "./debug.ts";
import {
  buildCachedChecks,
  createDoctorDeps,
  renderChecks,
  runDoctor,
  type DoctorDeps,
} from "./doctor.ts";
import {
  detectCli,
  fetchCliRegistryMetadata,
  readNpmReleaseAgeConfig,
  type FetchRegistryFn,
} from "./install/detect.ts";
import { planCliInstall, runCliInstall, type InstallPlan } from "./install/installer.ts";
import { buildStatusText, createFinStatusStore } from "./status.ts";
import { COMMAND_NAME, type FinOutcomeKind, type FinStatusSnapshot } from "./types.ts";
import { getFinCredential } from "./auth.ts";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import {
  formatValidation,
  procedureSchemaPath,
  simulateProcedure,
  simulationSchemaPath,
  uploadSimulationSet,
  uploadProcedureDraft,
  validateProcedureFile,
} from "./sdk-procedures.ts";
import {
  createSdkReadDeps,
  downloadResources,
  readManifest,
  type SdkReadDeps,
  type SdkReadResult,
} from "./sdk-reads.ts";

export interface FinService {
  doctor(ctx: ExtensionContext): Promise<{
    outcome: FinOutcomeKind;
    text: string;
    snapshot: FinStatusSnapshot;
    tracePath?: string;
  }>;
  planInstall(version?: string): Promise<InstallPlan>;
  install(plan: InstallPlan): Promise<{ ok: boolean; text: string; snapshot?: FinStatusSnapshot }>;
  debugBundle(meta: { sfPiVersion?: string; piVersion?: string }): string;
  setVerbose(on: boolean, runs?: number): string;
  cachedDoctorReport(): ExtensionDoctorReport;
  /** Fin-as-code reads. Enables the Fin SDK by default on first use. */
  sdk(ctx: ExtensionContext, operation: "manifest" | "download"): Promise<SdkReadResult>;
  /** Fin-as-code procedure lifecycle: local validate, draft upload, simulate. */
  procedure(ctx: ExtensionContext, request: ProcedureRequest): Promise<ProcedureResponse>;
}

export interface FinServiceDeps {
  exec: ExecFn;
  fetchRegistry?: FetchRegistryFn;
  doctorDeps?: DoctorDeps;
  sdkDeps?: SdkReadDeps;
}

export function createFinService(deps: FinServiceDeps): FinService {
  const statusStore = createFinStatusStore();
  const debugStore = createFinDebugStore();
  const fetchRegistry = deps.fetchRegistry ?? fetchCliRegistryMetadata;
  const doctorDeps = deps.doctorDeps ?? { ...createDoctorDeps(deps.exec), fetchRegistry };

  return {
    async doctor(ctx) {
      const verbose = takeVerboseRun(debugStore);
      const report = await runDoctor(ctx, doctorDeps, { verbose });
      let tracePath: string | undefined;
      if (verbose && report.meResult) {
        const credential = await getFinCredential(ctx);
        tracePath = writeTraceArtifact(
          report.meResult,
          credential.ok ? credential.credential.token : undefined,
          {
            args: ["me", "--json", "--verbose"],
          },
        );
        debugStore.update((current) => ({ ...current, lastTracePath: tracePath }));
      }
      statusStore.write(report.snapshot);
      const text = [
        report.message,
        "",
        renderChecks(report.checks),
        tracePath ? `\n🧪 Verbose trace (redacted): ${tracePath}` : undefined,
      ]
        .filter((line) => line !== undefined)
        .join("\n");
      return { outcome: report.outcome, text, snapshot: report.snapshot, tracePath };
    },

    async planInstall(version) {
      const [registry, npmPolicy] = await Promise.all([
        version ? Promise.resolve(undefined) : fetchRegistry(),
        readNpmReleaseAgeConfig(deps.exec),
      ]);
      const detection = await detectCli(deps.exec, { latestVersion: registry?.latest });
      return planCliInstall({ detection, registry, npmPolicy, requestedVersion: version });
    },

    async install(plan) {
      if (plan.kind === "noop") return { ok: true, text: plan.reason };
      if (plan.kind === "refused") {
        return { ok: false, text: [plan.reason, plan.manual].filter(Boolean).join("\n") };
      }
      const before = (await detectCli(deps.exec)).installedVersion;
      const run = await runCliInstall(deps.exec, plan);
      const detection = await detectCli(deps.exec, { latestVersion: plan.version });
      const snapshot = statusStore.update((current) => ({
        ...current,
        cliVersion: detection.installedVersion,
        cliPath: detection.binaryPath,
        installSource: detection.installSource,
        latestVersion: current.latestVersion ?? plan.version,
      }));
      const verified = run.ok && detection.installedVersion === plan.version;
      const lines = [
        verified
          ? `✅ ${run.message}`
          : `❌ ${run.ok ? "npm reported success, but the installed version did not verify." : run.message}`,
        `Command: ${plan.command}`,
        `Version: ${before ?? "none"} → ${detection.installedVersion ?? "not found"}`,
        detection.binaryPath ? `Path: ${detection.binaryPath}` : undefined,
        !verified && run.stderr ? `stderr:\n${run.stderr}` : undefined,
        verified ? `Next: /${COMMAND_NAME} doctor` : undefined,
      ].filter((line): line is string => Boolean(line));
      return { ok: verified, text: lines.join("\n"), snapshot };
    },

    debugBundle(meta) {
      return buildDebugBundle({
        snapshot: statusStore.read(),
        debug: debugStore.read(),
        ...meta,
      });
    },

    setVerbose(on, runs) {
      if (!on) {
        disarmVerbose(debugStore);
        return "Verbose tracing is off.";
      }
      const state = armVerbose(debugStore, runs);
      return [
        `Verbose tracing armed for the next ${state.verboseRuns} doctor run${state.verboseRuns === 1 ? "" : "s"}; it turns itself off afterwards.`,
        `Run /${COMMAND_NAME} doctor. The scrubbed trace is saved as an owner-only file and only its path is shown.`,
      ].join("\n");
    },

    async sdk(ctx, operation) {
      const credential = await getFinCredential(ctx);
      if (credential.ok === false) {
        return {
          ok: false,
          enabledNow: false,
          text: credential.message,
          details: { phase: "credential" },
        };
      }
      const appId = statusStore.read().identity?.appId;
      const sdkDeps = deps.sdkDeps ?? createSdkReadDeps(deps.exec, appId);
      if (operation === "manifest") return readManifest(credential.credential, sdkDeps, ctx.signal);
      return downloadResources(credential.credential, sdkDeps, sdkDownloadDir(appId), ctx.signal);
    },

    async procedure(ctx, request) {
      const appId = statusStore.read().identity?.appId;
      const schemaPath = procedureSchemaPath(sdkDownloadDir(appId));
      if (request.operation === "validate") {
        const result = validateProcedureFile(resolveFile(ctx.cwd, request.file), schemaPath);
        return {
          ok: result.ok,
          text: formatValidation(result),
          details: { phase: "validate", issues: result.issues },
        };
      }
      const credential = await getFinCredential(ctx);
      if (credential.ok === false) {
        return { ok: false, text: credential.message, details: { phase: "credential" } };
      }
      const sdkDeps = deps.sdkDeps ?? createSdkReadDeps(deps.exec, appId);
      if (request.operation === "upload_simulations") {
        return uploadSimulationSet(
          credential.credential,
          sdkDeps,
          {
            file: resolveFile(ctx.cwd, request.file),
            schemaPath: simulationSchemaPath(sdkDownloadDir(appId)),
          },
          ctx.signal,
        );
      }
      if (request.operation === "upload") {
        return uploadProcedureDraft(
          credential.credential,
          sdkDeps,
          { file: resolveFile(ctx.cwd, request.file), schemaPath, note: request.note },
          ctx.signal,
        );
      }
      if (!request.procedureId) {
        return {
          ok: false,
          text: "simulate requires procedure_id (from the upload result).",
          details: { phase: "input" },
        };
      }
      return simulateProcedure(
        credential.credential,
        sdkDeps,
        { procedureId: request.procedureId, generate: request.generate !== false },
        ctx.signal,
      );
    },

    cachedDoctorReport() {
      const snapshot = statusStore.read();
      const checks = buildCachedChecks(snapshot, existsSync(path.join(homedir(), ".intercom")));
      const worst = checks.some((c) => c.severity === "error")
        ? "✗ errors"
        : checks.some((c) => c.severity === "warn")
          ? "! needs attention"
          : "✓ ready";
      return { extensionId: "sf-fin", title: "SF Fin", checks, summary: worst };
    },
  };
}

export type ProcedureRequest =
  | { operation: "validate"; file?: string }
  | { operation: "upload"; file?: string; note?: string }
  | { operation: "upload_simulations"; file?: string }
  | { operation: "simulate"; procedureId?: string; generate?: boolean };

export interface ProcedureResponse {
  ok: boolean;
  text: string;
  details: Record<string, unknown>;
}

function resolveFile(cwd: string, file: string | undefined): string {
  if (!file?.trim()) return "";
  return path.isAbsolute(file) ? file : path.resolve(cwd, file);
}

/** Owner-only per-workspace download location under SF Pi state. */
export function sdkDownloadDir(appId: string | undefined): string {
  const safe = appId && /^[A-Za-z0-9_-]+$/.test(appId) ? appId : "workspace";
  return globalAgentPath("sf-pi", "sf-fin", "sdk", safe);
}

export function statusText(): string {
  return buildStatusText(createFinStatusStore().read());
}
