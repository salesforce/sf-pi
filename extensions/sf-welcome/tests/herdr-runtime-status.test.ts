/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectHerdrRuntimeStatus } from "../lib/herdr-runtime-status.ts";

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

describe("Herdr Runtime Readiness", () => {
  it("reports ready only with the upstream tool and active pane-control env", () => {
    const status = collectHerdrRuntimeStatus(cwd, {
      activeToolNames: ["herdr"],
      env: { HERDR_ENV: "1", HERDR_PANE_ID: "pane-1", HERDR_SOCKET_PATH: "/tmp/herdr.sock" },
    });

    expect(status).toMatchObject({
      kind: "ready",
      toolActive: true,
      activeControlEnv: true,
      passiveStatusBridge: true,
    });
  });

  it.each(["herdr_layout", "herdr_pane", "herdr_agent"])(
    "recognizes the current split-tool API through %s",
    (toolName) => {
      const status = collectHerdrRuntimeStatus(cwd, {
        activeToolNames: [toolName],
        env: { HERDR_ENV: "1", HERDR_PANE_ID: "pane-1" },
      });

      expect(status).toMatchObject({ kind: "ready", toolActive: true });
    },
  );

  it("recognizes split tools through the all-tools fallback", () => {
    const status = collectHerdrRuntimeStatus(cwd, {
      allToolNames: ["herdr_layout"],
      env: { HERDR_ENV: "1", HERDR_PANE_ID: "pane-1" },
    });

    expect(status).toMatchObject({ kind: "ready", toolActive: true });
  });

  it("distinguishes a tool outside Herdr from pane-control readiness", () => {
    const status = collectHerdrRuntimeStatus(cwd, {
      activeToolNames: ["herdr"],
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
