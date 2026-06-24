/* SPDX-License-Identifier: Apache-2.0 */
/**
 * pi-compat — feature-detecting shims and a minimum-pi-version gate.
 *
 * Why this exists:
 *   sf-pi's `peerDependencies` is a soft contract — npm only warns on
 *   install, it does not block startup. If a user runs sf-pi against a pi
 *   older than our floor, extension factories can crash with cryptic
 *   `ctx.ui.<method> is not a function` or `pi.registerProvider` schema
 *   errors instead of a friendly "please run `pi update`" message.
 *
 *   `requirePiVersion()` is the single gate we call at the top of every
 *   extension factory. Below the floor it logs one actionable warning and
 *   returns `false`, letting the factory short-circuit cleanly so the rest
 *   of pi keeps starting up.
 *
 *   The feature-detecting shims below cover additive APIs that we adopted
 *   before bumping the floor to cover them. They stay in place to absorb
 *   accidental runs on pre-floor builds while the version gate escalates
 *   to a clean opt-out for extensions that hard-require newer APIs.
 */
import * as PiRuntime from "@earendil-works/pi-coding-agent";

/**
 * Minimum pi-coding-agent version required by sf-pi extensions. Keep in
 * sync with `peerDependencies.@earendil-works/pi-coding-agent` in the root
 * package.json. Bump this whenever sf-pi starts depending on an API added
 * in a newer pi release.
 */
export const MIN_PI_VERSION = "0.80.2";

/**
 * Cached pi-coding-agent version exported by the host Pi Runtime. Cached
 * because it is stable for the life of the pi process and every sf-pi
 * extension calls `requirePiVersion()` at startup.
 */
let cachedPiVersion: string | undefined | null = null;

/**
 * Read the host Pi Runtime's installed version from Pi's public export.
 * This keeps the version gate aligned with Pi instead of re-discovering the
 * package root through node_modules path walking.
 */
export function getInstalledPiVersion(): string | undefined {
  if (cachedPiVersion !== null) return cachedPiVersion;
  const version = (PiRuntime as { VERSION?: unknown }).VERSION;
  cachedPiVersion = typeof version === "string" && version.trim() ? version.trim() : undefined;
  return cachedPiVersion;
}

/**
 * Compare two semver-ish version strings (`x.y.z` or `x.y.z-tag`). Returns
 * negative if `a < b`, positive if `a > b`, 0 if equal. Pre-release tags are
 * treated as "older than the same release without a tag", which is enough
 * for "is user's pi >= floor?" checks; we do not ship against pre-release
 * pi builds in production.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const [core, pre = ""] = v.split("-");
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
  if (!pa.pre) return 1; // a is a full release, b is a prerelease of the same core
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

const warnedExtensions = new Set<string>();

/**
 * Gate an extension behind a minimum pi-coding-agent version.
 *
 * Usage at the top of every extension factory:
 *
 * ```ts
 * export default function (pi: ExtensionAPI) {
 *   if (!requirePiVersion(pi, "sf-slack")) return;
 *   // … rest of factory
 * }
 * ```
 *
 * On success returns `true`. When the installed pi is older than
 * {@link MIN_PI_VERSION}, logs a one-line warning (at most once per
 * extension per process) and returns `false` so the factory can short-circuit
 * cleanly. Unknown pi versions (cannot read package.json) return `true` — we
 * would rather attempt the load and surface a real error than silently skip
 * every extension on an unfamiliar pi fork.
 */
export function requirePiVersion(
  _pi: unknown,
  extensionName: string,
  minVersion: string = MIN_PI_VERSION,
): boolean {
  const installed = getInstalledPiVersion();
  if (!installed) return true; // unknown — do not block; let real errors surface.
  if (compareVersions(installed, minVersion) >= 0) return true;

  if (!warnedExtensions.has(extensionName)) {
    warnedExtensions.add(extensionName);
    console.warn(
      [
        `[sf-pi] Skipping "${extensionName}": requires pi-coding-agent >= ${minVersion}, found ${installed}.`,
        "Run `pi update --self --force`. If `pi --version` still reports the old version, run `/sf-pi doctor` for install-specific repair guidance.",
      ].join(" "),
    );
  }
  return false;
}
