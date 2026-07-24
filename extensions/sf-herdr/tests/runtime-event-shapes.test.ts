/* SPDX-License-Identifier: Apache-2.0 */
/** Exact Pi 0.81 proof for the tool lifecycle shape consumed by SF Herdr. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";

import { createHerdrSignalState } from "../lib/signal-state.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const piBin = path.join(repoRoot, "node_modules", ".bin", "pi");
const fixturePath = path.join(import.meta.dirname, "fixtures", "runtime-event-probe.ts");
const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-herdr-event-shape-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SF Herdr through real Pi tool events", () => {
  it("observes validated input on tool_result while tool_execution_end has no args", () => {
    const cwd = tempDir();
    const agentDir = tempDir();
    const outputPath = path.join(cwd, "events.json");
    const result = spawnSync(
      piBin,
      [
        "--offline",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-context-files",
        "--no-session",
        "-e",
        fixturePath,
        "--provider",
        "sf-herdr-event-probe",
        "--model",
        "probe",
        "--print",
        "Run the deterministic Herdr probe.",
      ],
      {
        cwd,
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: agentDir,
          SF_HERDR_EVENT_PROBE_OUTPUT: outputPath,
        },
        encoding: "utf8",
        timeout: 30_000,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    const records = JSON.parse(readFileSync(outputPath, "utf8")) as Array<{
      type: string;
      toolName: string;
      args?: unknown;
      input?: unknown;
      hasArgs?: boolean;
      isError?: boolean;
    }>;
    expect(records.map((record) => record.type)).toEqual([
      "tool_execution_start",
      "tool_result",
      "tool_execution_end",
    ]);
    expect(records[0]?.args).toEqual({
      action: "run",
      command: "sf apex run test --tests ExampleTest",
    });
    expect(records[1]?.input).toEqual(records[0]?.args);
    expect(records[2]?.hasArgs).toBe(false);

    const state = createHerdrSignalState();
    state.observeToolResult(
      {
        type: "tool_result",
        toolCallId: "runtime-probe",
        toolName: records[1]?.toolName ?? "",
        input: records[1]?.input as Record<string, unknown>,
        content: [{ type: "text", text: "ok" }],
        details: {},
        isError: records[1]?.isError ?? false,
      } satisfies ToolResultEvent,
      cwd,
    );
    expect(state.infer().primaryWorkflow).toBe("apex");
  }, 30_000);
});
