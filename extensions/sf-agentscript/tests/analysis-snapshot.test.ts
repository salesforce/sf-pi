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

const upstream = vi.hoisted(() => ({
  result: {
    ok: true,
    analysis: {
      source: "config:\n  agent_name: Agent\n",
      compileDiagnostics: [],
      documentState: { ast: {} },
    },
  } as unknown,
}));

vi.mock("../lib/agentforce-document.ts", () => ({
  analyzeAgentScriptSource: vi.fn(async () => upstream.result),
}));

vi.mock("../lib/diagnostics.ts", () => ({
  checkAgentScriptSource: vi.fn(async (_source, result) =>
    result?.ok === false
      ? {
          ok: false,
          diagnostics: [],
          quickFixes: [],
          failureKind: result.failureKind,
          unavailableReason: result.unavailableReason,
        }
      : { ok: true, diagnostics: [], quickFixes: [] },
  ),
}));

vi.mock("../lib/inspect.ts", () => ({
  inspectSource: vi.fn(async (_source, result) =>
    result?.ok === false
      ? { ok: false, reason: "sdk_unavailable", reason_detail: result.unavailableReason }
      : {
          ok: true,
          components: { topics: [], subagents: [], variables: [], actions: [] },
          stats: { topics: 0, subagents: 0, variables: 0, actions: 0 },
        },
  ),
}));

vi.mock("../lib/quality/engine.ts", () => ({
  runAgentScriptQuality: vi.fn(async (_source, options) => ({
    ok: !options?.analysisFailure,
    status: options?.analysisFailure ? "failed" : "clean",
    findings: [],
    summary: { high: 0, moderate: 0, low: 0, info: 0 },
    metrics: { cyclomatic_complexity: [] },
    coverage: { total_rules: 0, enabled_rules: 0, disabled_rules: [] },
    suppressions: { applied: [], invalid: [], unused: [] },
    ...(options?.analysisFailure ? { failure_reason: options.analysisFailure } : {}),
  })),
}));

const { analyzeAgentScriptSource } = await import("../lib/agentforce-document.ts");
const { checkAgentScriptSource } = await import("../lib/diagnostics.ts");
const { inspectSource } = await import("../lib/inspect.ts");
const { runAgentScriptQuality } = await import("../lib/quality/engine.ts");

afterEach(() => {
  clearAgentScriptAnalysisCache();
  upstream.result = {
    ok: true,
    analysis: {
      source: "config:\n  agent_name: Agent\n",
      compileDiagnostics: [],
      documentState: { ast: {} },
    },
  };
  vi.clearAllMocks();
});

describe("Agent Script Analysis Snapshot", () => {
  test("reuses stable analysis while recomputing settings-dependent projections", async () => {
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
      await Promise.all([one.getQuality(), two.getQuality()]);
      await Promise.all([one.getFeatureProfile(), two.getFeatureProfile()]);

      expect(analyzeAgentScriptSource).toHaveBeenCalledTimes(1);
      expect(checkAgentScriptSource).toHaveBeenCalledTimes(2);
      expect(inspectSource).toHaveBeenCalledTimes(1);
      expect(runAgentScriptQuality).toHaveBeenCalledTimes(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reuses one failed upstream analysis across every projection", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-analysis-"));
    const file = path.join(dir, "Agent.agent");
    try {
      await writeFile(file, "config:\n  agent_name: Agent\n", "utf8");
      upstream.result = {
        ok: false,
        source: "config:\n  agent_name: Agent\n",
        failureKind: "sdk_unavailable",
        unavailableReason: "SDK unavailable",
      };
      const snapshot = await getAgentScriptAnalysis(file);

      const [compile, inspect, quality] = await Promise.all([
        snapshot.getCompile(),
        snapshot.getInspect(),
        snapshot.getQuality(),
      ]);

      expect(analyzeAgentScriptSource).toHaveBeenCalledTimes(1);
      expect(compile).toMatchObject({ ok: false, unavailableReason: "SDK unavailable" });
      expect(inspect).toMatchObject({ ok: false, reason_detail: "SDK unavailable" });
      expect(quality).toMatchObject({
        ok: false,
        status: "failed",
        failure_reason: "SDK unavailable",
      });
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
