/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Detect how the upstream Herdr Pi tools are installed.
 *
 * The official sf-pi source is the isolated npm package. The git monorepo
 * `ogulcancelik/pi-extensions` also ships `pi-herdr`. Pi treats those as two
 * packages, so installing both registers herdr_layout / herdr_pane /
 * herdr_agent twice and fails startup.
 */
import { existsSync, readFileSync } from "node:fs";
import { globalSettingsPath, projectSettingsPath } from "./pi-paths.ts";

export const HERDR_PI_PACKAGE_SOURCE = "npm:@ogulcancelik/pi-herdr";
export const HERDR_PI_GIT_MONOREPO_SOURCE = "git:github.com/ogulcancelik/pi-extensions";
export const HERDR_RECOMMENDATION_ID = "pi-herdr";

const OFFICIAL_NPM_NAME = "@ogulcancelik/pi-herdr";
const GIT_REPO = /(?:^|[/:])ogulcancelik\/pi-extensions(?:\.git)?(?:[@/#]|$)/;

export type HerdrPackageInstallKind = "missing" | "official" | "git-only" | "duplicate";
export type HerdrOfficialInstallAction = "install" | "already-present" | "skip-duplicate";

export interface HerdrPackageInstall {
  kind: HerdrPackageInstallKind;
  npmSources: string[];
  gitSources: string[];
  hasOfficialNpm: boolean;
  hasGitMonorepo: boolean;
  providesHerdrTools: boolean;
  duplicate: boolean;
}

export function isOfficialHerdrNpmSource(source: string): boolean {
  const body = npmSpec(source);
  return body === OFFICIAL_NPM_NAME || body.startsWith(`${OFFICIAL_NPM_NAME}@`);
}

export function isHerdrGitMonorepoSource(source: string): boolean {
  return GIT_REPO.test(source.trim().toLowerCase());
}

export function inspectHerdrPackageSources(sources: readonly string[]): HerdrPackageInstall {
  const npmSources = sources.filter(isOfficialHerdrNpmSource);
  const gitSources = sources.filter(isHerdrGitMonorepoSource);
  const hasOfficialNpm = npmSources.length > 0;
  const hasGitMonorepo = gitSources.length > 0;
  const duplicate = hasOfficialNpm && hasGitMonorepo;
  const kind: HerdrPackageInstallKind = duplicate
    ? "duplicate"
    : hasOfficialNpm
      ? "official"
      : hasGitMonorepo
        ? "git-only"
        : "missing";
  return {
    kind,
    npmSources,
    gitSources,
    hasOfficialNpm,
    hasGitMonorepo,
    providesHerdrTools: hasOfficialNpm || hasGitMonorepo,
    duplicate,
  };
}

export function collectSettingsPackageSources(cwd: string): string[] {
  return [
    ...readPackageSources(globalSettingsPath()),
    ...readPackageSources(projectSettingsPath(cwd)),
  ];
}

export function collectHerdrPackageInstall(cwd: string): HerdrPackageInstall {
  return inspectHerdrPackageSources(collectSettingsPackageSources(cwd));
}

export function resolveHerdrOfficialInstallAction(
  itemId: string,
  sources: readonly string[],
): HerdrOfficialInstallAction {
  if (itemId !== HERDR_RECOMMENDATION_ID) return "install";
  const install = inspectHerdrPackageSources(sources);
  if (install.duplicate) return "skip-duplicate";
  if (install.providesHerdrTools) return "already-present";
  return "install";
}

function npmSpec(source: string): string {
  const trimmed = source.trim().toLowerCase();
  return trimmed.startsWith("npm:") ? trimmed.slice(4) : "";
}

function readPackageSources(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { packages?: unknown };
    const packages = Array.isArray(parsed.packages) ? parsed.packages : [];
    const sources: string[] = [];
    for (const pkg of packages) {
      if (typeof pkg === "string") {
        if (pkg.trim()) sources.push(pkg);
        continue;
      }
      if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) continue;
      const source = (pkg as { source?: unknown }).source;
      if (typeof source === "string" && source.trim()) sources.push(source);
    }
    return sources;
  } catch {
    return [];
  }
}
