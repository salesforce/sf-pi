/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for process-local Agent Script Analysis Snapshot caching. */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  agentScriptAnalysisCacheSize,
  clearAgentScriptAnalysisCache,
  getAgentScriptAnalysis,
  invalidateAgentScriptAnalysis,
} from "../lib/analysis-snapshot.ts";

vi.mock("../lib/diagnostics.ts", () => ({
  checkAgentScriptSource: vi.fn(async () => ({ ok: true, diagnostics: [], quickFixes: [] })),
}));

vi.mock("../lib/inspect.ts", () => ({
  inspectSource: vi.fn(async () => ({
    ok: true,
    components: { topics: [], subagents: [], variables: [], actions: [] },
    stats: { topics: 0, subagents: 0, variables: 0, actions: 0 },
  })),
}));

const { checkAgentScriptSource } = await import("../lib/diagnostics.ts");
const { inspectSource } = await import("../lib/inspect.ts");

afterEach(() => {
  clearAgentScriptAnalysisCache();
  vi.clearAllMocks();
});

describe("Agent Script Analysis Snapshot", () => {
  test("reuses one snapshot and lazy analysis promises for an unchanged file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-analysis-"));
    const file = path.join(dir, "Agent.agent");
    try {
      await writeFile(file, "config:\n  agent_name: Agent\n", "utf8");

      const one = await getAgentScriptAnalysis(file);
      const two = await getAgentScriptAnalysis(file);
      expect(one).toBe(two);
      expect(agentScriptAnalysisCacheSize()).toBe(1);

      await Promise.all([one.getCompile(), two.getCompile()]);
      await Promise.all([one.getInspect(), two.getInspect()]);
      await Promise.all([one.getFeatureProfile(), two.getFeatureProfile()]);

      expect(checkAgentScriptSource).toHaveBeenCalledTimes(1);
      expect(inspectSource).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("invalidate removes cached snapshots for a file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-analysis-"));
    const file = path.join(dir, "Agent.agent");
    try {
      await writeFile(file, "config:\n  agent_name: Agent\n", "utf8");
      const one = await getAgentScriptAnalysis(file);
      invalidateAgentScriptAnalysis(file);
      const two = await getAgentScriptAnalysis(file);

      expect(one).not.toBe(two);
      expect(agentScriptAnalysisCacheSize()).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
