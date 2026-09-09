/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderDoctor } from "../lib/status.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

describe("renderDoctor", () => {
  let tmpDir: string;
  let cwd: string;
  let prevAgent: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-herdr-status-"));
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

  it("flags duplicate npm and git Herdr packages", () => {
    writeFileSync(
      path.join(tmpDir, "settings.json"),
      JSON.stringify({
        packages: ["npm:@ogulcancelik/pi-herdr", "git:github.com/ogulcancelik/pi-extensions"],
      }),
    );

    const report = renderDoctor([], {}, cwd);
    expect(report).toContain("Duplicate Herdr packages");
    expect(report).toContain("npm:@ogulcancelik/pi-herdr");
  });
});
