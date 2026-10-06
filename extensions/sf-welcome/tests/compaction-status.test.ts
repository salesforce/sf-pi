/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetCompactionStatusStoreForTests,
  setCompactionStatus,
} from "../../../lib/common/compaction-status/store.ts";
import { collectInitialSplashData } from "../lib/splash-data.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
const originalAgentDir = process.env[PI_AGENT_ENV];
let agentDir: string;
let cwd: string;

beforeEach(() => {
  agentDir = mkdtempSync(path.join(os.tmpdir(), "sf-welcome-compaction-agent-"));
  cwd = mkdtempSync(path.join(os.tmpdir(), "sf-welcome-compaction-project-"));
  process.env[PI_AGENT_ENV] = agentDir;
  __resetCompactionStatusStoreForTests();
});

afterEach(() => {
  __resetCompactionStatusStoreForTests();
  if (originalAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = originalAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("Welcome compaction status", () => {
  it("hydrates first paint from the shared cache-only snapshot", () => {
    setCompactionStatus({
      kind: "dedicated",
      model: "sf-llm-gateway/example-model",
      modelLabel: "Example Model",
      contextWindow: 1_000_000,
      source: "global",
    });

    const data = collectInitialSplashData("Chat Model", "sf-llm-gateway", 3000, cwd);

    expect(data.compactionVisible).toBe(true);
    expect(data.compactionStatus).toMatchObject({
      kind: "dedicated",
      modelLabel: "Example Model",
      contextWindow: 1_000_000,
    });
  });
});
