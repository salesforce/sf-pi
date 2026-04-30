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
  /** Live org details (requires authenticated org). */
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
// Config (sf config list)
// -------------------------------------------------------------------------------------------------

export type ConfigInfo = {
  /** Whether a target-org is configured. */
  hasTargetOrg: boolean;
  /** Org alias or username from config. */
  targetOrg?: string;
  /** Where the config is set: Local (project) or Global. */
  location?: "Local" | "Global";
};

// -------------------------------------------------------------------------------------------------
// Org (sf org display)
// -------------------------------------------------------------------------------------------------

export type OrgType = "sandbox" | "scratch" | "developer" | "production" | "trial" | "unknown";

export type OrgInfo = {
  /** Whether we successfully retrieved org details. */
  detected: boolean;
  alias?: string;
  username?: string;
  orgId?: string;
  instanceUrl?: string;
  orgType: OrgType;
  connectedStatus?: string;
  apiVersion?: string;
  /** Error message if detection failed. */
  error?: string;
};
