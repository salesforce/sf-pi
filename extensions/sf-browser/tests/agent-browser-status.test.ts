/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectBrowserRuntimeStatus,
  parseAgentBrowserVersion,
  readCachedBrowserRuntimeStatus,
  writeCachedBrowserRuntimeStatus,
  type BrowserRuntimeExecFn,
} from "../../../lib/common/browser-runtime-status/store.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let prevAgent: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-agent-browser-status-"));
  mkdirSync(tmpDir, { recursive: true });
  prevAgent = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (prevAgent === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgent;
  rmSync(tmpDir, { recursive: true, force: true });
});

function execWith(stdout: string, code = 0): BrowserRuntimeExecFn {
  return async () => ({ stdout, stderr: "", code });
}

describe("agent-browser runtime status", () => {
  it("parses agent-browser version output", () => {
    expect(parseAgentBrowserVersion("agent-browser 0.9.1\n")).toBe("0.9.1");
  });

  it("reports latest when installed version matches npm", async () => {
    const status = await detectBrowserRuntimeStatus(
      execWith("agent-browser 0.9.1"),
      async () => "0.9.1",
    );
    expect(status).toMatchObject({
      installed: true,
      installedVersion: "0.9.1",
      latestVersion: "0.9.1",
      freshness: "latest",
      loading: false,
    });
  });

  it("reports update availability", async () => {
    const status = await detectBrowserRuntimeStatus(
      execWith("agent-browser 0.9.1"),
      async () => "0.10.0",
    );
    expect(status.freshness).toBe("update-available");
    expect(status.latestVersion).toBe("0.10.0");
  });

  it("detects Homebrew-owned installs for update guidance", async () => {
    const status = await detectBrowserRuntimeStatus(
      async (command, args) => {
        const key = [command, ...args].join(" ");
        if (key === "agent-browser --version") {
          return { stdout: "agent-browser 0.9.1", stderr: "", code: 0 };
        }
        if (key === "which agent-browser") {
          return { stdout: "/opt/homebrew/bin/agent-browser", stderr: "", code: 0 };
        }
        if (key === "brew list --formula agent-browser") {
          return { stdout: "agent-browser", stderr: "", code: 0 };
        }
        return { stdout: "", stderr: "", code: 1 };
      },
      async () => "0.10.0",
    );

    expect(status).toMatchObject({
      freshness: "update-available",
      installSource: "homebrew",
      binaryPath: "/opt/homebrew/bin/agent-browser",
    });
  });

  it("does not fetch latest when version command fails", async () => {
    let fetches = 0;
    const status = await detectBrowserRuntimeStatus(execWith("", 127), async () => {
      fetches += 1;
      return "0.10.0";
    });
    expect(status.installed).toBe(false);
    expect(fetches).toBe(0);
  });

  it("round-trips cached status", () => {
    writeCachedBrowserRuntimeStatus({
      installed: true,
      installedVersion: "0.9.1",
      latestVersion: "0.9.1",
      freshness: "latest",
      loading: false,
    });
    expect(readCachedBrowserRuntimeStatus()).toMatchObject({
      installed: true,
      installedVersion: "0.9.1",
      freshness: "latest",
      loading: false,
    });
  });
});
