/* SPDX-License-Identifier: Apache-2.0 */
/**
 * pi-compat — feature-detecting shims and Pi runtime compatibility policy.
 *
 * Why this exists:
 *   sf-pi's `peerDependencies` is a soft contract — npm only warns on
 *   install, it does not block startup. If a user runs sf-pi against a Pi
 *   older than our floor, extension factories can crash with cryptic
 *   `ctx.ui.<method> is not a function` or provider schema errors.
 *
 *   Newer stable Pi 0.x releases are different: lack of an audit is not proof
 *   of incompatibility. `requirePiVersion()` therefore blocks only known hard
 *   boundaries (too old, prerelease, or Pi 1.x+) and lets newer stable 0.x
 *   releases load with one process-wide forward-compatibility warning.
 */
import * as PiRuntime from "@earendil-works/pi-coding-agent";
import path from "node:path";

/** Oldest Pi release whose public APIs satisfy every bundled extension. */
export const MIN_PI_VERSION = "0.81.1";

/** Oldest Oh My Pi release whose legacy Pi compatibility layer is supported. */
export const MIN_OMP_VERSION = "17.1.3";

/** OMP majors are audited independently because they do not follow Pi's 0.x versions. */
export const MAX_OMP_VERSION_EXCLUSIVE = "18.0.0";

/** Exclusive end of the exact runtime range covered by required compatibility CI. */
export const AUDITED_MAX_PI_VERSION_EXCLUSIVE = "0.83.0";

/** Future stable Pi 0.x releases may load; Pi 1.x requires an explicit audit. */
export const HARD_MAX_PI_VERSION_EXCLUSIVE = "1.0.0";

/** Exact runtime used by normal development and bounded repair guidance. */
export const RECOMMENDED_PI_VERSION = "0.82.0";

export type PiVersionCompatibility =
  "audited" | "forward-compatible" | "too-old" | "prerelease" | "major-version";

export type PiRuntimeFlavor = "pi" | "omp";

export interface RuntimeFlavorSignals {
  version?: string;
  agentDir?: string;
  execPath?: string;
  argv?: string[];
}

/**
 * Identify OMP without depending on OMP-only imports, which would make the
 * normal Pi runtime fail module resolution. The compiled OMP binary is named
 * `omp`; source/npm launches retain an `omp` argv entry. The version + agent
 * directory fallback covers wrappers while avoiding a false positive for Pi.
 */
export function detectPiRuntimeFlavor(signals: RuntimeFlavorSignals = {}): PiRuntimeFlavor {
  const executableNames = [signals.execPath, ...(signals.argv ?? [])]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => path.basename(value).toLowerCase());
  if (executableNames.some((name) => name === "omp" || name === "omp.exe")) return "omp";

  const major = Number.parseInt(signals.version?.split(".", 1)[0] ?? "", 10);
  const normalizedAgentDir = signals.agentDir?.replaceAll("\\", "/").toLowerCase();
  if (Number.isFinite(major) && major >= 1 && normalizedAgentDir?.includes("/.omp/")) return "omp";

  return "pi";
}

function currentRuntimeFlavor(installed: string | undefined): PiRuntimeFlavor {
  const getAgentDir = (PiRuntime as { getAgentDir?: () => string }).getAgentDir;
  return detectPiRuntimeFlavor({
    version: installed,
    agentDir: typeof getAgentDir === "function" ? getAgentDir() : undefined,
    execPath: process.execPath,
    argv: process.argv,
  });
}

/** Active host family for behavior that cannot be expressed through the shared API. */
export function getPiRuntimeFlavor(): PiRuntimeFlavor {
  return currentRuntimeFlavor(getInstalledPiVersion());
}

/** Cached host version; stable for the life of the Pi process. */
let cachedPiVersion: string | undefined | null = null;

export function getInstalledPiVersion(): string | undefined {
  if (cachedPiVersion !== null) return cachedPiVersion;
  const version = (PiRuntime as { VERSION?: unknown }).VERSION;
  cachedPiVersion = typeof version === "string" && version.trim() ? version.trim() : undefined;
  return cachedPiVersion;
}

/**
 * Compare semver-ish versions (`x.y.z` or `x.y.z-tag`). Build metadata is
 * ignored and prereleases sort below the matching full release.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const [withoutBuild = v] = v.split("+", 1);
    const [core, pre = ""] = withoutBuild.split("-", 2);
    const nums = core.split(".").map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
    while (nums.length < 3) nums.push(0);
    return { nums, pre };
  };

  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

export function classifyPiVersion(
  version: string,
  minVersion: string = MIN_PI_VERSION,
  auditedMaxVersionExclusive: string = AUDITED_MAX_PI_VERSION_EXCLUSIVE,
  hardMaxVersionExclusive: string = HARD_MAX_PI_VERSION_EXCLUSIVE,
): PiVersionCompatibility {
  // npm peer ranges do not opt into prereleases. Ignore hyphens after `+`,
  // which are valid stable build metadata such as `0.82.0+build-1`.
  const versionWithoutBuild = version.split("+", 1)[0] ?? version;
  if (versionWithoutBuild.includes("-")) return "prerelease";
  if (compareVersions(version, minVersion) < 0) return "too-old";
  if (compareVersions(version, hardMaxVersionExclusive) >= 0) return "major-version";
  if (compareVersions(version, auditedMaxVersionExclusive) >= 0) {
    return "forward-compatible";
  }
  return "audited";
}

export function isPiVersionLoadable(
  version: string,
  minVersion: string = MIN_PI_VERSION,
  hardMaxVersionExclusive: string = HARD_MAX_PI_VERSION_EXCLUSIVE,
): boolean {
  const compatibility = classifyPiVersion(
    version,
    minVersion,
    AUDITED_MAX_PI_VERSION_EXCLUSIVE,
    hardMaxVersionExclusive,
  );
  return compatibility === "audited" || compatibility === "forward-compatible";
}

const warnedBlockedExtensions = new Set<string>();
let warnedForwardCompatibility = false;

/**
 * Gate each extension behind the hard runtime boundaries while allowing stable
 * future Pi 0.x releases to load in forward-compatibility mode.
 */
export function requirePiVersion(
  _pi: unknown,
  extensionName: string,
  minVersion: string = MIN_PI_VERSION,
  auditedMaxVersionExclusive: string = AUDITED_MAX_PI_VERSION_EXCLUSIVE,
  hardMaxVersionExclusive: string = HARD_MAX_PI_VERSION_EXCLUSIVE,
): boolean {
  const installed = getInstalledPiVersion();
  if (!installed) return true;

  if (currentRuntimeFlavor(installed) === "omp") {
    const supported =
      compareVersions(installed, MIN_OMP_VERSION) >= 0 &&
      compareVersions(installed, MAX_OMP_VERSION_EXCLUSIVE) < 0 &&
      !installed.split("+", 1)[0]?.includes("-");
    if (supported) return true;

    if (!warnedBlockedExtensions.has(extensionName)) {
      warnedBlockedExtensions.add(extensionName);
      console.warn(
        `[sf-pi] Skipping "${extensionName}": requires stable Oh My Pi >= ${MIN_OMP_VERSION} and < ${MAX_OMP_VERSION_EXCLUSIVE}; found ${installed}.`,
      );
    }
    return false;
  }

  const compatibility = classifyPiVersion(
    installed,
    minVersion,
    auditedMaxVersionExclusive,
    hardMaxVersionExclusive,
  );
  if (compatibility === "audited") return true;

  if (compatibility === "forward-compatible") {
    if (!warnedForwardCompatibility) {
      warnedForwardCompatibility = true;
      console.warn(
        `[sf-pi] Pi ${installed} is newer than the audited range (< ${auditedMaxVersionExclusive}). Loading sf-pi in forward-compatibility mode; no downgrade is recommended unless a concrete failure occurs.`,
      );
    }
    return true;
  }

  if (!warnedBlockedExtensions.has(extensionName)) {
    warnedBlockedExtensions.add(extensionName);
    console.warn(
      [
        `[sf-pi] Skipping "${extensionName}": requires stable pi-coding-agent >= ${minVersion} and < ${hardMaxVersionExclusive}; found ${installed} (${compatibility}).`,
        `Use Pi ${RECOMMENDED_PI_VERSION}, then run \`/sf-pi doctor runtime\` for install-specific guidance.`,
      ].join(" "),
    );
  }
  return false;
}
