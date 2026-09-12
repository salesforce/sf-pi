/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only compatibility diagnostics for the recommended pi-web-access package. */
import { lookup as dnsLookup } from "node:dns/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import net from "node:net";
import path from "node:path";
import type {
  ExtensionDoctorCheck,
  ExtensionDoctorReport,
} from "../../../lib/common/doctor/registry.ts";
import { collectSettingsPackageSources } from "../../../lib/common/herdr-package-sources.ts";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";

const TARGET_HOSTNAME = "github.com";
const DEFAULT_LOOKUP_TIMEOUT_MS = 2_000;

interface LookupAddress {
  address: string;
  family: number;
}

type Lookup = (hostname: string) => Promise<readonly LookupAddress[]>;

export interface PiWebAccessDoctorOptions {
  cwd: string;
  packageSources?: readonly string[];
  configPath?: string;
  lookup?: Lookup;
  timeoutMs?: number;
}

interface ConfigInspection {
  allowRanges: string[];
  error?: string;
}

interface Ipv4Cidr {
  address: number;
  prefix: number;
}

export async function runPiWebAccessDoctor(
  options: PiWebAccessDoctorOptions,
): Promise<ExtensionDoctorReport | null> {
  const packageSources = options.packageSources ?? collectSettingsPackageSources(options.cwd);
  if (!packageSources.some(isPiWebAccessSource)) return null;

  const startedAt = Date.now();
  const configPath = options.configPath ?? resolvePiWebAccessConfigPath();
  const config = inspectConfig(configPath);
  const checks: ExtensionDoctorCheck[] = [];

  if (config.error) {
    checks.push({
      id: "pi-web-access.config",
      severity: "warn",
      title: "pi-web-access configuration could not be inspected",
      detail: config.error,
      fix: `Correct the JSON and ssrf.allowRanges value in ${configPath}; SF Pi will not rewrite third-party configuration.`,
    });
  }

  const lookup = options.lookup ?? defaultLookup;
  let addresses: readonly LookupAddress[];
  try {
    addresses = await withTimeout(
      lookup(TARGET_HOSTNAME),
      options.timeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS,
    );
  } catch (error) {
    checks.push({
      id: "pi-web-access.synthetic-dns",
      severity: "info",
      title: "Synthetic DNS compatibility was not evaluated",
      detail: `Could not resolve ${TARGET_HOSTNAME} during the bounded doctor check: ${errorMessage(error)}`,
    });
    return buildReport(checks, startedAt);
  }

  const syntheticAddresses = addresses.flatMap(({ address }) => {
    const range = syntheticRange(address);
    return range ? [{ address, range }] : [];
  });
  const uncoveredAddresses = syntheticAddresses.filter(
    ({ address }) => !config.allowRanges.some((range) => ipv4CidrContains(range, address)),
  );
  const firstUncovered = uncoveredAddresses[0];

  if (firstUncovered) {
    const { address, range: blockedRange } = firstUncovered;
    const suggestedRange = narrowIpv4Range(address);
    checks.push({
      id: "pi-web-access.synthetic-dns",
      severity: "warn",
      title: "pi-web-access may reject public fetches behind synthetic DNS",
      detail: `${TARGET_HOSTNAME} resolved to ${address} in ${blockedRange}. A VPN or TUN synthetic-DNS mapping may be active, while pi-web-access correctly blocks reserved addresses by default.`,
      fix: `If your VPN or TUN owns this mapping, add ${JSON.stringify(suggestedRange)} to ssrf.allowRanges in ${configPath}. Verify the narrow range first. Do not allow ${blockedRange} wholesale.`,
    });
  } else if (syntheticAddresses.length > 0) {
    checks.push({
      id: "pi-web-access.synthetic-dns",
      severity: "ok",
      title: "pi-web-access synthetic DNS is configured",
      detail: `${TARGET_HOSTNAME} resolved to ${syntheticAddresses.map(({ address }) => address).join(", ")}, already covered by ssrf.allowRanges in ${configPath}.`,
    });
  } else {
    const resolved = addresses.map(({ address }) => address).join(", ") || "no addresses";
    checks.push({
      id: "pi-web-access.synthetic-dns",
      severity: "ok",
      title: "pi-web-access DNS compatibility",
      detail: `${TARGET_HOSTNAME} resolved without a known synthetic VPN range (${resolved}).`,
    });
  }

  return buildReport(checks, startedAt);
}

function buildReport(checks: ExtensionDoctorCheck[], startedAt: number): ExtensionDoctorReport {
  const warnings = checks.filter((check) => check.severity === "warn").length;
  return {
    extensionId: "sf-pi-manager",
    title: "pi-web-access compatibility",
    summary: warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "✓ ready",
    checks,
    durationMs: Date.now() - startedAt,
  };
}

function isPiWebAccessSource(source: string): boolean {
  return /^(?:npm:)?pi-web-access(?:@|$)/i.test(source.trim());
}

async function defaultLookup(hostname: string): Promise<readonly LookupAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

function resolvePiWebAccessConfigPath(): string {
  const explicitDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (explicitDir) return path.join(explicitDir, "web-search.json");

  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  if (xdgConfigHome) {
    const xdgPath = path.join(xdgConfigHome, "pi", "web-search.json");
    if (existsSync(xdgPath)) return xdgPath;
    const legacyPath = path.join(homedir(), ".pi", "web-search.json");
    if (existsSync(legacyPath)) return legacyPath;
    return xdgPath;
  }

  return globalAgentPath("web-search.json");
}

function inspectConfig(configPath: string): ConfigInspection {
  if (!existsSync(configPath)) return { allowRanges: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    return {
      allowRanges: [],
      error: `Failed to parse ${configPath}: ${errorMessage(error)}`,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { allowRanges: [], error: `${configPath} must contain a JSON object.` };
  }
  const ssrf = (parsed as { ssrf?: unknown }).ssrf;
  if (ssrf === undefined || ssrf === null) return { allowRanges: [] };
  if (typeof ssrf !== "object" || Array.isArray(ssrf)) {
    return { allowRanges: [], error: `ssrf in ${configPath} must be an object.` };
  }
  const allowRanges = (ssrf as { allowRanges?: unknown }).allowRanges;
  if (allowRanges === undefined || allowRanges === null) return { allowRanges: [] };
  if (!Array.isArray(allowRanges) || allowRanges.some((entry) => typeof entry !== "string")) {
    return {
      allowRanges: [],
      error: `ssrf.allowRanges in ${configPath} must be an array of CIDR strings.`,
    };
  }
  const ranges = allowRanges as string[];
  const invalidRange = ranges.find((range) => !isValidIpRange(range));
  if (invalidRange) {
    return {
      allowRanges: [],
      error: `Invalid CIDR notation in ssrf.allowRanges in ${configPath}: ${JSON.stringify(invalidRange)}.`,
    };
  }
  return { allowRanges: ranges };
}

function isValidIpRange(raw: string): boolean {
  const parts = raw.trim().split("/");
  if (parts.length > 2) return false;
  const version = net.isIP(parts[0] ?? "");
  if (version === 0) return false;
  if (parts.length === 1) return true;
  if (!/^\d+$/.test(parts[1] ?? "")) return false;
  const prefix = Number(parts[1]);
  const maxPrefix = version === 4 ? 32 : 128;
  return Number.isInteger(prefix) && prefix >= 1 && prefix <= maxPrefix;
}

function syntheticRange(address: string): "100.64.0.0/10" | "198.18.0.0/15" | null {
  if (ipv4CidrContains("100.64.0.0/10", address)) return "100.64.0.0/10";
  if (ipv4CidrContains("198.18.0.0/15", address)) return "198.18.0.0/15";
  return null;
}

function narrowIpv4Range(address: string): string {
  const octets = address.split(".");
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

function ipv4CidrContains(rawCidr: string, rawAddress: string): boolean {
  const cidr = parseIpv4Cidr(rawCidr.trim());
  const address = parseIpv4(rawAddress);
  if (!cidr || address === null) return false;
  const blockSize = 2 ** (32 - cidr.prefix);
  return Math.floor(address / blockSize) === Math.floor(cidr.address / blockSize);
}

function parseIpv4Cidr(raw: string): Ipv4Cidr | null {
  const parts = raw.split("/");
  if (parts.length > 2) return null;
  const address = parseIpv4(parts[0] ?? "");
  if (address === null) return null;
  const prefix = parts.length === 1 ? 32 : Number(parts[1]);
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > 32) return null;
  return { address, prefix };
}

function parseIpv4(raw: string): number | null {
  const parts = raw.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return octets.reduce((value, octet) => value * 256 + octet, 0);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`DNS lookup timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
