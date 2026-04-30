/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Async SF CLI freshness check — is the installed version the latest?
 *
 * Runs `npm view @salesforce/cli version` once per session.
 * Fully non-blocking: returns a cached result or "unknown" while checking.
 */

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

export type CliFreshness = "latest" | "update-available" | "checking" | "unknown";

export type CliFreshnessResult = {
  status: CliFreshness;
  installedVersion?: string;
  latestVersion?: string;
};

export type ExecFn = (
  command: string,
  args: string[],
  options?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string; code: number }>;

// -------------------------------------------------------------------------------------------------
// Version comparison
// -------------------------------------------------------------------------------------------------

/**
 * Compare two semver-like version strings.
 * Returns true if installed matches or exceeds latest.
 */
export function isVersionCurrent(installed: string, latest: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);

  const i = parse(installed);
  const l = parse(latest);

  for (let idx = 0; idx < Math.max(i.length, l.length); idx++) {
    const iv = i[idx] ?? 0;
    const lv = l[idx] ?? 0;
    if (iv > lv) return true;
    if (iv < lv) return false;
  }
  return true; // Equal
}

// -------------------------------------------------------------------------------------------------
// Detection
// -------------------------------------------------------------------------------------------------

/**
 * Check if the installed SF CLI version is the latest.
 * Uses `npm view @salesforce/cli version` with a generous timeout.
 *
 * This is fire-and-forget — call it once on session_start, cache the result.
 */
export async function checkCliFreshness(
  exec: ExecFn,
  installedVersion: string | undefined,
): Promise<CliFreshnessResult> {
  if (!installedVersion) {
    return { status: "unknown" };
  }

  try {
    const result = await exec("npm", ["view", "@salesforce/cli", "version"], { timeout: 15000 });

    if (result.code !== 0 || !result.stdout.trim()) {
      return { status: "unknown", installedVersion };
    }

    const latestVersion = result.stdout.trim();
    const current = isVersionCurrent(installedVersion, latestVersion);

    return {
      status: current ? "latest" : "update-available",
      installedVersion,
      latestVersion,
    };
  } catch {
    return { status: "unknown", installedVersion };
  }
}
