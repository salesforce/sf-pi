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
 * Optional hints from the system prompt options so the agent context
 * can adapt to what tools/skills are actually active.
 */
export type AgentContextOptions = {
  /** Tool names currently selected in the system prompt. */
  activeTools?: string[];
  /** Skill names currently loaded. */
  activeSkills?: string[];
};

/**
 * Build the context string injected into the system prompt so the agent
 * knows about the Salesforce environment.
 *
 * When activeTools/activeSkills are provided (from systemPromptOptions),
 * the context includes a hint about which Salesforce-specific tools and
 * skills are available, helping the agent choose the right approach.
 *
 * Returns undefined if there's nothing useful to inject (no CLI, no project, no org).
 */
export function formatAgentContext(
  env: SfEnvironment,
  options?: AgentContextOptions,
): string | undefined {
  if (!env.cli.installed) {
    return undefined;
  }

  // If neither project nor org is detected, nothing useful to say
  if (!env.project.detected && !env.config.hasTargetOrg) {
    return undefined;
  }

  const lines: string[] = ["[Salesforce Environment]"];

  // CLI
  if (env.cli.version) {
    lines.push(`SF CLI: v${env.cli.version}`);
  }

  // Project
  if (env.project.detected) {
    const name = env.project.name ?? "unknown";
    const api = env.project.sourceApiVersion ? ` (API ${env.project.sourceApiVersion})` : "";
    lines.push(`Project: ${name}${api}`);

    if (env.project.namespace) {
      lines.push(`Namespace: ${env.project.namespace}`);
    }

    if (env.project.packageDirectories?.length) {
      const dirs = env.project.packageDirectories
        .map(
          (d) => `${d.path}${d.default ? " (default)" : ""}${d.package ? ` [${d.package}]` : ""}`,
        )
        .join(", ");
      lines.push(`Package directories: ${dirs}`);
    }

    if (env.project.projectRoot) {
      lines.push(`Project root: ${env.project.projectRoot}`);
    }
  }

  // Org
  if (env.org.detected) {
    const orgLabel = env.org.alias ?? env.org.username ?? "unknown";
    const orgType = env.org.orgType !== "unknown" ? ` (${env.org.orgType})` : "";
    const status = env.org.connectedStatus ?? "unknown";
    lines.push(`Default org: ${orgLabel}${orgType} — ${status}`);

    if (env.org.instanceUrl) {
      lines.push(`Instance: ${env.org.instanceUrl}`);
    }

    if (env.org.apiVersion) {
      lines.push(`Org API version: ${env.org.apiVersion}`);
    }

    if (env.config.location) {
      lines.push(`Config scope: ${env.config.location}`);
    }
  } else if (env.config.hasTargetOrg) {
    lines.push(`Default org: ${env.config.targetOrg} (⚠ unable to connect)`);
    if (env.org.error) {
      lines.push(`Error: ${env.org.error}`);
    }
  } else {
    lines.push("Default org: not configured");
    lines.push("Run: sf org login web --set-default --alias MyOrg");
  }

  // Append active SF-related tools/skills when known, so the agent can
  // tailor its approach to the tools actually available in this session.
  if (options?.activeTools?.length) {
    const sfTools = options.activeTools.filter(
      (t) => t.startsWith("sf") || t === "bash" || t === "read" || t === "edit" || t === "write",
    );
    if (sfTools.length > 0) {
      lines.push(`Active tools: ${sfTools.join(", ")}`);
    }
  }
  if (options?.activeSkills?.length) {
    const sfSkills = options.activeSkills.filter((s) => s.startsWith("sf-"));
    if (sfSkills.length > 0) {
      lines.push(`Active SF skills: ${sfSkills.join(", ")}`);
    }
  }

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
      lines.push(`   Source API: ${env.project.sourceApiVersion}`);
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
    lines.push(
      `✅ Target org: ${env.config.targetOrg} (${env.config.location ?? "unknown"} config)`,
    );
  } else {
    lines.push("⚠ Target org: not configured");
    lines.push("   Run: sf config set target-org=<alias>");
  }

  lines.push("");

  // Org
  if (env.org.detected) {
    const orgType = env.org.orgType !== "unknown" ? ` (${env.org.orgType})` : "";
    lines.push(`✅ Org: ${env.org.alias ?? env.org.username ?? "connected"}${orgType}`);
    lines.push(`   Status: ${env.org.connectedStatus ?? "unknown"}`);
    if (env.org.instanceUrl) lines.push(`   Instance: ${env.org.instanceUrl}`);
    if (env.org.apiVersion) lines.push(`   API version: ${env.org.apiVersion}`);
    if (env.org.orgId) lines.push(`   Org ID: ${env.org.orgId}`);
    if (env.org.username) lines.push(`   Username: ${env.org.username}`);

    if (env.org.orgType === "production") {
      lines.push("");
      lines.push("   ⚠ WARNING: This is a PRODUCTION org. Deploy with caution.");
    }
  } else if (env.config.hasTargetOrg) {
    lines.push(`❌ Org: unable to connect to ${env.config.targetOrg}`);
    if (env.org.error) {
      lines.push(`   Error: ${env.org.error}`);
    }
    lines.push(
      "   Try: sf org login web --set-default --alias " + (env.config.targetOrg ?? "MyOrg"),
    );
  } else {
    lines.push("⚠ Org: no default org configured");
  }

  // Detection timestamp
  lines.push("");
  const ago = Math.round((Date.now() - env.detectedAt) / 1000);
  lines.push(`Detected ${ago}s ago. Run /sf-org refresh to re-detect.`);

  return lines.join("\n");
}
