/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Compare local installs against upstream latest to produce per-component
 * state used by the first-boot orchestrator.
 *
 * Pure reads + network calls. No disk mutation. Never throws.
 *
 *   Apex → existsSync(apex-jorje-lsp.jar) && VERSION stamp vs. marketplace
 *   LWC  → package.json.version under the local npm prefix vs. npm registry
 *   Java → best-effort `java -version` parse. Detect only; flagged "manual"
 *          because we cannot auto-install a JDK.
 */
import { existsSync, readFileSync } from "node:fs";
import type { ExecFn } from "../../../../lib/common/sf-environment/detect.ts";
import { compareSemver, fetchLatestApex, fetchLatestLwc } from "./versioning.ts";
import { apexJarPath, apexVersionPath, lwcPackageJsonPath } from "./paths.ts";
import type { ComponentReport, ComponentState, InstallReport } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Apex
// -------------------------------------------------------------------------------------------------

export function readInstalledApexVersion(): string | undefined {
  if (!existsSync(apexJarPath())) return undefined;
  const versionFile = apexVersionPath();
  if (!existsSync(versionFile)) {
    // Jar is present but we never recorded a version (e.g. user dropped
    // it in manually). Report as installed with an unknown version so the
    // orchestrator can still surface "outdated?" on next run.
    return "0.0.0";
  }
  try {
    const raw = readFileSync(versionFile, "utf-8").trim();
    return raw || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// -------------------------------------------------------------------------------------------------
// LWC
// -------------------------------------------------------------------------------------------------

export function readInstalledLwcVersion(): string | undefined {
  const pkgPath = lwcPackageJsonPath();
  if (!existsSync(pkgPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version.trim();
    }
    return "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// -------------------------------------------------------------------------------------------------
// Java — detect only
// -------------------------------------------------------------------------------------------------

export async function detectJavaVersion(exec: ExecFn): Promise<string | undefined> {
  try {
    // `java -version` writes to stderr by convention.
    const result = await exec("java", ["-version"], { timeout: 5_000 });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const match = output.match(/version "?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return undefined;
    const major = match[1];
    const minor = match[2] ?? "0";
    const patch = match[3] ?? "0";
    return `${major}.${minor}.${patch}`;
  } catch {
    return undefined;
  }
}

function isJavaAcceptable(version: string): boolean {
  // Apex jorje needs 11+. Major alone is enough.
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  return Number.isFinite(major) && major >= 11;
}

// -------------------------------------------------------------------------------------------------
// Component state derivation
// -------------------------------------------------------------------------------------------------

function stateFromVersions(
  installed: string | undefined,
  latest: string | undefined,
): ComponentState {
  if (!latest) return installed ? "unknown" : "unknown";
  if (!installed) return "missing";
  return compareSemver(installed, latest) < 0 ? "outdated" : "current";
}

// -------------------------------------------------------------------------------------------------
// Top-level detection
// -------------------------------------------------------------------------------------------------

export interface DetectOptions {
  /** When true, skip network lookups (used by `/sf-lsp install status` in offline mode). */
  skipRemote?: boolean;
  /** Override the current platform (tests). */
  platform?: NodeJS.Platform;
  /** Override the local-install readers (tests). */
  readers?: {
    readInstalledApexVersion?: () => string | undefined;
    readInstalledLwcVersion?: () => string | undefined;
  };
}

export async function detectInstallReport(
  exec: ExecFn,
  options: DetectOptions = {},
): Promise<InstallReport> {
  const platform = options.platform ?? process.platform;
  const windowsManual = platform === "win32";

  const [apexUpstream, lwcUpstream, javaVersion] = await Promise.all([
    options.skipRemote ? Promise.resolve(undefined) : fetchLatestApex(),
    options.skipRemote ? Promise.resolve(undefined) : fetchLatestLwc(),
    detectJavaVersion(exec),
  ]);

  const installedApex = (options.readers?.readInstalledApexVersion ?? readInstalledApexVersion)();
  const installedLwc = (options.readers?.readInstalledLwcVersion ?? readInstalledLwcVersion)();

  const apexReport: ComponentReport = {
    id: "apex",
    label: "Apex Language Server",
    state: windowsManual ? "manual" : stateFromVersions(installedApex, apexUpstream?.version),
    installedVersion: installedApex,
    latestVersion: apexUpstream?.version,
    detail: windowsManual
      ? "Windows: install the Salesforce Apex VS Code extension manually."
      : undefined,
  };

  const lwcReport: ComponentReport = {
    id: "lwc",
    label: "LWC Language Server",
    state: windowsManual ? "manual" : stateFromVersions(installedLwc, lwcUpstream?.version),
    installedVersion: installedLwc,
    latestVersion: lwcUpstream?.version,
    detail: windowsManual
      ? "Windows: run `npm i -g @salesforce/lwc-language-server` manually."
      : undefined,
  };

  const javaReport: ComponentReport = {
    id: "java",
    label: "Java 11+",
    // Java is always "manual" — we never auto-install. We expose it in
    // the report so the summary can say "Apex needs Java 11+, not found".
    state: !javaVersion ? "missing" : isJavaAcceptable(javaVersion) ? "current" : "outdated",
    installedVersion: javaVersion,
    detail: javaVersion
      ? isJavaAcceptable(javaVersion)
        ? undefined
        : "Apex LSP needs Java 11 or newer."
      : "Not found on PATH / JAVA_HOME. Install OpenJDK 11+ to enable Apex diagnostics.",
  };

  // Java is detect-only — never blocks "actionable" because we can't
  // install it. We do surface it in the summary so the user knows why
  // Apex diagnostics might still fail after install.
  javaReport.state = javaReport.state === "current" ? "current" : "manual";

  const components = [apexReport, lwcReport, javaReport];
  const hasActionable = components.some(
    (c) => c.id !== "java" && (c.state === "missing" || c.state === "outdated"),
  );

  return {
    components,
    hasActionable,
    platformManual: windowsManual,
  };
}
