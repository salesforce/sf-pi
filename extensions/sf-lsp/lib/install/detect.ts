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
import type { LspDoctorStatus, SupportedLanguage } from "../types.ts";

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
  /**
   * Doctor statuses from the full sf-lsp discovery chain (env / .pi /
   * ~/.pi/agent/lsp / VS Code / PATH). If a component is `available`
   * from a source other than our managed `pi-global` directory, we
   * treat it as satisfied — the user already has a working server via
   * VS Code, Homebrew, env override, etc. — and do not offer to install
   * another copy underneath it.
   *
   * Omit to fall back to the legacy behavior of only comparing against
   * the managed install.
   */
  doctor?: LspDoctorStatus[];
}

/**
 * Sources that represent a server we manage under `~/.pi/agent/lsp/`.
 * Anything else (VS Code, PATH, env override, project `.pi/lsp/`) is
 * still a working LSP — we just don't own it and shouldn't try to
 * install another copy.
 */
function isManagedSource(source: string | undefined): boolean {
  return source === "pi-global";
}

function doctorFor(
  doctor: LspDoctorStatus[] | undefined,
  language: SupportedLanguage,
): LspDoctorStatus | undefined {
  return doctor?.find((status) => status.language === language);
}

/**
 * Decide a component's state given upstream version + installed version +
 * the doctor's view of the whole discovery chain.
 *
 * Precedence:
 *   1. Windows → always `manual`.
 *   2. Doctor says `available` from an external source (vscode / path /
 *      env / cache / pi-project) → `current`, external note in detail.
 *   3. Managed install present → compare VERSION vs. upstream.
 *   4. Upstream lookup failed → `unknown`.
 *   5. Otherwise → `missing`.
 */
function classify(
  language: SupportedLanguage,
  doctor: LspDoctorStatus[] | undefined,
  installedVersion: string | undefined,
  latestVersion: string | undefined,
  windowsManual: boolean,
): { state: ComponentState; detail?: string } {
  if (windowsManual) {
    const detail =
      language === "apex"
        ? "Windows: install the Salesforce Apex VS Code extension manually."
        : "Windows: run `npm i -g @salesforce/lwc-language-server` manually.";
    return { state: "manual", detail };
  }

  const status = doctorFor(doctor, language);
  if (status?.available && !isManagedSource(status.source)) {
    const origin =
      status.source === "vscode"
        ? "VS Code extension"
        : status.source === "path"
          ? "PATH"
          : status.source === "env"
            ? "environment override"
            : status.source === "pi-project"
              ? "project .pi/lsp/"
              : status.source === "cache"
                ? "local cache"
                : (status.source ?? "external");
    return {
      state: "current",
      detail: `Provided by ${origin}. Not managed by /sf-lsp install.`,
    };
  }

  return { state: stateFromVersions(installedVersion, latestVersion) };
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

  const apexClassification = classify(
    "apex",
    options.doctor,
    installedApex,
    apexUpstream?.version,
    windowsManual,
  );
  const apexReport: ComponentReport = {
    id: "apex",
    label: "Apex Language Server",
    state: apexClassification.state,
    installedVersion: installedApex,
    latestVersion: apexUpstream?.version,
    detail: apexClassification.detail,
  };

  const lwcClassification = classify(
    "lwc",
    options.doctor,
    installedLwc,
    lwcUpstream?.version,
    windowsManual,
  );
  const lwcReport: ComponentReport = {
    id: "lwc",
    label: "LWC Language Server",
    state: lwcClassification.state,
    installedVersion: installedLwc,
    latestVersion: lwcUpstream?.version,
    detail: lwcClassification.detail,
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
