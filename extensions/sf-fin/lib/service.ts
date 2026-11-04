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
import { getFinAgentApiKey, getFinCredential } from "./auth.ts";
import {
  agentKeyCachedCheck,
  agentKeyStatusLines,
  createAgentKeyStatusStore,
  detectAgentKeySource,
  sameSecret,
  type AgentKeyStatus,
} from "./agent-key.ts";
import {
  accessText,
  createAgentApiClient,
  probeAgentApiAccess,
  runScriptedConversation,
  type AgentApiDeps,
  type ScriptedRun,
} from "./agent-api.ts";
import {
  createDataConnector,
  detectResourceKind,
  resourceSchemaPath,
  setGuidanceState,
  uploadResource,
  validateResourceFile,
} from "./sdk-resources.ts";
import { runFinCli } from "./cli-runner.ts";
import {
  cliHelpRunner,
  compareSurfaces,
  crawlCliCommands,
  formatSurfaceReport,
} from "./surfaces.ts";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import {
  formatValidation,
  procedureSchemaPath,
  setProcedureState,
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
  /** Fin-as-code procedure lifecycle: validate, draft upload, simulate, publish/pause. */
  procedure(ctx: ExtensionContext, request: ProcedureRequest): Promise<ProcedureResponse>;
  /** Compare Fin CLI, Intercom MCP, and Fin Agent API surfaces (local, read-only). */
  surfaces(): Promise<ProcedureResponse>;
  /** Fin Agent API harness: access check, capabilities, scripted runs. */
  agent(ctx: ExtensionContext, request: AgentRequest): Promise<ProcedureResponse>;
}

export interface FinServiceDeps {
  exec: ExecFn;
  fetchRegistry?: FetchRegistryFn;
  doctorDeps?: DoctorDeps;
  sdkDeps?: SdkReadDeps;
  agentDeps?: AgentApiDeps;
  /** Test seam for the surfaces crawl (defaults to the installed Fin CLI). */
  helpRunner?: Parameters<typeof crawlCliCommands>[0];
  /** Test seam: Agent API status store. */
  agentStatusStore?: ReturnType<typeof createAgentKeyStatusStore>;
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
      const sdkDir = sdkDownloadDir(appId);
      const filePath =
        request.operation === "validate" || request.operation === "upload"
          ? resolveFile(ctx.cwd, request.file)
          : undefined;
      const kind = filePath ? detectResourceKind(filePath) : undefined;
      if (request.operation === "validate" && filePath && kind && kind !== "procedure") {
        const result = validateResourceFile(filePath, kind, resourceSchemaPath(sdkDir, kind));
        return {
          ok: result.ok,
          text: formatValidation(result),
          details: { phase: "validate", kind, issues: result.issues },
        };
      }
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
      if (request.operation === "upload" && filePath && kind && kind !== "procedure") {
        return uploadResource(
          credential.credential,
          sdkDeps,
          {
            file: filePath,
            kind,
            schemaPath: resourceSchemaPath(sdkDir, kind),
            note: request.note,
          },
          ctx.signal,
        );
      }
      if (request.operation === "create_data_connector") {
        return createDataConnector(
          credential.credential,
          sdkDeps,
          { name: request.name ?? "" },
          ctx.signal,
        );
      }
      if (request.operation === "guidance_state") {
        if (request.state !== "live" && request.state !== "paused") {
          return {
            ok: false,
            text: "guidance_state requires state='live' or state='paused'.",
            details: { phase: "input" },
          };
        }
        return setGuidanceState(
          credential.credential,
          sdkDeps,
          {
            guidanceId: request.guidanceId ?? "",
            target: request.state,
            execute: request.execute === true,
          },
          ctx.signal,
        );
      }
      if (request.operation === "publish" || request.operation === "pause") {
        return setProcedureState(
          credential.credential,
          sdkDeps,
          {
            procedureId: request.procedureId ?? "",
            target: request.operation === "publish" ? "live" : "paused",
            execute: request.execute === true,
            note: request.note,
          },
          ctx.signal,
        );
      }
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

    async surfaces() {
      const help = deps.helpRunner ?? cliHelpRunner(runFinCli);
      const commands = await crawlCliCommands(help);
      const versionText = commands ? await help(["--version"]) : undefined;
      const cliVersion = versionText?.match(/\d+\.\d+\.\d+/)?.[0];
      const report = compareSurfaces({ cliCommands: commands, cliVersion });
      const drift =
        report.unmappedCli.length +
        report.missingCli.length +
        report.unmappedMcp.length +
        report.missingMcp.length;
      return {
        ok: commands !== undefined && drift === 0,
        text: formatSurfaceReport(report),
        details: {
          phase: "surfaces",
          cliVersion,
          cliCommands: report.cliCommands,
          mcpTools: report.mcpTools,
          unmappedCli: report.unmappedCli,
          missingCli: report.missingCli,
          unmappedMcp: report.unmappedMcp,
          missingMcp: report.missingMcp,
          capabilities: report.capabilities.map((c) => ({
            id: c.id,
            cli: c.cli.length,
            mcp: c.mcp.length,
            agentApi: c.agentApi.length,
            sfFin: c.sfFin,
          })),
        },
      };
    },

    async agent(ctx, request) {
      const agentStatus = deps.agentStatusStore ?? createAgentKeyStatusStore();
      const key = await getFinAgentApiKey(ctx);
      if (key.ok === false) {
        return { ok: false, text: key.message, details: { phase: "credential", access: "no_key" } };
      }
      // Separation check before anything is sent: the personal token must
      // never be used on the Agent API path, whatever its source.
      const personal = await getFinCredential(ctx);
      if (personal.ok && sameSecret(key.key, personal.credential.token)) {
        recordAgentStatus(agentStatus, { lastAccess: "same_as_personal_token" });
        return {
          ok: false,
          text: `❌ The Fin Agent API key is the same as the personal API token. Save the separate Fin Agent API key (Fin AI Agent → Deploy → Fin Agent API) with /login sf-fin-agent; nothing was sent.`,
          details: { phase: "credential", access: "same_as_personal_token" },
        };
      }
      const agentDeps = deps.agentDeps ?? {
        fetch: globalThis.fetch.bind(globalThis),
        sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      };
      const client = createAgentApiClient({
        key: key.key,
        region: key.region,
        deps: agentDeps,
        signal: ctx.signal,
      });
      const access = await probeAgentApiAccess(client);
      recordAgentStatus(agentStatus, {
        lastAccess: access.state,
        toolCount: access.state === "granted" ? access.tools.length : undefined,
      });
      if (request.operation === "access" || access.state !== "granted") {
        return {
          ok: access.state === "granted",
          text: accessText(access),
          details: { phase: "access", access: access.state },
        };
      }
      const stamp = Date.now().toString(36);
      const userId = request.userId ?? `sf-pi-test-${stamp}`;
      if (request.operation === "capabilities") {
        try {
          const result = await client.callTool("list_fin_capabilities", { user_id: userId });
          return {
            ok: true,
            text: `Fin capabilities for test user ${userId}:\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}`,
            details: { phase: "capabilities", userId },
          };
        } catch (error) {
          return {
            ok: false,
            text: `❌ list_fin_capabilities failed: ${error instanceof Error ? error.message : String(error)}`,
            details: { phase: "capabilities" },
          };
        }
      }
      if (!request.run.procedureId && !request.run.message?.trim()) {
        return {
          ok: false,
          text: "agent run needs procedure_id (run a procedure) or message (ask Fin).",
          details: { phase: "input" },
        };
      }
      try {
        const result = await runScriptedConversation(client, agentDeps, request.run, {
          conversationId: `sf-pi-${stamp}`,
          userId,
        });
        return {
          ok: result.ok,
          text: result.text,
          details: {
            phase: "run",
            conversationId: result.conversationId,
            status: result.status,
            turns: result.transcript.length,
          },
        };
      } catch (error) {
        return {
          ok: false,
          text: `❌ Fin Agent API run failed: ${error instanceof Error ? error.message : String(error)}`,
          details: { phase: "run" },
        };
      }
    },

    cachedDoctorReport() {
      const snapshot = statusStore.read();
      const checks = buildCachedChecks(snapshot, existsSync(path.join(homedir(), ".intercom")));
      checks.push(
        agentKeyCachedCheck((deps.agentStatusStore ?? createAgentKeyStatusStore()).read()),
      );
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
  | { operation: "simulate"; procedureId?: string; generate?: boolean }
  | { operation: "create_data_connector"; name?: string }
  | {
      operation: "guidance_state";
      guidanceId?: string;
      state?: string;
      execute?: boolean;
    }
  | { operation: "publish"; procedureId?: string; execute?: boolean; note?: string }
  | { operation: "pause"; procedureId?: string; execute?: boolean; note?: string };

export type AgentRequest =
  | { operation: "access" }
  | { operation: "capabilities"; userId?: string }
  | { operation: "run"; userId?: string; run: ScriptedRun };

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
  return [
    buildStatusText(createFinStatusStore().read()),
    ...agentKeyStatusLines(createAgentKeyStatusStore().read()),
  ].join("\n");
}

function recordAgentStatus(
  store: ReturnType<typeof createAgentKeyStatusStore>,
  next: Omit<AgentKeyStatus, "lastCheckedAt">,
): void {
  store.write({ ...next, lastCheckedAt: new Date().toISOString() });
}

export { detectAgentKeySource };
