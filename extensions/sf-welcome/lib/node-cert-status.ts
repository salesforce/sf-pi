/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Cache-first Node CA certificate status for the welcome splash.
 *
 * This answers a narrow startup-safe question: is Node currently wired to a
 * custom CA bundle via NODE_EXTRA_CA_CERTS, or is there a valid bundle/fix the
 * user can adopt?  The splash reads the cached result on first paint and this
 * module refreshes in the background.  Detection is intentionally bounded:
 * no subprocesses, no network calls, no recursive filesystem scans.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { createStateStore } from "../../../lib/common/state-store.ts";
import {
  hasCaBundleFixApplied,
  readCaBundleFixerState,
} from "../../sf-llm-gateway-internal/lib/ca-bundle-fixer-state.ts";
import { buildCandidatePaths } from "../../sf-llm-gateway-internal/lib/ca-bundle-fixer.ts";
import { getGatewayConfig } from "../../sf-llm-gateway-internal/lib/config.ts";
import { readCaProbeState } from "../../sf-llm-gateway-internal/lib/ca-probe-state.ts";
import type { NodeCertStatusInfo, NodeCertStatusSource } from "./types.ts";

const NODE_EXTRA_CA_CERTS = "NODE_EXTRA_CA_CERTS";
const PEM_HEADER = "-----BEGIN CERTIFICATE-----";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SHELL_STARTUP_FILES = [".zshenv", ".zprofile", ".zshrc"] as const;
const LAUNCH_AGENT_PLIST = "Library/LaunchAgents/com.salesforce.sf-pi.node-extra-ca-certs.plist";

interface NodeCertStatusCacheFile {
  status?: NodeCertStatusInfo;
  savedAt?: number;
}

export interface DetectNodeCertStatusOptions {
  cwd?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  candidatePaths?: string[];
  probeStatePathOverride?: string;
  fixerStatePathOverride?: string;
}

interface PemProbe {
  ok: boolean;
  reason?: string;
}

function getCacheStore() {
  return createStateStore<NodeCertStatusCacheFile>({
    namespace: "sf-welcome",
    filename: "node-cert-status.json",
    schemaVersion: 1,
    defaults: {},
    mode: 0o600,
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as NodeCertStatusCacheFile)
        : null;
    },
  });
}

function parseCachedStatus(value: unknown): NodeCertStatusInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<NodeCertStatusInfo>;
  if (
    record.kind !== "checking" &&
    record.kind !== "verified" &&
    record.kind !== "installed" &&
    record.kind !== "found" &&
    record.kind !== "not-configured" &&
    record.kind !== "invalid" &&
    record.kind !== "unknown"
  ) {
    return null;
  }
  return {
    kind: record.kind,
    source: parseSource(record.source),
    path: typeof record.path === "string" ? record.path : undefined,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    loading: false,
  };
}

function parseSource(value: unknown): NodeCertStatusSource | undefined {
  if (
    value === "env" ||
    value === "launch-agent" ||
    value === "shell" ||
    value === "fixer" ||
    value === "candidate" ||
    value === "probe"
  ) {
    return value;
  }
  return undefined;
}

export function readCachedNodeCertStatus(
  maxAgeMs: number = CACHE_MAX_AGE_MS,
): NodeCertStatusInfo | null {
  try {
    const cache = getCacheStore().read();
    if (typeof cache.savedAt !== "number") return null;
    if (Date.now() - cache.savedAt > maxAgeMs) return null;
    return parseCachedStatus(cache.status);
  } catch {
    return null;
  }
}

export function writeCachedNodeCertStatus(status: NodeCertStatusInfo): void {
  try {
    getCacheStore().write({ status: { ...status, loading: false }, savedAt: Date.now() });
  } catch {
    // Cache is best-effort. The splash falls back to "Checking" / "Unknown".
  }
}

export function detectNodeCertStatus(
  cwd: string,
  options: DetectNodeCertStatusOptions = {},
): NodeCertStatusInfo {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const effectiveCwd = options.cwd ?? cwd;

  const probeState = readCaProbeState(options.probeStatePathOverride);
  const envPath = env[NODE_EXTRA_CA_CERTS]?.trim();
  if (envPath) {
    const envStatus = statusForConfiguredPath(resolveUserPath(envPath, home, effectiveCwd), "env");
    if (
      envStatus.kind === "installed" &&
      probeState.at &&
      probeState.lastFailureClass === null &&
      probeState.hasNodeExtraCaCerts
    ) {
      return { ...envStatus, kind: "verified", source: "probe" };
    }
    return envStatus;
  }

  const fixerState = readCaBundleFixerState(options.fixerStatePathOverride);
  if (hasCaBundleFixApplied(fixerState) && fixerState.bundlePath) {
    const status = statusForConfiguredPath(fixerState.bundlePath, "fixer");
    if (status.kind === "installed") return status;
    return { ...status, source: "fixer" };
  }

  const launchAgentPath = readLaunchAgentNodeExtraCaCerts(home);
  if (launchAgentPath) {
    return statusForConfiguredPath(
      resolveUserPath(launchAgentPath, home, effectiveCwd),
      "launch-agent",
    );
  }

  const shellPath = readShellNodeExtraCaCerts(home);
  if (shellPath) {
    return statusForConfiguredPath(resolveUserPath(shellPath, home, effectiveCwd), "shell");
  }

  const validCandidate = findValidCandidate(effectiveCwd, home, options.candidatePaths);
  if (validCandidate) {
    return { kind: "found", source: "candidate", path: validCandidate, loading: false };
  }

  return { kind: "not-configured", loading: false };
}

function statusForConfiguredPath(
  filePath: string,
  source: NodeCertStatusSource,
): NodeCertStatusInfo {
  const probe = cheapPemProbe(filePath);
  if (probe.ok) {
    return { kind: "installed", source, path: filePath, loading: false };
  }
  return {
    kind: "invalid",
    source,
    path: filePath,
    reason: probe.reason,
    loading: false,
  };
}

function findValidCandidate(
  cwd: string,
  home: string,
  explicitCandidates?: string[],
): string | undefined {
  const candidates = explicitCandidates ?? buildCandidateList(cwd, home);
  for (const candidate of candidates) {
    const resolved = resolveUserPath(candidate, home, cwd);
    if (cheapPemProbe(resolved).ok) return resolved;
  }
  return undefined;
}

function buildCandidateList(cwd: string, home: string): string[] {
  try {
    return buildCandidatePaths(getGatewayConfig(cwd).caBundleCandidates, home);
  } catch {
    return buildCandidatePaths([], home);
  }
}

function cheapPemProbe(filePath: string): PemProbe {
  try {
    if (!existsSync(filePath)) return { ok: false, reason: "not found" };
    const stats = statSync(filePath);
    if (!stats.isFile()) return { ok: false, reason: "not a file" };
    if (stats.size === 0) return { ok: false, reason: "empty file" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(4096);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead).toString("utf8");
    if (!head.includes(PEM_HEADER)) {
      return { ok: false, reason: `missing ${PEM_HEADER} header` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore close failures for a read-only status check
      }
    }
  }
}

function readLaunchAgentNodeExtraCaCerts(home: string): string | undefined {
  const plistPath = path.join(home, LAUNCH_AGENT_PLIST);
  if (!existsSync(plistPath)) return undefined;
  try {
    const contents = readFileSync(plistPath, "utf8");
    const match = contents.match(
      /<string>NODE_EXTRA_CA_CERTS<\/string>\s*<string>([^<]+)<\/string>/,
    );
    return match ? unescapeXml(match[1].trim()) : undefined;
  } catch {
    return undefined;
  }
}

function readShellNodeExtraCaCerts(home: string): string | undefined {
  for (const filename of SHELL_STARTUP_FILES) {
    const filePath = path.join(home, filename);
    if (!existsSync(filePath)) continue;
    try {
      const values = extractNodeExtraCaCertsValues(readFileSync(filePath, "utf8"));
      if (values.length > 0) return values[0];
    } catch {
      // Skip unreadable shell files.
    }
  }
  return undefined;
}

export function extractNodeExtraCaCertsValues(contents: string): string[] {
  const values: string[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const quoted = line.match(/^\s*(?:export\s+)?NODE_EXTRA_CA_CERTS=(['"])(.*?)\1/);
    if (quoted) {
      values.push(quoted[2].trim());
      continue;
    }
    const unquoted = line.match(/^\s*(?:export\s+)?NODE_EXTRA_CA_CERTS=([^\s#;]+)/);
    if (unquoted) values.push(unquoted[1].trim());
  }
  return values.filter(Boolean);
}

function resolveUserPath(value: string, home: string, cwd: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("~/")) return path.join(home, trimmed.slice(2));
  if (trimmed === "~") return home;
  if (path.isAbsolute(trimmed)) return trimmed;
  return path.resolve(cwd, trimmed);
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
