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

/** Oldest Pi release whose public APIs satisfy every bundled extension. */
export const MIN_PI_VERSION = "0.84.0";

/** Exclusive end of the exact runtime range covered by required compatibility CI. */
export const AUDITED_MAX_PI_VERSION_EXCLUSIVE = "0.86.0";

/** Future stable Pi 0.x releases may load; Pi 1.x requires an explicit audit. */
export const HARD_MAX_PI_VERSION_EXCLUSIVE = "1.0.0";

/** Exact runtime used by normal development and bounded repair guidance. */
export const RECOMMENDED_PI_VERSION = "0.85.1";

export type PiVersionCompatibility =
  "audited" | "forward-compatible" | "too-old" | "prerelease" | "major-version";

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
