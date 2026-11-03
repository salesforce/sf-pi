/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read-only connection check.
 *
 * Runs only `intercom --version` and `intercom me --json`. Both are read-only;
 * `me` does not touch the Fin SDK endpoints, so it never triggers the CLI's
 * automatic `POST /fin-sdk/enable` side effect.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getFinCredential, normalizeRegion, type FinCredentialResult } from "./auth.ts";
import {
  classifyCliResult,
  isCliVersionSupported,
  parseCliVersion,
  readCliErrorMessage,
  runFinCli,
  type CliRunOptions,
  type CliRunResult,
} from "./cli-runner.ts";
import {
  CLI_PACKAGE,
  MIN_CLI_VERSION,
  PROVIDER_NAME,
  type FinOutcomeKind,
  type FinStatusSnapshot,
  type FinVerifiedIdentity,
} from "./types.ts";

export interface DoctorDeps {
  resolveCredential(ctx: ExtensionContext): Promise<FinCredentialResult>;
  run(args: string[], options: CliRunOptions): Promise<CliRunResult>;
  now(): Date;
}

const defaultDeps: DoctorDeps = {
  resolveCredential: getFinCredential,
  run: runFinCli,
  now: () => new Date(),
};

export interface DoctorReport {
  outcome: FinOutcomeKind;
  message: string;
  snapshot: FinStatusSnapshot;
}

export async function runDoctor(
  ctx: ExtensionContext,
  deps: DoctorDeps = defaultDeps,
): Promise<DoctorReport> {
  const checkedAt = deps.now().toISOString();
  const report = (
    outcome: FinOutcomeKind,
    message: string,
    extra: Partial<FinStatusSnapshot> = {},
  ): DoctorReport => ({
    outcome,
    message,
    snapshot: { lastCheckedAt: checkedAt, lastOutcome: outcome, lastMessage: message, ...extra },
  });

  const versionResult = await deps.run(["--version"], { signal: ctx.signal, timeoutMs: 15_000 });
  if (classifyCliResult(versionResult) === "cli_missing") {
    return report(
      "cli_missing",
      `The Fin CLI was not found on PATH. Install it with \`npm install -g ${CLI_PACKAGE}\`, then rerun /sf-fin doctor.`,
    );
  }
  const cliVersion = parseCliVersion(versionResult.stdout);
  if (!cliVersion) {
    return report(
      "cli_error",
      readCliErrorMessage(versionResult) ?? "Could not read the Fin CLI version.",
    );
  }
  if (!isCliVersionSupported(cliVersion)) {
    return report(
      "cli_outdated",
      `Fin CLI ${cliVersion} is older than the supported minimum ${MIN_CLI_VERSION}. Run \`npm install -g ${CLI_PACKAGE}@latest\`.`,
      { cliVersion },
    );
  }

  const credential = await deps.resolveCredential(ctx);
  if (credential.ok === false) {
    return report("not_connected", credential.message, { cliVersion });
  }

  const meResult = await deps.run(["me", "--json"], {
    credential: credential.credential,
    signal: ctx.signal,
  });
  const outcome = classifyCliResult(meResult);
  if (outcome !== "ok") {
    return report(outcome, describeFailure(outcome, readCliErrorMessage(meResult)), { cliVersion });
  }

  const identity = parseIdentity(meResult.stdout);
  if (!identity) {
    return report("cli_error", "The Fin CLI returned an unexpected `me` response.", { cliVersion });
  }
  identity.region ??= credential.credential.region;
  const who = [identity.workspaceName, identity.appId ? `app id ${identity.appId}` : undefined]
    .filter(Boolean)
    .join(" · ");
  return report(
    "ok",
    `Connected to ${who || "the Fin workspace"} (${identity.region.toUpperCase()}).`,
    {
      cliVersion,
      identity,
    },
  );
}

function describeFailure(outcome: FinOutcomeKind, cliMessage: string | undefined): string {
  switch (outcome) {
    case "auth_expired":
      return `The saved token was rejected (expired, revoked, or for another region). Create a new personal API token and run /login ${PROVIDER_NAME} again.`;
    case "permission_denied":
      return `The token is valid but lacks permission for this request.${cliMessage ? ` ${cliMessage}` : ""}`;
    case "rate_limited":
      return "Fin rate-limited the request. Wait a moment and rerun /sf-fin doctor.";
    case "timeout":
      return "The Fin CLI timed out. Check network access and any workspace IP allowlist.";
    default:
      return cliMessage ?? "The Fin CLI failed without an error message.";
  }
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
