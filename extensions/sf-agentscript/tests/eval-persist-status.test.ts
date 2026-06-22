/* SPDX-License-Identifier: Apache-2.0 */

import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { writeRunStatus } from "../lib/eval/persist.ts";

describe("eval run status persistence", () => {
  test("writes a lightweight status artifact without raw eval payloads", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "sf-agentscript-status-"));

    await writeRunStatus(runDir, {
      schema_version: 1,
      run_id: "run-1",
      status: "running",
      phase: "running_batches",
      started: "2026-06-21T00:00:00.000Z",
      updated: "2026-06-21T00:00:01.000Z",
      spec_path: "specs/demo.eval.json",
      org: "Demo-Dev",
      agent_api_name: "Demo_Agent",
      tests_count: 18,
      batches: 4,
      concurrency: 4,
      traces_mode: "failed",
      batch_timeout_ms: 300_000,
    });

    const artifact = JSON.parse(await readFile(path.join(runDir, "status.json"), "utf-8"));

    expect(artifact).toEqual({
      schema_version: 1,
      run_id: "run-1",
      status: "running",
      phase: "running_batches",
      started: "2026-06-21T00:00:00.000Z",
      updated: "2026-06-21T00:00:01.000Z",
      spec_path: "specs/demo.eval.json",
      org: "Demo-Dev",
      agent_api_name: "Demo_Agent",
      tests_count: 18,
      batches: 4,
      concurrency: 4,
      traces_mode: "failed",
      batch_timeout_ms: 300_000,
    });
    expect(artifact).not.toHaveProperty("raw");
    expect(artifact).not.toHaveProperty("merged");
    expect(artifact).not.toHaveProperty("prompt");
    expect(artifact).not.toHaveProperty("transcript");
  });
});
