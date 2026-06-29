/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read-only discovery of existing gateway onboarding material.
 *
 * Users often arrive with credentials or corporate CA bundles already wired
 * into adjacent tools. This module centralizes that detection so the doctor,
 * onboard chain, and CA fixer all agree on what was found without performing
 * any writes or broad home-directory scans.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { API_KEY_ENV, BASE_URL_ENV, normalizeBaseUrl } from "./config.ts";
import {
  findClaudeCodeGatewayConfig,
  getClaudeCodeSettingsPath,
  type ClaudeCodeGatewayImportResult,
} from "./claude-code-import.ts";
import {
  buildCandidatePaths,
  defaultLaunchAgentPath,
  validatePemBundle,
} from "./ca-bundle-fixer.ts";

export type OnboardingSourceId =
  "env" | "claude-code" | "devbar" | "aisuite" | "shell" | "launch-agent";

export type Confidence = "high" | "medium" | "low";

export interface CredentialCandidate {
  sourceId: OnboardingSourceId;
  label: string;
  path: string;
  confidence: Confidence;
  baseUrl?: string;
  apiKeyPresent: boolean;
  baseUrlPath?: string;
  apiKeyPath?: string;
  warnings: string[];
}

export interface CaBundleCandidate {
  sourceId: OnboardingSourceId;
  label: string;
  path: string;
  confidence: Confidence;
  exists: boolean;
  validPem: boolean;
  reason?: string;
  referencedBy?: string;
}

export interface NodeExtraCaCertsFinding {
  sourceId: "env" | "shell" | "launch-agent";
  location: string;
  path: string;
  exists: boolean;
  validPem: boolean;
  reason?: string;
}

export interface OnboardingSourceDiscovery {
  credentialCandidates: CredentialCandidate[];
  caBundleCandidates: CaBundleCandidate[];
  nodeExtraCaCertsFindings: NodeExtraCaCertsFinding[];
}

export interface DiscoverOnboardingSourcesOptions {
  cwd?: string;
  home?: string;
  caBundleCandidates?: string[];
}

const DEVBAR_SETTINGS_RELATIVE_PATHS = [
  ".devbar/settings.json",
  ".devbar/config.json",
  ".devbar/gateway.json",
  ".devbar/llm-gateway.json",
] as const;

const SHELL_STARTUP_FILES = [".zshenv", ".zprofile", ".zshrc"] as const;
const PEM_SEARCH_RELATIVE_DIRS = [
  ".claude",
  ".claude/conf",
  ".claude/certs",
  ".devbar",
  ".devbar/conf",
  ".devbar/certs",
  ".aisuite/conf",
] as const;
const NODE_EXTRA_CA_CERTS = "NODE_EXTRA_CA_CERTS";

export function discoverGatewayOnboardingSources(
  options: DiscoverOnboardingSourcesOptions = {},
): OnboardingSourceDiscovery {
  const home = options.home ?? homedir();
  const credentialCandidates: CredentialCandidate[] = [];
  const nodeExtraCaCertsFindings: NodeExtraCaCertsFinding[] = [];

  const envBaseUrl = normalizeBaseUrl(process.env[BASE_URL_ENV]);
  const envApiKey = process.env[API_KEY_ENV]?.trim();
  if (envBaseUrl || envApiKey) {
    credentialCandidates.push({
      sourceId: "env",
      label: "Environment variables",
      path: `${BASE_URL_ENV}/${API_KEY_ENV}`,
      confidence: envBaseUrl && envApiKey ? "high" : "medium",
      baseUrl: envBaseUrl,
      apiKeyPresent: Boolean(envApiKey),
      baseUrlPath: envBaseUrl ? BASE_URL_ENV : undefined,
      apiKeyPath: envApiKey ? API_KEY_ENV : undefined,
      warnings: [],
    });
  }

  const claudeSettingsPath = getClaudeCodeSettingsPath(home);
  const claude = readGatewayJsonCandidate(claudeSettingsPath, "Claude Code");
  if (claude) {
    credentialCandidates.push(
      toCredentialCandidate("claude-code", "Claude Code", claudeSettingsPath, claude),
    );
  }

  for (const relativePath of DEVBAR_SETTINGS_RELATIVE_PATHS) {
    const settingsPath = path.join(home, relativePath);
    const devbar = readGatewayJsonCandidate(settingsPath, "DevBar");
    if (devbar) {
      credentialCandidates.push(toCredentialCandidate("devbar", "DevBar", settingsPath, devbar));
    }
  }

  const shellFindings = readShellNodeExtraCaCerts(home);
  nodeExtraCaCertsFindings.push(...shellFindings);

  const launchAgentFinding = readLaunchAgentNodeExtraCaCerts(home);
  if (launchAgentFinding) nodeExtraCaCertsFindings.push(launchAgentFinding);

  const envCaBundle = process.env[NODE_EXTRA_CA_CERTS]?.trim();
  if (envCaBundle) {
    nodeExtraCaCertsFindings.unshift(
      buildNodeExtraCaCertsFinding("env", "process.env", resolveUserPath(envCaBundle, home)),
    );
  }

  const caBundleCandidates = buildCaBundleCandidates({
    home,
    configuredCandidates: options.caBundleCandidates ?? [],
    nodeFindings: nodeExtraCaCertsFindings,
  });

  return {
    credentialCandidates,
    caBundleCandidates,
    nodeExtraCaCertsFindings,
  };
}

function readGatewayJsonCandidate(
  settingsPath: string,
  sourceLabel: string,
): ClaudeCodeGatewayImportResult | undefined {
  if (!existsSync(settingsPath)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(settingsPath, "utf8"));
    const result = findClaudeCodeGatewayConfig(raw);
    return result.ok ? result : undefined;
  } catch (error) {
    return {
      ok: false,
      reason: `Could not read ${sourceLabel} settings: ${
        error instanceof Error ? error.message : String(error)
      }`,
      warnings: [],
    };
  }
}

function toCredentialCandidate(
  sourceId: OnboardingSourceId,
  label: string,
  settingsPath: string,
  result: ClaudeCodeGatewayImportResult,
): CredentialCandidate {
  if (!result.ok) {
    return {
      sourceId,
      label,
      path: settingsPath,
      confidence: "low",
      apiKeyPresent: false,
      warnings: [result.reason, ...result.warnings],
    };
  }
  return {
    sourceId,
    label,
    path: settingsPath,
    confidence: result.baseUrl && result.apiKey ? "high" : "medium",
    baseUrl: result.baseUrl,
    apiKeyPresent: Boolean(result.apiKey),
    baseUrlPath: result.baseUrlPath,
    apiKeyPath: result.apiKeyPath,
    warnings: result.warnings,
  };
}

function buildCaBundleCandidates(options: {
  home: string;
  configuredCandidates: string[];
  nodeFindings: NodeExtraCaCertsFinding[];
}): CaBundleCandidate[] {
  const candidates: CaBundleCandidate[] = [];
  const add = (candidate: CaBundleCandidate) => {
    if (candidates.some((existing) => existing.path === candidate.path)) return;
    candidates.push(candidate);
  };

  for (const finding of options.nodeFindings) {
    add({
      sourceId: finding.sourceId === "env" ? "env" : finding.sourceId,
      label: finding.location,
      path: finding.path,
      confidence: finding.validPem ? "high" : "medium",
      exists: finding.exists,
      validPem: finding.validPem,
      reason: finding.reason,
      referencedBy: finding.location,
    });
  }

  for (const candidatePath of buildCandidatePaths(options.configuredCandidates, options.home)) {
    const sourceId = sourceIdForPath(candidatePath);
    add(buildCaBundleCandidate(candidatePath, sourceId));
  }

  for (const relativeDir of PEM_SEARCH_RELATIVE_DIRS) {
    for (const candidatePath of listOneLevelPemFiles(path.join(options.home, relativeDir))) {
      add(buildCaBundleCandidate(candidatePath, sourceIdForPath(candidatePath)));
    }
  }

  return candidates;
}

function buildCaBundleCandidate(
  pathValue: string,
  sourceId: OnboardingSourceId,
): CaBundleCandidate {
  const exists = existsSync(pathValue);
  if (!exists) {
    return {
      sourceId,
      label: labelForSource(sourceId),
      path: pathValue,
      confidence: sourceId === "aisuite" ? "high" : "medium",
      exists: false,
      validPem: false,
      reason: "not present",
    };
  }
  const validation = validatePemBundle(pathValue);
  return {
    sourceId,
    label: labelForSource(sourceId),
    path: pathValue,
    confidence: validation.ok ? "high" : "medium",
    exists: true,
    validPem: validation.ok,
    reason: validation.reason,
  };
}

function readShellNodeExtraCaCerts(home: string): NodeExtraCaCertsFinding[] {
  const findings: NodeExtraCaCertsFinding[] = [];
  for (const filename of SHELL_STARTUP_FILES) {
    const filePath = path.join(home, filename);
    if (!existsSync(filePath)) continue;
    let contents: string;
    try {
      contents = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const values = extractNodeExtraCaCertsValues(contents);
    for (const value of values) {
      findings.push(
        buildNodeExtraCaCertsFinding("shell", `~/${filename}`, resolveUserPath(value, home)),
      );
    }
  }
  return findings;
}

function readLaunchAgentNodeExtraCaCerts(home: string): NodeExtraCaCertsFinding | undefined {
  const plistPath = defaultLaunchAgentPath(home);
  if (!existsSync(plistPath)) return undefined;
  let contents: string;
  try {
    contents = readFileSync(plistPath, "utf8");
  } catch {
    return undefined;
  }
  const match = contents.match(/<string>NODE_EXTRA_CA_CERTS<\/string>\s*<string>([^<]+)<\/string>/);
  if (!match?.[1]) return undefined;
  return buildNodeExtraCaCertsFinding("launch-agent", "LaunchAgent", unescapeXml(match[1].trim()));
}

function buildNodeExtraCaCertsFinding(
  sourceId: "env" | "shell" | "launch-agent",
  location: string,
  pathValue: string,
): NodeExtraCaCertsFinding {
  const exists = existsSync(pathValue);
  if (!exists) {
    return {
      sourceId,
      location,
      path: pathValue,
      exists: false,
      validPem: false,
      reason: "not present",
    };
  }
  let isFile: boolean;
  try {
    isFile = statSync(pathValue).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    return {
      sourceId,
      location,
      path: pathValue,
      exists: true,
      validPem: false,
      reason: "not a regular file",
    };
  }
  const validation = validatePemBundle(pathValue);
  return {
    sourceId,
    location,
    path: pathValue,
    exists: true,
    validPem: validation.ok,
    reason: validation.reason,
  };
}

export function extractNodeExtraCaCertsValues(contents: string): string[] {
  const values: string[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const quoted = line.match(/^\s*(?:export\s+)?NODE_EXTRA_CA_CERTS=(['"])(.*?)\1/);
    if (quoted?.[2]) {
      values.push(quoted[2]);
      continue;
    }
    const unquoted = line.match(/^\s*(?:export\s+)?NODE_EXTRA_CA_CERTS=([^\s#;]+)/);
    if (unquoted?.[1]) values.push(unquoted[1]);
  }
  return values;
}

export function collectUsableCaBundlePaths(discovery: OnboardingSourceDiscovery): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const candidate of discovery.caBundleCandidates) {
    if (!candidate.validPem) continue;
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    paths.push(candidate.path);
  }
  return paths;
}

export function findShellOnlyNodeExtraCaCerts(
  discovery: OnboardingSourceDiscovery,
): NodeExtraCaCertsFinding[] {
  const hasZshenv = discovery.nodeExtraCaCertsFindings.some(
    (finding) => finding.location === "~/.zshenv" && finding.validPem,
  );
  if (hasZshenv) return [];
  return discovery.nodeExtraCaCertsFindings.filter(
    (finding) =>
      finding.sourceId === "shell" &&
      (finding.location === "~/.zshrc" || finding.location === "~/.zprofile") &&
      finding.validPem,
  );
}

export function formatDiscoveredCaBundleSummary(discovery: OnboardingSourceDiscovery): string[] {
  const valid = discovery.caBundleCandidates.filter((candidate) => candidate.validPem);
  if (valid.length === 0) return [];
  return valid.slice(0, 3).map((candidate) => {
    const source = candidate.referencedBy ?? candidate.label;
    return `CA bundle candidate: ${candidate.path} (${source}).`;
  });
}

function sourceIdForPath(pathValue: string): OnboardingSourceId {
  const normalized = pathValue.split(path.sep).join("/");
  if (normalized.includes("/.claude/")) return "claude-code";
  if (normalized.includes("/.devbar/")) return "devbar";
  if (normalized.includes("/.aisuite/")) return "aisuite";
  return "shell";
}

function labelForSource(sourceId: OnboardingSourceId): string {
  switch (sourceId) {
    case "claude-code":
      return "Claude Code";
    case "devbar":
      return "DevBar";
    case "aisuite":
      return "AI Suite";
    case "env":
      return "Environment";
    case "launch-agent":
      return "LaunchAgent";
    case "shell":
      return "Shell";
  }
}

function resolveUserPath(raw: string, home: string): string {
  let value = raw.trim();
  if (!value) return value;
  value = value.replace(/^\$HOME(?=\/|$)/, home);
  value = value.replace(/^~(?=\/|$)/, home);
  return path.isAbsolute(value) ? value : path.join(home, value);
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Exported for tests and bounded future source adapters.
export function listExistingJsonFiles(paths: readonly string[]): string[] {
  return paths.filter((candidate) => {
    try {
      return existsSync(candidate) && statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

// Exported for tests: recursively lists only one bounded directory level for
// known tool config folders. This is intentionally not used for broad home scans.
export function listOneLevelPemFiles(dirPath: string): string[] {
  try {
    return readdirSync(dirPath)
      .filter((entry) => entry.toLowerCase().endsWith(".pem"))
      .map((entry) => path.join(dirPath, entry));
  } catch {
    return [];
  }
}
