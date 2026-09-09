/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectHerdrRuntimeStatus,
  detectHerdrClientStatus,
  parseHerdrClientStatus,
} from "../lib/herdr-runtime-status.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let cwd: string;
let prevAgent: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-herdr-runtime-"));
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

function writeGlobalSettings(settings: unknown): void {
  writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify(settings, null, 2));
}

function writeProjectSettings(settings: unknown): void {
  const settingsDir = path.join(cwd, ".pi");
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(path.join(settingsDir, "settings.json"), JSON.stringify(settings, null, 2));
}

function writePiIntegration(contents: string): void {
  const extensionsDir = path.join(tmpDir, "extensions");
  mkdirSync(extensionsDir, { recursive: true });
  writeFileSync(path.join(extensionsDir, "herdr-agent-state.ts"), contents);
}

function writeControlPackage(version: string): void {
  const packageDir = path.join(tmpDir, "npm", "node_modules", "@ogulcancelik", "pi-herdr");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ version }));
}

describe("Herdr Runtime Readiness", () => {
  it("parses and detects the installed runtime version, channel, and protocol locally", async () => {
    const output = [
      "version: 0.8.0-preview.2026-08-04-d78e3d3b5126",
      "channel: preview",
      "protocol: 19",
      "binary: /example/herdr",
    ].join("\n");

    expect(parseHerdrClientStatus(output)).toEqual({
      runtimeVersion: "0.8.0-preview.2026-08-04-d78e3d3b5126",
      runtimeChannel: "preview",
      runtimeProtocol: 19,
      runtimeVersionLoading: false,
    });
    await expect(
      detectHerdrClientStatus(async () => ({ stdout: output, stderr: "", code: 0 })),
    ).resolves.toMatchObject({
      runtimeVersion: "0.8.0-preview.2026-08-04-d78e3d3b5126",
      runtimeChannel: "preview",
      runtimeProtocol: 19,
      runtimeVersionLoading: false,
    });
  });

  it("reads the installed Pi control-package version without a subprocess", () => {
    writeControlPackage("0.4.0");

    const status = collectHerdrRuntimeStatus(cwd, { activeToolNames: [] });

    expect(status.controlPackageVersion).toBe("0.4.0");
  });

  it("reports ready only when all three current tools and active pane-control env are present", () => {
    const status = collectHerdrRuntimeStatus(cwd, {
      activeToolNames: ["herdr_layout", "herdr_pane", "herdr_agent"],
      env: { HERDR_ENV: "1", HERDR_PANE_ID: "pane-1", HERDR_SOCKET_PATH: "/tmp/herdr.sock" },
    });

    expect(status).toMatchObject({
      kind: "ready",
      toolActive: true,
      activeControlEnv: true,
      passiveStatusBridge: true,
      runtimeVersionLoading: true,
    });
  });

  it("does not report partial split-tool activation as ready", () => {
    const status = collectHerdrRuntimeStatus(cwd, {
      activeToolNames: ["herdr_layout", "herdr_pane"],
      env: { HERDR_ENV: "1", HERDR_PANE_ID: "pane-1" },
    });

    expect(status).toMatchObject({ kind: "missing", toolActive: false });
  });

  it("uses all current tools through the all-tools fallback", () => {
    const status = collectHerdrRuntimeStatus(cwd, {
      allToolNames: ["herdr_layout", "herdr_pane", "herdr_agent"],
      env: { HERDR_ENV: "1", HERDR_PANE_ID: "pane-1" },
    });

    expect(status).toMatchObject({ kind: "ready", toolActive: true });
  });

  it("distinguishes current tools outside Herdr from pane-control readiness", () => {
    const status = collectHerdrRuntimeStatus(cwd, {
      activeToolNames: ["herdr_layout", "herdr_pane", "herdr_agent"],
      env: {},
    });

    expect(status).toMatchObject({ kind: "tool-only", toolActive: true, activeControlEnv: false });
  });

  it("reports installed-not-active when the upstream package is configured but the tool is absent", () => {
    writeGlobalSettings({ packages: ["npm:@ogulcancelik/pi-herdr@0.2.5"] });

    const status = collectHerdrRuntimeStatus(cwd, { activeToolNames: [], allToolNames: [] });

    expect(status).toMatchObject({
      kind: "installed-not-active",
      packageInstalled: true,
      toolActive: false,
    });
  });

  it("detects the upstream package from project object-form package settings", () => {
    writeProjectSettings({ packages: [{ source: "npm:@ogulcancelik/pi-herdr@0.2.5" }] });

    const status = collectHerdrRuntimeStatus(cwd, { activeToolNames: [], allToolNames: [] });

    expect(status).toMatchObject({
      kind: "installed-not-active",
      packageInstalled: true,
    });
  });

  it("treats the git monorepo as providing the Herdr package", () => {
    writeGlobalSettings({ packages: ["git:github.com/ogulcancelik/pi-extensions"] });

    const status = collectHerdrRuntimeStatus(cwd, { activeToolNames: [], allToolNames: [] });

    expect(status).toMatchObject({
      kind: "installed-not-active",
      packageInstalled: true,
    });
  });

  it("detects the Herdr-installed Pi state integration version", () => {
    writePiIntegration(
      [
        "// installed by herdr",
        "// HERDR_INTEGRATION_ID=pi",
        "// HERDR_INTEGRATION_VERSION=4",
      ].join("\n"),
    );

    const status = collectHerdrRuntimeStatus(cwd, { activeToolNames: [], allToolNames: [] });

    expect(status.piIntegration).toMatchObject({ kind: "installed", version: 4 });
  });

  it("reports a missing Pi state integration when Herdr has not installed it", () => {
    const status = collectHerdrRuntimeStatus(cwd, { activeToolNames: [], allToolNames: [] });
    expect(status.piIntegration).toMatchObject({ kind: "missing" });
  });

  it("reports missing when sf-herdr is enabled but the upstream package and tool are absent", () => {
    const status = collectHerdrRuntimeStatus(cwd, { activeToolNames: [], allToolNames: [] });
    expect(status).toMatchObject({ kind: "missing", packageInstalled: false });
  });
});
