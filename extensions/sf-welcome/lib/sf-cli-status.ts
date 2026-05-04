/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Lightweight SF CLI status for the welcome splash.
 *
 * This intentionally checks only the local CLI install + npm-published latest
 * version. Org/config detection belongs to sf-devbar and the shared Salesforce
 * environment runtime, not to the welcome screen.
 */
import type { SfCliStatusInfo } from "./types.ts";

export type SfCliExecFn = (
  command: string,
  args: string[],
  options?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

export function parseSfCliVersion(output: string): string | undefined {
  const firstToken = output.trim().split(/\s+/)[0];
  if (!firstToken) return undefined;

  const normalized = firstToken.replace(/^@salesforce\/cli\//, "").replace(/^v/, "");
  return normalized || undefined;
}

export function isVersionCurrent(installed: string, latest: string): boolean {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((part) => parseInt(part, 10) || 0);

  const installedParts = parse(installed);
  const latestParts = parse(latest);

  for (let index = 0; index < Math.max(installedParts.length, latestParts.length); index++) {
    const installedPart = installedParts[index] ?? 0;
    const latestPart = latestParts[index] ?? 0;
    if (installedPart > latestPart) return true;
    if (installedPart < latestPart) return false;
  }

  return true;
}

export async function detectSfCliStatus(exec: SfCliExecFn): Promise<SfCliStatusInfo> {
  let installedVersion: string | undefined;

  try {
    const versionResult = await exec("sf", ["--version"], { timeout: 10_000 });
    if (versionResult.code !== 0) {
      return { installed: false, freshness: "unknown", loading: false };
    }
    installedVersion = parseSfCliVersion(versionResult.stdout);
  } catch {
    return { installed: false, freshness: "unknown", loading: false };
  }

  try {
    const latestResult = await exec("npm", ["view", "@salesforce/cli", "version"], {
      timeout: 15_000,
    });
    const latestVersion = latestResult.stdout.trim().replace(/^v/, "") || undefined;

    if (latestResult.code !== 0 || !latestVersion || !installedVersion) {
      return { installed: true, installedVersion, freshness: "unknown", loading: false };
    }

    return {
      installed: true,
      installedVersion,
      latestVersion,
      freshness: isVersionCurrent(installedVersion, latestVersion) ? "latest" : "update-available",
      loading: false,
    };
  } catch {
    return { installed: true, installedVersion, freshness: "unknown", loading: false };
  }
}
