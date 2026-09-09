/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectHerdrPackageInstall,
  HERDR_PI_GIT_MONOREPO_SOURCE,
  HERDR_PI_PACKAGE_SOURCE,
  inspectHerdrPackageSources,
  isHerdrGitMonorepoSource,
  isOfficialHerdrNpmSource,
  resolveHerdrOfficialInstallAction,
} from "../herdr-package-sources.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

describe("Herdr package source detection", () => {
  it("recognizes the official npm package with or without a version", () => {
    expect(isOfficialHerdrNpmSource(HERDR_PI_PACKAGE_SOURCE)).toBe(true);
    expect(isOfficialHerdrNpmSource("npm:@ogulcancelik/pi-herdr@0.4.0")).toBe(true);
    expect(isOfficialHerdrNpmSource("NPM:@OgulcanCelik/pi-herdr")).toBe(true);
    expect(isOfficialHerdrNpmSource("npm:@ogulcancelik/pi-herdr-extra")).toBe(false);
    expect(isOfficialHerdrNpmSource(HERDR_PI_GIT_MONOREPO_SOURCE)).toBe(false);
  });

  it("recognizes the git monorepo that also ships pi-herdr", () => {
    expect(isHerdrGitMonorepoSource(HERDR_PI_GIT_MONOREPO_SOURCE)).toBe(true);
    expect(isHerdrGitMonorepoSource("git:github.com/ogulcancelik/pi-extensions@main")).toBe(true);
    expect(isHerdrGitMonorepoSource("git:github.com/ogulcancelik/pi-extensions.git")).toBe(true);
    expect(isHerdrGitMonorepoSource("https://github.com/ogulcancelik/pi-extensions")).toBe(true);
    expect(isHerdrGitMonorepoSource("git:git@github.com:ogulcancelik/pi-extensions")).toBe(true);
    expect(isHerdrGitMonorepoSource("git:github.com/ogulcancelik/other")).toBe(false);
    expect(isHerdrGitMonorepoSource(HERDR_PI_PACKAGE_SOURCE)).toBe(false);
  });

  it("classifies missing, official, git-only, and duplicate installs", () => {
    expect(inspectHerdrPackageSources([]).kind).toBe("missing");
    expect(inspectHerdrPackageSources([HERDR_PI_PACKAGE_SOURCE]).kind).toBe("official");
    expect(inspectHerdrPackageSources([HERDR_PI_GIT_MONOREPO_SOURCE]).kind).toBe("git-only");
    expect(
      inspectHerdrPackageSources([HERDR_PI_PACKAGE_SOURCE, HERDR_PI_GIT_MONOREPO_SOURCE]),
    ).toMatchObject({
      kind: "duplicate",
      duplicate: true,
      providesHerdrTools: true,
    });
  });

  it("skips adding the official npm package when git already provides the tools", () => {
    expect(resolveHerdrOfficialInstallAction("pi-web-access", [])).toBe("install");
    expect(resolveHerdrOfficialInstallAction("pi-herdr", [])).toBe("install");
    expect(resolveHerdrOfficialInstallAction("pi-herdr", [HERDR_PI_PACKAGE_SOURCE])).toBe(
      "already-present",
    );
    expect(resolveHerdrOfficialInstallAction("pi-herdr", [HERDR_PI_GIT_MONOREPO_SOURCE])).toBe(
      "already-present",
    );
    expect(
      resolveHerdrOfficialInstallAction("pi-herdr", [
        HERDR_PI_PACKAGE_SOURCE,
        HERDR_PI_GIT_MONOREPO_SOURCE,
      ]),
    ).toBe("skip-duplicate");
  });
});

describe("collectHerdrPackageInstall", () => {
  let tmpDir: string;
  let cwd: string;
  let prevAgent: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-herdr-packages-"));
    cwd = path.join(tmpDir, "project");
    mkdirSync(cwd, { recursive: true });
    prevAgent = process.env[PI_AGENT_ENV];
    process.env[PI_AGENT_ENV] = tmpDir;
  });

  afterEach(() => {
    if (prevAgent === undefined) delete process.env[PI_AGENT_ENV];
    else process.env[PI_AGENT_ENV] = prevAgent;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("unions global and project package sources", () => {
    writeFileSync(
      path.join(tmpDir, "settings.json"),
      JSON.stringify({ packages: [HERDR_PI_PACKAGE_SOURCE] }),
    );
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "settings.json"),
      JSON.stringify({ packages: [{ source: HERDR_PI_GIT_MONOREPO_SOURCE }] }),
    );

    expect(collectHerdrPackageInstall(cwd).kind).toBe("duplicate");
  });
});
