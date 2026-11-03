/* SPDX-License-Identifier: Apache-2.0 */
/** Shared constants and types for SF Fin. */

export const PROVIDER_NAME = "sf-fin";
export const COMMAND_NAME = "sf-fin";
export const TOOL_NAME = "sf_fin";

/** Automation fallback names. These match the Fin CLI's own environment contract. */
export const ENV_TOKEN = "INTERCOM_TOKEN";
export const ENV_REGION = "INTERCOM_REGION";
export const ENV_APP_ID = "INTERCOM_APP_ID";

/** CLI binary and the oldest version whose flags and output shapes SF Fin relies on. */
export const CLI_BINARY = "intercom";
export const CLI_PACKAGE = "@intercom/cli";
export const MIN_CLI_VERSION = "0.14.0";

export const FIN_REGIONS = ["us", "eu", "au"] as const;
export type FinRegion = (typeof FIN_REGIONS)[number];
export const DEFAULT_REGION: FinRegion = "us";

export type FinTokenSource = "pi-auth" | "env" | "none";

/** Stable classification of a CLI or API outcome. Never carries secret material. */
export type FinOutcomeKind =
  | "ok"
  | "not_connected"
  | "auth_expired"
  | "permission_denied"
  | "rate_limited"
  | "not_found"
  | "timeout"
  | "cli_missing"
  | "cli_outdated"
  | "cli_error";

/** Non-secret workspace identity confirmed by the last successful doctor run. */
export interface FinVerifiedIdentity {
  appId?: string;
  workspaceName?: string;
  adminName?: string;
  adminEmail?: string;
  region?: FinRegion;
}

export interface FinStatusSnapshot {
  lastCheckedAt?: string;
  lastOutcome?: FinOutcomeKind;
  lastMessage?: string;
  cliVersion?: string;
  identity?: FinVerifiedIdentity;
}
