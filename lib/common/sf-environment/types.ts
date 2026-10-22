/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Types for the Salesforce environment detection chain.
 *
 * The detection chain runs in order: CLI → Project → Config → Org.
 * Each layer builds on the previous, so if CLI isn't installed,
 * nothing downstream can work.
 */

// -------------------------------------------------------------------------------------------------
// Detection result
// -------------------------------------------------------------------------------------------------

export type SfEnvironment = {
  /** SF CLI detection. */
  cli: CliInfo;
  /** Salesforce DX project detection. */
  project: ProjectInfo;
  /** Default org configuration. */
  config: ConfigInfo;
  /** Saved org details and optional live verification evidence. */
  org: OrgInfo;
  /** When this environment was last detected. */
  detectedAt: number;
};

// -------------------------------------------------------------------------------------------------
// CLI
// -------------------------------------------------------------------------------------------------

export type CliInfo = {
  installed: boolean;
  version?: string;
};

// -------------------------------------------------------------------------------------------------
// Project
// -------------------------------------------------------------------------------------------------

export type ProjectInfo = {
  detected: boolean;
  /** Absolute path to the sfdx-project.json file. */
  projectPath?: string;
  /** Absolute path to the project root directory. */
  projectRoot?: string;
  /** Project name from sfdx-project.json. */
  name?: string;
  sourceApiVersion?: string;
  namespace?: string;
  packageDirectories?: PackageDirectory[];
};

export type PackageDirectory = {
  path: string;
  default?: boolean;
  package?: string;
  versionName?: string;
  versionNumber?: string;
};

// -------------------------------------------------------------------------------------------------
// Config (@salesforce/core ConfigAggregator)
// -------------------------------------------------------------------------------------------------

export type ConfigInfo = {
  /** Whether a target-org is configured. */
  hasTargetOrg: boolean;
  /** Org alias or username from config. */
  targetOrg?: string;
  /** Source of the effective default, including environment overrides. */
  location?: "Local" | "Global" | "Environment";
  /** Explicit org-api-version override, when configured. */
  apiVersion?: string;
  /** Where the org-api-version override came from. */
  apiVersionLocation?: "Local" | "Global" | "Environment";
};

// -------------------------------------------------------------------------------------------------
// Org (@salesforce/core Org)
// -------------------------------------------------------------------------------------------------

export type OrgType = "sandbox" | "scratch" | "developer" | "production" | "trial" | "unknown";

/** Provenance of the effective API version selected on the SDK Connection. */
export type ConnectionApiVersionSource = "configured" | "resolved" | "sdk-fallback" | "unknown";

export type OrgInfo = {
  /** Whether we successfully retrieved org details. */
  detected: boolean;
  alias?: string;
  username?: string;
  orgId?: string;
  instanceUrl?: string;
  orgType: OrgType;
  connectedStatus?: string;
  /** Live verification is separate from successfully reading a saved login. */
  authenticationStatus?: "saved" | "verified" | "verification-failed";
  /** Timestamp of a successful authenticated identity check, never a cache read. */
  verifiedAt?: number;
  /** Effective API version selected for SDK requests; not the org's release identity. */
  apiVersion?: string;
  /** How the effective Connection API version was selected. */
  apiVersionSource?: ConnectionApiVersionSource;
  /** Cached Organization.NamespacePrefix when @salesforce/core has populated it. */
  namespacePrefix?: string | null;
  /** Cached Organization.OrganizationType / edition when available. */
  orgEdition?: string;
  /** Error message if detection failed. */
  error?: string;
};
