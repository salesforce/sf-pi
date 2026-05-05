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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Minimum pi-coding-agent version required by sf-pi extensions. Keep in
 * sync with `peerDependencies.@mariozechner/pi-coding-agent` in the root
 * package.json. Bump this whenever sf-pi starts depending on an API added
 * in a newer pi release.
 */
export const MIN_PI_VERSION = "0.73.0";

/**
 * Cached pi-coding-agent version read from its package.json. Cached because
 * it is stable for the life of the pi process and all ten sf-pi extensions
 * call `requirePiVersion()` at startup.
 */
let cachedPiVersion: string | undefined | null = null;

/**
 * Read pi-coding-agent's installed version from its package.json. Returns
 * `undefined` if the package cannot be resolved.
 *
 * Implementation: `pi-coding-agent`'s `exports` map does not expose
 * `./package.json`, so `require.resolve("@mariozechner/pi-coding-agent/package.json")`
 * fails with ERR_PACKAGE_PATH_NOT_EXPORTED. Instead we walk up from this
 * file's location looking for `node_modules/@mariozechner/pi-coding-agent/package.json`,
 * which works for both the installed case (node_modules in the pi host) and
 * the linked case (node_modules inside sf-pi itself).
 */
export function getInstalledPiVersion(): string | undefined {
  if (cachedPiVersion !== null) return cachedPiVersion;
  try {
    const here = fileURLToPath(import.meta.url);
    let dir = dirname(here);
    for (let i = 0; i < 20; i += 1) {
      const candidate = join(
        dir,
        "node_modules",
        "@mariozechner",
        "pi-coding-agent",
        "package.json",
      );
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as { version?: unknown };
        cachedPiVersion = typeof pkg.version === "string" ? pkg.version : undefined;
        return cachedPiVersion;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    cachedPiVersion = undefined;
  } catch {
    cachedPiVersion = undefined;
  }
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
        "Run `pi update` to upgrade pi. If `pi --version` still reports the old version, run `npm install -g @mariozechner/pi-coding-agent@latest --force`, then `hash -r` and `pi --version`.",
      ].join(" "),
    );
  }
  return false;
}
