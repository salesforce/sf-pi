/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Plan and run a global npm install of the Fin CLI.
 *
 * Planning is pure and read-only. Execution runs exactly
 * `npm install -g @intercom/cli@<exact version> --no-audit --no-fund
 * --loglevel=error`: no shell, no sudo, and no retry with elevation. SF
 * Guardrail mediates the agent-facing `sf_fin install` call before
 * execution; the human command path confirms in the TUI.
 */
import {
  pickPolicyVisibleVersion,
  resolveNpmReleaseAgePolicy,
} from "../../../../lib/common/npm-release-age-policy.ts";
import type { ExecFn } from "../../../../lib/common/sf-environment/detect.ts";
import { isCliVersionSupported } from "../cli-runner.ts";
import { CLI_PACKAGE, MIN_CLI_VERSION } from "../types.ts";
import type { CliDetection, NpmPolicyConfig, NpmRegistryMetadata } from "./detect.ts";
import { defaultShimContext, npmCommand, type ShimContext } from "../npm-shim.ts";

const INSTALL_TIMEOUT_MS = 180_000;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export type InstallPlan =
  | { kind: "install" | "update"; version: string; args: string[]; command: string; reason: string }
  | { kind: "noop"; version?: string; reason: string }
  | { kind: "refused"; reason: string; manual?: string };

export interface PlanInput {
  detection: CliDetection;
  registry?: NpmRegistryMetadata;
  npmPolicy?: NpmPolicyConfig;
  /** Explicit version requested by the user or agent. Must be exact semver. */
  requestedVersion?: string;
  now?: Date;
}

export function planCliInstall(input: PlanInput): InstallPlan {
  const { detection } = input;

  if (detection.installSource === "other") {
    return {
      kind: "refused",
      reason: `The Fin CLI at ${detection.binaryPath ?? "an unmanaged location"} was not installed with global npm, so SF Fin will not modify it.`,
      manual: `Update it with the tool that installed it, or remove it and run /sf-fin install to use global npm.`,
    };
  }

  const resolved = resolveTargetVersion(input);
  if (resolved.ok === false) return { kind: "refused", reason: resolved.reason };
  const version = resolved.version;

  if (!isCliVersionSupported(version, MIN_CLI_VERSION)) {
    return {
      kind: "refused",
      reason: `Version ${version} is below SF Fin's supported minimum ${MIN_CLI_VERSION}.`,
    };
  }
  if (detection.installedVersion === version) {
    return { kind: "noop", version, reason: `Fin CLI ${version} is already installed.` };
  }

  const args = buildInstallArgs(version);
  return {
    kind: detection.installed ? "update" : "install",
    version,
    args,
    command: `npm ${args.join(" ")}`,
    reason: detection.installed
      ? `Update Fin CLI ${detection.installedVersion ?? "(unknown)"} → ${version}.`
      : `Install Fin CLI ${version}.`,
  };
}

function resolveTargetVersion(
  input: PlanInput,
): { ok: true; version: string } | { ok: false; reason: string } {
  const requested = input.requestedVersion?.trim();
  if (requested) {
    if (!EXACT_VERSION.test(requested)) {
      return {
        ok: false,
        reason: `Version must be an exact semver such as 0.14.1, not "${requested}".`,
      };
    }
    return { ok: true, version: requested };
  }

  const latest = input.registry?.latest;
  if (!latest || !EXACT_VERSION.test(latest)) {
    return {
      ok: false,
      reason:
        "Could not resolve the latest Fin CLI version from the npm registry. Pass an exact version or retry when the registry is reachable.",
    };
  }

  // Honor npm's own before / min-release-age policy so SF Fin never installs
  // a version the user's npm configuration would hide.
  const policy = input.npmPolicy
    ? resolveNpmReleaseAgePolicy({ ...input.npmPolicy, now: input.now })
    : undefined;
  if (policy?.cutoff && input.registry?.time) {
    const visible = pickPolicyVisibleVersion(input.registry.time, policy.cutoff, latest);
    if (!visible) {
      return {
        ok: false,
        reason: `npm ${policy.source}=${policy.rawValue} hides every published Fin CLI version.`,
      };
    }
    return { ok: true, version: visible };
  }
  return { ok: true, version: latest };
}

export function buildInstallArgs(version: string): string[] {
  return [
    "install",
    "-g",
    `${CLI_PACKAGE}@${version}`,
    "--no-audit",
    "--no-fund",
    "--loglevel=error",
  ];
}

export interface InstallRunResult {
  ok: boolean;
  exitCode: number | null;
  message: string;
  stderr?: string;
}

export async function runCliInstall(
  exec: ExecFn,
  plan: Extract<InstallPlan, { kind: "install" | "update" }>,
  shim: ShimContext = defaultShimContext(),
): Promise<InstallRunResult> {
  // Windows: npm is a .cmd shim; run its npm-cli.js with node instead.
  const [command, args] = npmCommand("npm", plan.args, shim);
  const result = await exec(command, args, { timeout: INSTALL_TIMEOUT_MS }).catch(
    (error: unknown) => ({
      code: null,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    }),
  );
  if (result.code === 0) {
    return { ok: true, exitCode: 0, message: `Installed ${CLI_PACKAGE}@${plan.version}.` };
  }
  const stderr = result.stderr?.trim();
  return {
    ok: false,
    exitCode: result.code,
    message: describeInstallFailure(stderr ?? ""),
    stderr: stderr ? stderr.slice(0, 4_000) : undefined,
  };
}

export function describeInstallFailure(stderr: string): string {
  if (/\bEACCES\b|permission denied/i.test(stderr)) {
    return [
      "npm could not write to its global directory (EACCES).",
      "SF Fin does not retry with sudo. Point npm at a user-owned prefix, for example:",
      "  npm config set prefix ~/.npm-global",
      "  export PATH=~/.npm-global/bin:$PATH",
      "then run /sf-fin install again. A Node version manager (nvm, mise, fnm) also avoids this.",
    ].join("\n");
  }
  if (/\bE404\b|404 Not Found/i.test(stderr)) {
    return "npm could not find that Fin CLI version. Check the version number.";
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(stderr)) {
    return "npm could not reach the registry. Check network, proxy (HTTPS_PROXY), and registry settings.";
  }
  if (/UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_/i.test(stderr)) {
    return "npm hit a TLS certificate error. Set NODE_EXTRA_CA_CERTS or npm's cafile for your network.";
  }
  return "npm install failed. See stderr for details.";
}
