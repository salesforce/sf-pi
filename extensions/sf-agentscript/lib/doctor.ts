/* SPDX-License-Identifier: Apache-2.0 */
/**
 * `/sf-agentscript` command renderer.
 *
 * Produces the doctor report (SDK package load status, dialect probe) and a
 * usage hint when the user passes an unknown subcommand.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import type { ExtensionDoctorReport } from "../../../lib/common/doctor/registry.ts";
import { AGENTFORCE_SDK_PACKAGE, loadAgentforceSDK } from "./sdk.ts";
import { probeSfapReadiness, type SfapReadinessReport } from "./sfap-readiness.ts";

// -------------------------------------------------------------------------------------------------
// Status shape
// -------------------------------------------------------------------------------------------------

export interface AgentScriptPackageStatus {
  name: string;
  kind: "direct" | "transitive";
  declaredVersion?: string;
  resolvedVersion?: string;
  latestVersion?: string;
  freshness?: "current" | "update_available" | "unknown";
  loaded: boolean;
}

export interface DoctorStatus {
  sdkLoaded: boolean;
  sdkPackage: string;
  sdkPackageVersion?: string;
  agentScriptPackages: AgentScriptPackageStatus[];
  dialectsProbed: string[];
  loadError?: string;
  upstreamNote: string;
  /** P7 additions — health checks beyond "SDK loaded". */
  salesforceCoreResolved: boolean;
  salesforceCoreVersion?: string;
  sfdxAgentsWritable: boolean;
  sfdxAgentsPath: string;
  sfapReadiness?: SfapReadinessReport;
}

// -------------------------------------------------------------------------------------------------
// Probe
// -------------------------------------------------------------------------------------------------

export async function probeDoctor(
  cwd: string,
  targetOrg?: string,
  options: { includeFreshness?: boolean } = {},
): Promise<DoctorStatus> {
  const sdk = await loadAgentforceSDK();

  const dialectsProbed: string[] = [];
  let loadError: string | undefined;
  let sdkLoaded = false;

  if (sdk) {
    sdkLoaded = true;
    try {
      const resolved = sdk.resolveDialect("", { dialects: [sdk.agentforceDialect] });
      dialectsProbed.push(resolved.dialect.name);
    } catch (error) {
      loadError = `Dialect probe threw: ${error instanceof Error ? error.message : String(error)}`;
      sdkLoaded = false;
    }
  } else {
    loadError = `${AGENTFORCE_SDK_PACKAGE} failed to import.`;
  }

  const agentScriptPackages = await readAgentScriptPackageStatuses(options.includeFreshness);
  const sdkPackageVersion = agentScriptPackages.find(
    (pkg) => pkg.name === AGENTFORCE_SDK_PACKAGE,
  )?.declaredVersion;
  const upstreamNote = sdkPackageVersion
    ? `${AGENTFORCE_SDK_PACKAGE}@${sdkPackageVersion}`
    : AGENTFORCE_SDK_PACKAGE;

  // P7: @salesforce/core resolves?
  let salesforceCoreResolved = false;
  let salesforceCoreVersion: string | undefined;
  try {
    // Use a dynamic import so a missing dep doesn't fail the whole probe.
    const core = await import("@salesforce/core");
    salesforceCoreResolved = typeof core.Org?.create === "function";
    try {
      const fs = await import("node:fs/promises");
      const pkgPath = await import.meta.resolve?.("@salesforce/core/package.json");
      if (pkgPath) {
        const url = new URL(pkgPath);
        const raw = await fs.readFile(url.pathname, "utf8");
        const parsed = JSON.parse(raw) as { version?: string };
        salesforceCoreVersion = parsed.version;
      }
    } catch {
      /* version is best-effort */
    }
  } catch {
    /* dep missing */
  }

  // P7: .sfdx/agents/ writable? Create the dir if missing (it's our session
  // store target). sf-guardrail allows it via the carve-out.
  const sfdxAgentsPath = path.join(cwd, ".sfdx", "agents");
  let sfdxAgentsWritable: boolean;
  try {
    const fs = await import("node:fs/promises");
    if (!existsSync(sfdxAgentsPath)) {
      await fs.mkdir(sfdxAgentsPath, { recursive: true });
    }
    await access(sfdxAgentsPath, constants.W_OK);
    sfdxAgentsWritable = true;
  } catch {
    sfdxAgentsWritable = false;
  }

  let sfapReadiness: SfapReadinessReport | undefined;
  if (targetOrg) {
    try {
      sfapReadiness = await probeSfapReadiness(targetOrg);
    } catch {
      // Keep the core doctor useful even when the org readiness probe fails.
    }
  }

  return {
    sdkLoaded,
    sdkPackage: AGENTFORCE_SDK_PACKAGE,
    sdkPackageVersion,
    agentScriptPackages,
    dialectsProbed,
    loadError,
    upstreamNote,
    salesforceCoreResolved,
    salesforceCoreVersion,
    sfdxAgentsWritable,
    sfdxAgentsPath,
    sfapReadiness,
  };
}

async function readAgentScriptPackageStatuses(
  includeFreshness = false,
): Promise<AgentScriptPackageStatus[]> {
  const fs = await import("node:fs/promises");
  let dependencies: Record<string, string> = {};
  try {
    const raw = await fs.readFile(new URL("../../../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { dependencies?: Record<string, string> };
    dependencies = parsed.dependencies ?? {};
  } catch {
    dependencies = {};
  }

  const packages: Array<{ name: string; kind: "direct" | "transitive" }> = [
    { name: AGENTFORCE_SDK_PACKAGE, kind: "direct" },
    { name: "@sf-agentscript/compiler", kind: "transitive" },
    { name: "@sf-agentscript/language", kind: "direct" },
    { name: "@sf-agentscript/lsp", kind: "direct" },
  ];

  return Promise.all(
    packages.map(async (pkg) => {
      const resolvedVersion = await readInstalledPackageVersion(pkg.name);
      const latestVersion = includeFreshness ? await fetchLatestNpmVersion(pkg.name) : undefined;
      return {
        ...pkg,
        declaredVersion: dependencies[pkg.name],
        resolvedVersion,
        latestVersion,
        freshness: latestVersion
          ? resolvedVersion === latestVersion
            ? "current"
            : "update_available"
          : undefined,
        loaded: Boolean(resolvedVersion),
      };
    }),
  );
}

export function npmRegistryPackageUrl(packageName: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(packageName).replaceAll("%40", "@")}`;
}

async function fetchLatestNpmVersion(packageName: string): Promise<string | undefined> {
  try {
    const url = npmRegistryPackageUrl(packageName);
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { "dist-tags"?: { latest?: unknown } };
    const latest = body["dist-tags"]?.latest;
    return typeof latest === "string" ? latest : undefined;
  } catch {
    return undefined;
  }
}

async function readInstalledPackageVersion(packageName: string): Promise<string | undefined> {
  try {
    const resolved = await import.meta.resolve(packageName);
    const start = fileURLToPath(resolved);
    const packageJson = await findNearestPackageJson(path.dirname(start));
    if (!packageJson) return undefined;
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(packageJson, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version;
  } catch {
    return undefined;
  }
}

async function findNearestPackageJson(startDir: string): Promise<string | undefined> {
  const fs = await import("node:fs/promises");
  let current = startDir;
  for (;;) {
    const candidate = path.join(current, "package.json");
    try {
      await fs.access(candidate, constants.R_OK);
      return candidate;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------------------------------

/**
 * Adapter for the shared `/sf-pi doctor` aggregator. Returns the same
 * underlying probe as the standalone `/sf-agentscript doctor` view,
 * shaped into per-check rows so the manager can render them next to other
 * extensions' diagnostics.
 */
export async function runExtensionDoctor(cwd: string): Promise<ExtensionDoctorReport> {
  const status = await probeDoctor(cwd);
  const checks: ExtensionDoctorReport["checks"] = [];

  if (status.sdkLoaded) {
    checks.push({
      id: "agentscript.sdk-loaded",
      severity: "ok",
      title: `Official AgentScript SDK loaded (${status.upstreamNote})`,
      detail: `package: ${status.sdkPackage}`,
    });
    if (status.dialectsProbed.length > 0) {
      checks.push({
        id: "agentscript.dialects-probed",
        severity: "ok",
        title: "Dialect probe succeeded",
        detail: status.dialectsProbed.join(", "),
      });
    }
  } else {
    checks.push({
      id: "agentscript.sdk-load-failed",
      severity: "error",
      title: "Official AgentScript SDK failed to load",
      detail: status.loadError ?? "Unknown SDK load failure",
      fix: "Run `npm install` at the repo root or reinstall sf-pi.",
    });
  }

  const missingPackage = status.agentScriptPackages.find((pkg) => !pkg.loaded);
  if (missingPackage) {
    checks.push({
      id: "agentscript.package-versions",
      severity: "warn",
      title: "Some @sf-agentscript packages are not resolvable",
      detail: status.agentScriptPackages.map(renderPackageStatusCompact).join("; "),
      fix: "Run `npm install` at the repo root.",
    });
  } else if (status.agentScriptPackages.length > 0) {
    checks.push({
      id: "agentscript.package-versions",
      severity: "ok",
      title: "AgentScript package versions resolved",
      detail: status.agentScriptPackages.map(renderPackageStatusCompact).join("; "),
    });
  }

  if (status.salesforceCoreResolved) {
    checks.push({
      id: "agentscript.salesforce-core",
      severity: "ok",
      title: `@salesforce/core resolved${status.salesforceCoreVersion ? ` (v${status.salesforceCoreVersion})` : ""}`,
      detail: "Connection.request transport active.",
    });
  } else {
    checks.push({
      id: "agentscript.salesforce-core",
      severity: "error",
      title: "@salesforce/core not resolvable",
      detail: "Eval, trace, and preview tools require @salesforce/core.",
      fix: "Run `npm install` at the repo root.",
    });
  }

  if (status.sfdxAgentsWritable) {
    checks.push({
      id: "agentscript.sfdx-agents-writable",
      severity: "ok",
      title: ".sfdx/agents/ is writable",
      detail: status.sfdxAgentsPath,
    });
  } else {
    checks.push({
      id: "agentscript.sfdx-agents-writable",
      severity: "warn",
      title: ".sfdx/agents/ is not writable",
      detail: status.sfdxAgentsPath,
      fix: "Confirm sf-guardrail allows .sfdx/agents/** (carve-out) and the directory is not read-only.",
    });
  }

  const errorCount = checks.filter((c) => c.severity === "error").length;
  const summary = errorCount === 0 ? "\u2713 Healthy" : `\u2717 ${errorCount} issue(s)`;

  return { extensionId: "sf-agentscript", title: "SF Agent Script", checks, summary };
}

export function renderDoctorReport(status: DoctorStatus): string {
  const lines = ["SF Agent Script — doctor", ""];

  if (status.sdkLoaded) {
    lines.push(`✅ SDK: loaded (${status.upstreamNote})`);
    lines.push(`   package: ${status.sdkPackage}`);
    if (status.dialectsProbed.length > 0) {
      lines.push(`   dialects: ${status.dialectsProbed.join(", ")}`);
    }
  } else {
    lines.push(`❌ SDK: not loaded`);
    lines.push(`   package: ${status.sdkPackage}`);
    if (status.loadError) lines.push(`   reason: ${status.loadError}`);
    lines.push("   tip: run `npm install` at the repo root or reinstall sf-pi.");
  }

  if (status.agentScriptPackages.length > 0) {
    lines.push("", "AgentScript packages:");
    for (const pkg of status.agentScriptPackages) {
      lines.push(renderPackageStatusLine(pkg));
    }
  }

  if (status.salesforceCoreResolved) {
    lines.push(
      `✅ @salesforce/core: resolved${status.salesforceCoreVersion ? ` (v${status.salesforceCoreVersion})` : ""}`,
    );
  } else {
    lines.push(`❌ @salesforce/core: not resolvable — run \`npm install\``);
  }

  lines.push(
    status.sfdxAgentsWritable
      ? `✅ .sfdx/agents/: writable`
      : `⚠️  .sfdx/agents/: not writable (preview sessions will fail) — ${status.sfdxAgentsPath}`,
  );

  if (status.sfapReadiness) {
    const r = status.sfapReadiness;
    lines.push("", `SFAP readiness (${r.target_org}):`);
    lines.push(renderSfapProbe("Named-user JWT", r.named_user_jwt));
    lines.push(renderSfapProbe("Evaluation API", r.eval_api));
    lines.push(renderSfapProbe("AI Agent authoring", r.authoring_api));
    lines.push(renderSfapProbe("AI Agent preview", r.preview_api));
    lines.push(
      "   note: /einstein/evaluation/* and /einstein/ai-agent/* are separately gated route families.",
    );
  }

  return lines.join("\n");
}

function renderPackageStatusCompact(pkg: AgentScriptPackageStatus): string {
  const declared = pkg.declaredVersion ? ` declared ${pkg.declaredVersion}` : "";
  const resolved = pkg.resolvedVersion ? ` resolved ${pkg.resolvedVersion}` : " unresolved";
  const latest = pkg.latestVersion ? ` latest ${pkg.latestVersion}` : "";
  return `${pkg.name} (${pkg.kind}${declared},${resolved}${latest})`;
}

function renderPackageStatusLine(pkg: AgentScriptPackageStatus): string {
  const icon = pkg.loaded ? (pkg.freshness === "update_available" ? "⚠️" : "✅") : "⚠️";
  const declared = pkg.declaredVersion ? `declared ${pkg.declaredVersion}` : "not declared";
  const resolved = pkg.resolvedVersion ? `resolved ${pkg.resolvedVersion}` : "not resolved";
  const latest = pkg.latestVersion ? `, latest ${pkg.latestVersion}` : "";
  const freshness = pkg.freshness ? `, ${pkg.freshness.replace("_", " ")}` : "";
  return `${icon} ${pkg.name}: ${pkg.kind}, ${declared}, ${resolved}${latest}${freshness}`;
}

function renderSfapProbe(
  label: string,
  probe: { status: string; detail: string; http_status?: number },
): string {
  const icon =
    probe.status === "ok" || probe.status === "reachable"
      ? "✅"
      : probe.status === "skipped"
        ? "⏭️"
        : "⚠️";
  const http = probe.http_status ? ` HTTP ${probe.http_status}` : "";
  return `${icon} ${label}:${http} ${probe.detail}`;
}
