/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

  it("distinguishes a tool outside Herdr from pane-control readiness", () => {
    const status = collectHerdrRuntimeStatus(cwd, {
      activeToolNames: ["herdr"],
      env: {},
    });

    expect(status).toMatchObject({ kind: "tool-only", toolActive: true, activeControlEnv: false });
  });

  it("reports missing when sf-herdr is enabled but the upstream tool is absent", () => {
    const status = collectHerdrRuntimeStatus(cwd, { activeToolNames: [], allToolNames: [] });
    expect(status.kind).toBe("missing");
  });
});
