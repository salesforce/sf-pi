/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SF Fin doctor.
 *
 * Live mode (`/sf-fin doctor`, `sf_fin doctor`) runs six checks: Node, CLI
 * presence, CLI version (with npm registry freshness), credential, workspace
 * (`intercom me`), and the user's own CLI config. `me` does not touch Fin SDK
 * endpoints, so it never triggers the CLI's automatic `POST /fin-sdk/enable`.
 *
 * Cached mode (`/sf-pi doctor` aggregate) makes no network or credentialed
 * call; it reports local facts plus the last live result.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionDoctorCheck } from "../../../lib/common/doctor/registry.ts";
import type { ExecFn } from "../../../lib/common/sf-environment/detect.ts";
import {
  detectRegion,
  detectTokenSource,
  getFinCredential,
  normalizeRegion,
  type FinCredentialResult,
} from "./auth.ts";
import {
  classifyCliResult,
  isCliVersionSupported,
  readCliErrorMessage,
  readCliErrorCode,
  runFinCli,
  type CliRunOptions,
  type CliRunResult,
} from "./cli-runner.ts";
import { diagnoseFailure } from "./failure-diagnostics.ts";
import {
  detectCli,
  fetchCliRegistryMetadata,
  type CliDetection,
  type FetchRegistryFn,
} from "./install/detect.ts";
import {
  COMMAND_NAME,
  ENV_TOKEN,
  MIN_CLI_VERSION,
  PROVIDER_NAME,
  type FinOutcomeKind,
  type FinStatusSnapshot,
  type FinVerifiedIdentity,
} from "./types.ts";

/** Fallback when the registry does not publish `engines.node`; matches @intercom/cli 0.14.x. */
const DEFAULT_NODE_ENGINE = ">=20.6.0";

export interface DoctorDeps {
  resolveCredential(ctx: ExtensionContext): Promise<FinCredentialResult>;
  run(args: string[], options: CliRunOptions): Promise<CliRunResult>;
  exec: ExecFn;
  fetchRegistry: FetchRegistryFn;
  now(): Date;
  nodeVersion: string;
  userCliConfigExists(): boolean;
}

export function createDoctorDeps(exec: ExecFn): DoctorDeps {
  return {
    resolveCredential: getFinCredential,
    run: runFinCli,
    exec,
    fetchRegistry: fetchCliRegistryMetadata,
    now: () => new Date(),
    nodeVersion: process.versions.node,
    userCliConfigExists: () => existsSync(path.join(homedir(), ".intercom")),
  };
}

export interface DoctorReport {
  outcome: FinOutcomeKind;
  message: string;
  checks: ExtensionDoctorCheck[];
  snapshot: FinStatusSnapshot;
}

export interface DoctorRunOptions {
  /** Add the Fin CLI's own `--verbose` flag to `me` (debug trace). */
  verbose?: boolean;
}

export async function runDoctor(
  ctx: ExtensionContext,
  deps: DoctorDeps,
  options: DoctorRunOptions = {},
): Promise<DoctorReport & { meResult?: CliRunResult }> {
  const checkedAt = deps.now().toISOString();
  const registry = await deps.fetchRegistry(ctx.signal);
  const detection = await detectCli(deps.exec, { latestVersion: registry?.latest });
  const checks: ExtensionDoctorCheck[] = [
    nodeCheck(deps.nodeVersion, registry?.latestNodeEngine),
    cliCheck(detection),
    versionCheck(detection),
  ];
  const base: Partial<FinStatusSnapshot> = {
    cliVersion: detection.installedVersion,
    cliPath: detection.binaryPath,
    installSource: detection.installSource,
    latestVersion: detection.latestVersion,
  };
  const finish = (
    outcome: FinOutcomeKind,
    message: string,
    extra: Partial<FinStatusSnapshot> = {},
    meResult?: CliRunResult,
  ) => {
    checks.push(userConfigCheck(deps.userCliConfigExists()));
    return {
      outcome,
      message,
      checks,
      meResult,
      snapshot: {
        lastCheckedAt: checkedAt,
        lastOutcome: outcome,
        lastMessage: message,
        ...base,
        ...extra,
      },
    };
  };

  if (detection.state === "missing") {
    checks.push(credentialCheck(), skippedWorkspaceCheck("The Fin CLI is not installed."));
    return finish(
      "cli_missing",
      `The Fin CLI is not installed. Run /${COMMAND_NAME} install (or sf_fin action='install').`,
    );
  }
  if (detection.state === "below-minimum") {
    checks.push(
      credentialCheck(),
      skippedWorkspaceCheck("The Fin CLI is below the supported minimum."),
    );
    return finish(
      "cli_outdated",
      `Fin CLI ${detection.installedVersion} is below the supported minimum ${MIN_CLI_VERSION}. Run /${COMMAND_NAME} install.`,
    );
  }

  const credential = await deps.resolveCredential(ctx);
  checks.push(credentialCheck());
  if (credential.ok === false) {
    checks.push(skippedWorkspaceCheck("No credential is configured."));
    return finish("not_connected", credential.message);
  }

  const meArgs = options.verbose ? ["me", "--json", "--verbose"] : ["me", "--json"];
  const meResult = await deps.run(meArgs, {
    credential: credential.credential,
    signal: ctx.signal,
  });
  const outcome = classifyCliResult(meResult);
  if (outcome !== "ok") {
    const cliMessage = readCliErrorMessage(meResult);
    const diagnosis = diagnoseFailure(`${meResult.stderr}\n${meResult.stdout}`);
    const message = describeFailure(outcome, cliMessage, diagnosis?.advice);
    checks.push({
      id: "fin.workspace",
      severity: "error",
      title: `Workspace check failed: ${outcome}`,
      detail: message,
      fix: outcome === "auth_expired" ? `/login ${PROVIDER_NAME}` : `/${COMMAND_NAME} debug`,
    });
    return finish(
      outcome,
      message,
      {
        lastCliError: { code: readCliErrorCode(meResult), message: cliMessage },
        ...(diagnosis ? { lastDiagnosis: diagnosis.id } : {}),
      },
      meResult,
    );
  }

  const identity = parseIdentity(meResult.stdout);
  if (!identity) {
    checks.push({
      id: "fin.workspace",
      severity: "error",
      title: "Unexpected `me` response",
      detail: "The Fin CLI returned output SF Fin could not parse.",
      fix: `/${COMMAND_NAME} debug`,
    });
    return finish("cli_error", "The Fin CLI returned an unexpected `me` response.", {}, meResult);
  }
  identity.region ??= credential.credential.region;
  const who = [identity.workspaceName, identity.appId ? `app id ${identity.appId}` : undefined]
    .filter(Boolean)
    .join(" · ");
  const message = `Connected to ${who || "the Fin workspace"} (${identity.region.toUpperCase()}).`;
  checks.push({
    id: "fin.workspace",
    severity: "ok",
    title: "Workspace reachable",
    detail: message,
  });
  return finish("ok", message, { identity }, meResult);
}

/** `/sf-pi doctor` aggregate: local facts and cached results only. No network, no credential. */
export function buildCachedChecks(
  snapshot: FinStatusSnapshot,
  userCliConfigExists: boolean,
): ExtensionDoctorCheck[] {
  const source = detectTokenSource();
  const region = detectRegion();
  const checks: ExtensionDoctorCheck[] = [];
  checks.push(
    snapshot.cliVersion
      ? {
          id: "fin.cli",
          severity: snapshot.installSource === "other" ? "info" : "ok",
          title: `Fin CLI ${snapshot.cliVersion}`,
          detail: `${snapshot.cliPath ?? "path unknown"} · ${snapshot.installSource ?? "source unknown"}${
            snapshot.latestVersion && snapshot.latestVersion !== snapshot.cliVersion
              ? ` · latest ${snapshot.latestVersion}`
              : ""
          }`,
          ...(snapshot.latestVersion &&
          !isCliVersionSupported(snapshot.cliVersion, snapshot.latestVersion)
            ? { fix: `/${COMMAND_NAME} install` }
            : {}),
        }
      : {
          id: "fin.cli",
          severity: snapshot.lastOutcome === "cli_missing" ? "warn" : "info",
          title:
            snapshot.lastOutcome === "cli_missing"
              ? "Fin CLI not installed"
              : "Fin CLI not checked yet",
          detail: `Run /${COMMAND_NAME} doctor for a live check.`,
          fix: snapshot.lastOutcome === "cli_missing" ? `/${COMMAND_NAME} install` : undefined,
        },
  );
  checks.push({
    id: "fin.credential",
    severity: source === "none" ? "warn" : "ok",
    title: source === "none" ? "Not connected" : `Credential: ${sourceLabel(source)}`,
    detail: `Region ${region.region.toUpperCase()} (${region.source}).`,
    fix: source === "none" ? `/login ${PROVIDER_NAME}` : undefined,
  });
  checks.push(
    snapshot.lastCheckedAt
      ? {
          id: "fin.workspace",
          severity: snapshot.lastOutcome === "ok" ? "ok" : "warn",
          title: `Last live check: ${snapshot.lastOutcome ?? "unknown"}`,
          detail: `${snapshot.lastMessage ?? ""} (at ${snapshot.lastCheckedAt})`.trim(),
          fix: snapshot.lastOutcome === "ok" ? undefined : `/${COMMAND_NAME} doctor`,
        }
      : {
          id: "fin.workspace",
          severity: "info",
          title: "Workspace not verified yet",
          detail: "No live doctor run has been recorded.",
          fix: `/${COMMAND_NAME} doctor`,
        },
  );
  checks.push(userConfigCheck(userCliConfigExists));
  return checks;
}

function nodeCheck(nodeVersion: string, engine: string | undefined): ExtensionDoctorCheck {
  const required = engine ?? DEFAULT_NODE_ENGINE;
  const minimum = required.match(/>=\s*(\d+\.\d+\.\d+)/)?.[1];
  const ok = !minimum || isCliVersionSupported(nodeVersion, minimum);
  return {
    id: "fin.node",
    severity: ok ? "ok" : "error",
    title: `Node ${nodeVersion}`,
    detail: `Fin CLI requires Node ${required}.`,
    fix: ok ? undefined : `Upgrade Node to satisfy ${required}.`,
  };
}

function cliCheck(detection: CliDetection): ExtensionDoctorCheck {
  if (!detection.installed) {
    return {
      id: "fin.cli",
      severity: "error",
      title: "Fin CLI not installed",
      detail: "`intercom` was not found on PATH.",
      fix: `/${COMMAND_NAME} install`,
    };
  }
  return {
    id: "fin.cli",
    severity: detection.installSource === "other" ? "info" : "ok",
    title: `Fin CLI found (${detection.installSource})`,
    detail: detection.binaryPath ?? "path unknown",
    ...(detection.installSource === "other"
      ? { fix: "Not managed by global npm; SF Fin will not update it." }
      : {}),
  };
}

function versionCheck(detection: CliDetection): ExtensionDoctorCheck {
  const installed = detection.installedVersion ?? "unknown";
  const latest = detection.latestVersion;
  switch (detection.state) {
    case "missing":
      return {
        id: "fin.cli-version",
        severity: "info",
        title: "Fin CLI version: not installed",
        detail: latest
          ? `Latest published: ${latest}.`
          : "Latest version unknown (registry unreachable).",
      };
    case "below-minimum":
      return {
        id: "fin.cli-version",
        severity: "error",
        title: `Fin CLI ${installed} below minimum ${MIN_CLI_VERSION}`,
        detail: latest ? `Latest published: ${latest}.` : "",
        fix: `/${COMMAND_NAME} install`,
      };
    case "outdated":
      return {
        id: "fin.cli-version",
        severity: "warn",
        title: `Fin CLI ${installed} → ${latest} available`,
        detail: "An update is available.",
        fix: `/${COMMAND_NAME} install`,
      };
    case "unknown":
      return {
        id: "fin.cli-version",
        severity: "warn",
        title: "Fin CLI version unreadable",
        detail: "`intercom --version` did not return a version.",
        fix: `/${COMMAND_NAME} debug`,
      };
    case "current":
      return {
        id: "fin.cli-version",
        severity: "ok",
        title: `Fin CLI ${installed}`,
        detail: latest
          ? `Latest published: ${latest}.`
          : "Latest version unknown (registry unreachable).",
      };
  }
}

function credentialCheck(): ExtensionDoctorCheck {
  const source = detectTokenSource();
  const region = detectRegion();
  return {
    id: "fin.credential",
    severity: source === "none" ? "warn" : "ok",
    title: source === "none" ? "Not connected" : `Credential: ${sourceLabel(source)}`,
    detail: `Region ${region.region.toUpperCase()} (${region.source}).`,
    fix: source === "none" ? `/login ${PROVIDER_NAME}` : undefined,
  };
}

function skippedWorkspaceCheck(reason: string): ExtensionDoctorCheck {
  return {
    id: "fin.workspace",
    severity: "info",
    title: "Workspace check skipped",
    detail: reason,
  };
}

function userConfigCheck(exists: boolean): ExtensionDoctorCheck {
  return {
    id: "fin.user-cli-config",
    severity: "info",
    title: exists ? "Separate personal CLI login found" : "No personal CLI login",
    detail: exists
      ? "`~/.intercom` exists. SF Fin ignores it and always uses its private CLI config plus the /login sf-fin credential."
      : "SF Fin uses its private CLI config plus the /login sf-fin credential.",
  };
}

function sourceLabel(source: ReturnType<typeof detectTokenSource>): string {
  return source === "pi-auth"
    ? `saved by /login ${PROVIDER_NAME}`
    : `${ENV_TOKEN} environment variable`;
}

function describeFailure(
  outcome: FinOutcomeKind,
  cliMessage: string | undefined,
  advice: string | undefined,
): string {
  const base = (() => {
    switch (outcome) {
      case "auth_expired":
        return `The saved token was rejected (expired, revoked, or for another region). Create a new personal API token and run /login ${PROVIDER_NAME} again.`;
      case "permission_denied":
        return `The token is valid but lacks permission for this request.${cliMessage ? ` ${cliMessage}` : ""}`;
      case "rate_limited":
        return `Fin rate-limited the request. Wait a moment and rerun /${COMMAND_NAME} doctor.`;
      case "timeout":
        return "The Fin CLI timed out. Check network access and any workspace IP allowlist.";
      default:
        return cliMessage ?? "The Fin CLI failed without an error message.";
    }
  })();
  return advice && !base.includes(advice) ? `${base}\n${advice}` : base;
}

/** Keep only non-secret identity fields from the `/me` response. */
export function parseIdentity(stdout: string): FinVerifiedIdentity | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const me = parsed as Record<string, unknown>;
  const app = (me.app && typeof me.app === "object" ? me.app : {}) as Record<string, unknown>;
  const str = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  const identity: FinVerifiedIdentity = {
    appId: str(app.id_code) ?? str(me.app_id),
    workspaceName: str(app.name),
    adminName: str(me.name),
    adminEmail: str(me.email),
    region: normalizeRegion(str(app.region) ?? str(me.region)),
  };
  return identity.appId || identity.adminEmail || identity.workspaceName ? identity : undefined;
}

/** Plain-text rendering of doctor checks for commands and tool output. */
export function renderChecks(checks: ExtensionDoctorCheck[]): string {
  const icon = { ok: "✅", info: "ℹ️", warn: "⚠️", error: "❌" } as const;
  return checks
    .map((check) =>
      [
        `${icon[check.severity]} ${check.title}`,
        check.detail ? `   ${check.detail}` : undefined,
        check.fix ? `   → ${check.fix}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
}
