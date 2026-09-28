/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectPlannotatorRuntime,
  readCachedPlannotatorRuntime,
  writeCachedPlannotatorRuntime,
} from "../plannotator-runtime.ts";
import { managedTuiPath } from "../../../extensions/sf-planreview/lib/installer.ts";
import { canonicalStatePath } from "../state-store.ts";

const directory = mkdtempSync(path.join(tmpdir(), "sf-pi-plannotator-runtime-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
beforeEach(() => {
  process.env.PI_CODING_AGENT_DIR = directory;
});
afterEach(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});

describe("Plannotator runtime readiness", () => {
  it("distinguishes an official Full Herdr install from the Lite plugin", async () => {
    const root = path.join(directory, "annotate");
    mkdirSync(path.join(root, "bin"), { recursive: true });
    const binary = path.join(root, "bin", "plannotator-tui.exe");
    writeFileSync(binary, "fixture", { mode: 0o700 });
    const plugin = (full: boolean) =>
      JSON.stringify({
        result: {
          plugins: [
            {
              plugin_id: "annotate",
              enabled: true,
              plugin_root: root,
              source: { kind: "github", owner: "plannotator", repo: "herdr-annotate" },
              panes: full ? [{ id: "doc" }] : [],
              actions: full ? [{ id: "open" }] : [{ id: "capture" }],
            },
          ],
        },
      });
    const exec = (full: boolean) => async (command: string, _args: string[]) => {
      if (command === "herdr") return { stdout: plugin(full), stderr: "", code: 0 };
      if (command === binary) return { stdout: "plannotator-tui 0.9.4", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 1 };
    };
    expect(await detectPlannotatorRuntime(exec(true))).toMatchObject({
      installed: true,
      herdrReady: true,
      version: "0.9.4",
    });
    expect(await detectPlannotatorRuntime(exec(false))).toMatchObject({
      installed: false,
      herdrReady: false,
      herdrState: "lite",
    });
  });

  it("detects a standalone TUI without Herdr", async () => {
    const status = await detectPlannotatorRuntime(async (command) => ({
      stdout: command === "plannotator-tui" ? "plannotator-tui 0.9.4" : "",
      stderr: "",
      code: command === "plannotator-tui" ? 0 : 1,
    }));
    expect(status).toMatchObject({ installed: true, standaloneReady: true, version: "0.9.4" });
    writeCachedPlannotatorRuntime(status);
    expect(readFileSync(canonicalStatePath("sf-planreview", "status.json"), "utf8")).not.toContain(
      "binaryPath",
    );
    expect(readCachedPlannotatorRuntime()).toMatchObject({
      installed: true,
      standaloneReady: true,
    });
  });

  it("distinguishes a damaged managed binary from a clean missing install", async () => {
    const binary = managedTuiPath();
    mkdirSync(path.dirname(binary), { recursive: true });
    writeFileSync(binary, "damaged", { mode: 0o700 });
    expect(
      await detectPlannotatorRuntime(async () => ({ stdout: "", stderr: "", code: 1 })),
    ).toMatchObject({ installed: false, managedState: "damaged" });
    rmSync(binary);
    expect(
      await detectPlannotatorRuntime(async () => ({ stdout: "", stderr: "", code: 1 })),
    ).toMatchObject({ installed: false, managedState: "missing" });
  });

  it("reports missing when neither supported TUI is available", async () => {
    expect(
      await detectPlannotatorRuntime(async () => ({ stdout: "", stderr: "", code: 1 })),
    ).toMatchObject({ installed: false, herdrReady: false, standaloneReady: false });
  });
});

afterAll(() => {
  rmSync(directory, { force: true, recursive: true });
});
