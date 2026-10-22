/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Agent context formatter for the Salesforce environment.
 *
 * Builds the context string injected into the system prompt so the agent
 * knows about the connected Salesforce org, project, and CLI version.
 *
 * Pure function: SfEnvironment in, string out.
 */

import type { SfEnvironment } from "./types.ts";

/**
 * Build the context string injected into the system prompt so the agent
 * knows about the Salesforce environment.
 *
 * Returns undefined if there's nothing useful to inject (no CLI, no project, no org).
 */
export function formatAgentContext(env: SfEnvironment): string | undefined {
  if (!env.cli.installed) {
    return undefined;
  }

  // If neither project nor org is detected, nothing useful to say
  if (!env.project.detected && !env.config.hasTargetOrg) {
    return undefined;
  }

  // Boundary convention: lowercase snake_case XML tags, matching pi 0.75's
  // own context boundaries (`<conversation>`, `<project_context>`,
  // `<project_instructions>`). See ADR 0008 for the rationale.
  const lines: string[] = ["<sf_environment>"];

  // CLI
  if (env.cli.version) {
    lines.push(`SF CLI: v${env.cli.version}`);
  }

  // Project
  if (env.project.detected) {
    const name = env.project.name ?? "unknown";
    const api = env.project.sourceApiVersion ? ` (Source API ${env.project.sourceApiVersion})` : "";
    lines.push(`Project: ${name}${api}`);

    if (env.project.namespace) {
      lines.push(`Namespace: ${env.project.namespace}`);
    }

    const defaultPackage = env.project.packageDirectories?.find((directory) => directory.default);
    if (defaultPackage) lines.push(`Default package: ${defaultPackage.path}`);
  }

  // Org
  if (env.org.detected) {
    const orgLabel = env.config.targetOrg ?? env.org.alias ?? env.org.username ?? "unknown";
    const orgType = env.org.orgType !== "unknown" ? ` (${env.org.orgType})` : "";
    lines.push(`Default org: ${orgLabel}${orgType}`);

    if (env.org.apiVersion) {
      lines.push(
        `Connection API version: ${formatConnectionApiVersion(env.org.apiVersion, env.org.apiVersionSource)}`,
      );
    }
  } else if (env.config.hasTargetOrg) {
    lines.push(`Default org: ${env.config.targetOrg} (⚠ unable to connect)`);
  } else {
    lines.push("Default org: not configured");
  }

  if (env.config.hasTargetOrg) {
    lines.push(`Default source: ${formatDefaultSource(env.config.location)}`);
    lines.push(`Authentication: ${formatAuthenticationStatus(env)}`);
  }
  lines.push("Operations with an explicit target use that target instead of this default.");
  lines.push("</sf_environment>");

  return lines.join("\n");
}

/**
 * Build a detailed multi-line status string for the /sf-org command.
 */
export function formatDetailedStatus(env: SfEnvironment): string {
  const lines: string[] = [];

  // Header
  lines.push("Salesforce Environment Status");
  lines.push("─".repeat(40));

  // CLI
  if (env.cli.installed) {
    lines.push(`✅ SF CLI: v${env.cli.version ?? "unknown"}`);
  } else {
    lines.push("❌ SF CLI: not found");
    lines.push("   Install: https://developer.salesforce.com/tools/sfdxcli");
    return lines.join("\n");
  }

  lines.push("");

  // Project
  if (env.project.detected) {
    lines.push(`✅ Project: ${env.project.name ?? "detected"}`);
    if (env.project.sourceApiVersion) {
      lines.push(`   Project Source API: ${env.project.sourceApiVersion}`);
    }
    if (env.project.namespace) {
      lines.push(`   Namespace: ${env.project.namespace}`);
    }
    if (env.project.packageDirectories?.length) {
      for (const dir of env.project.packageDirectories) {
        const badges: string[] = [];
        if (dir.default) badges.push("default");
        if (dir.package) badges.push(dir.package);
        const suffix = badges.length ? ` (${badges.join(", ")})` : "";
        lines.push(`   📁 ${dir.path}${suffix}`);
      }
    }
    if (env.project.projectRoot) {
      lines.push(`   Root: ${env.project.projectRoot}`);
    }
  } else {
    lines.push("⚠ Project: no sfdx-project.json found");
    lines.push("   This directory is not a Salesforce DX project.");
  }

  lines.push("");

  // Config
  if (env.config.hasTargetOrg) {
    lines.push(`✅ Effective default: ${env.config.targetOrg}`);
    lines.push(`   Source: ${formatDefaultSource(env.config.location)}`);
  } else {
    lines.push("⚠ Effective default: not configured");
    lines.push("   Run: sf config set target-org=<alias>");
  }

  lines.push("");

  // Org
  if (env.org.detected) {
    const orgType = env.org.orgType !== "unknown" ? ` (${env.org.orgType})` : "";
    lines.push(`✅ Org: ${env.org.alias ?? env.org.username ?? "connected"}${orgType}`);
    lines.push(`   Authentication: ${formatAuthenticationStatus(env)}`);
    if (env.org.instanceUrl) lines.push(`   Instance: ${env.org.instanceUrl}`);
    if (env.org.apiVersion) {
      lines.push(
        `   Connection API: ${formatConnectionApiVersion(env.org.apiVersion, env.org.apiVersionSource)}`,
      );
      if (env.org.apiVersionSource === "sdk-fallback") {
        lines.push("   Maximum org API: not verified");
      }
    }
    if (env.org.orgId) lines.push(`   Org ID: ${env.org.orgId}`);
    if (env.org.username) lines.push(`   Username: ${env.org.username}`);

    if (env.org.orgType === "production") {
      lines.push("");
      lines.push("   ⚠ WARNING: This is a PRODUCTION org. Deploy with caution.");
    }
  } else if (env.config.hasTargetOrg) {
    lines.push(`❌ Org: unable to connect to ${env.config.targetOrg}`);
    lines.push(`   Authentication: ${formatAuthenticationStatus(env)}`);
    if (env.org.error) {
      lines.push(`   Error: ${env.org.error}`);
    }
    lines.push(
      "   Run /sf-org refresh to retry verification; a failed check does not prove the login is invalid.",
    );
  } else {
    lines.push("⚠ Org: no default org configured");
  }

  lines.push("");
  lines.push("Operations with an explicit target use that target instead of this default.");

  // Detection timestamp
  lines.push("");
  const ago = Math.round((Date.now() - env.detectedAt) / 1000);
  lines.push(`Detected ${ago}s ago. Run /sf-org refresh to re-detect.`);

  return lines.join("\n");
}

function formatConnectionApiVersion(
  version: string,
  source: SfEnvironment["org"]["apiVersionSource"],
): string {
  switch (source) {
    case "configured":
      return `${version} (configured)`;
    case "resolved":
      return `${version} (auto-resolved)`;
    case "sdk-fallback":
      return `${version} (unverified SDK fallback)`;
    case "unknown":
      return `${version} (source unknown)`;
    default:
      // Persisted snapshots created before provenance was added remain readable.
      return version;
  }
}

/** Human and agent surfaces share the same default provenance labels. */
export function formatDefaultSource(location: SfEnvironment["config"]["location"]): string {
  switch (location) {
    case "Local":
      return "Local project configuration";
    case "Global":
      return "Global CLI configuration";
    case "Environment":
      return "Environment override";
    default:
      return "Unknown (refresh to resolve)";
  }
}

function formatAuthenticationStatus(env: SfEnvironment): string {
  if (env.org.authenticationStatus === "verification-failed") return "Verification failed";
  const verifiedAt = env.org.verifiedAt;
  if (
    env.org.authenticationStatus === "verified" &&
    verifiedAt !== undefined &&
    Number.isFinite(verifiedAt)
  ) {
    return `Verified at ${new Date(verifiedAt).toISOString()}`;
  }
  // Legacy Connected snapshots did not prove a live authenticated request.
  return env.org.detected ? "Saved login; not checked live" : "Unable to resolve saved login";
}
