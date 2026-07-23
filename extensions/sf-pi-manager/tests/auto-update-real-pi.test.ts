/* SPDX-License-Identifier: Apache-2.0 */
/** Real Pi 0.81 lifecycle proof for agent-settled automatic updates. */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const PI_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "pi");
const tempDirs: string[] = [];

function writeExecutable(filePath: string, body: string): void {
  writeFileSync(filePath, `#!/bin/sh\nset -eu\n${body}\n`);
  chmodSync(filePath, 0o755);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Agent-Settled Update Coordinator through real Pi", () => {
  it("runs after agent_settled with suppression env set and never invokes self-update", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "sf-pi-m6-real-pi-"));
    tempDirs.push(root);
    const agentDir = path.join(root, "agent");
    const fakeBin = path.join(root, "bin");
    const commandLog = path.join(root, "commands.log");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      path.join(agentDir, "settings.json"),
      JSON.stringify({
        sfPi: { autoUpdate: true },
        packages: ["npm:@ogulcancelik/pi-herdr"],
      }),
    );
    const herdrDir = path.join(agentDir, "npm", "node_modules", "@ogulcancelik", "pi-herdr");
    mkdirSync(herdrDir, { recursive: true });
    writeFileSync(
      path.join(herdrDir, "package.json"),
      JSON.stringify({ name: "@ogulcancelik/pi-herdr", version: "0.3.0" }),
    );

    writeExecutable(
      path.join(fakeBin, "npm"),
      `printf 'npm %s\\n' "$*" >> "$SF_PI_M6_COMMAND_LOG"\nprintf '%s\\n' '{"version":"0.4.0","peerDependencies":{"@earendil-works/pi-coding-agent":"*"},"engines":{"node":">=18.0.0"}}'`,
    );
    writeExecutable(path.join(fakeBin, "pi"), `printf 'pi %s\\n' "$*" >> "$SF_PI_M6_COMMAND_LOG"`);
    writeExecutable(path.join(fakeBin, "sf"), `printf 'sf %s\\n' "$*" >> "$SF_PI_M6_COMMAND_LOG"`);

    const request = `${JSON.stringify({ id: "m6", type: "prompt", message: "settle" })}\n`;
    const child = spawn(
      PI_BIN,
      [
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-context-files",
        "--no-session",
        "-e",
        path.join(REPO_ROOT, "extensions/sf-pi-manager/index.ts"),
        "-e",
        path.join(
          REPO_ROOT,
          "extensions/sf-pi-manager/tests/fixtures/auto-update-runtime-probe.ts",
        ),
        "--provider",
        "sf-pi-auto-update-probe",
        "--model",
        "probe",
        "--mode",
        "rpc",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
          PI_CODING_AGENT_DIR: agentDir,
          PI_SKIP_VERSION_CHECK: "1",
          PI_UPDATER_SUPPRESSED_NATIVE_VERSION_CHECK: "1",
          SF_PI_M6_COMMAND_LOG: commandLog,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let inputClosed = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!inputClosed && stdout.includes('"title":"Auto Update complete"')) {
        inputClosed = true;
        child.stdin.end();
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const completion = new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`real Pi Auto Update proof timed out\n${stderr}\n${stdout}`));
      }, 30_000);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    child.stdin.write(request);
    const exitCode = await completion;

    expect(exitCode, stderr).toBe(0);
    expect(existsSync(commandLog), JSON.stringify({ stdout, stderr }, null, 2)).toBe(true);
    const commands = readFileSync(commandLog, "utf8").trim().split("\n");
    expect(commands).toEqual([
      "npm view @ogulcancelik/pi-herdr@latest version peerDependencies engines --json",
      "pi update --extension npm:@ogulcancelik/pi-herdr --no-approve",
      "sf update stable",
    ]);
    expect(commands.join("\n")).not.toContain("--self");
    expect(commands.join("\n")).not.toContain("--all");

    const events = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const entries = events.filter((event) => event.type === "entry_appended") as Array<{
      entry?: { customType?: string; data?: { title?: string; body?: string } };
    }>;
    expect(entries.map((event) => event.entry?.data?.title)).toEqual([
      "Auto Update planned",
      "Auto Update complete",
    ]);
    expect(JSON.stringify(entries)).not.toContain(root);
  });
});
