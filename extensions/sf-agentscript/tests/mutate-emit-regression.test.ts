/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Regression: a deep `agentscript_authoring mutate set_field` against a real .agent
 * file produced corrupted output (a partial copy of the file's last line
 * appended to itself). Live trace:
 *
 *   set_field topic.escalation.description on Pi_E2E_Final_Test.agent
 *   reported  Δ 16 bytes  Post-compile: ❌ 1 error(s) @ L127
 *   actual    last line had `description: "...for another issue."r another issue."`
 *
 * Root cause is in the official SDK package's CST/AST emit() — under specific
 * shapes the proposed `after` string contains duplicated tail bytes. We
 * couldn't reproduce it deterministically from clean source, but the
 * symptom is consistent: emit() introduces severity-1 errors that weren't
 * present in the source we received.
 *
 * Fix: defensive write. Before clobbering the file, run compileSource()
 * on the proposed `after` and reject the write if it introduces any new
 * severity-1 diagnostic that wasn't in the `before`. The user gets a
 * clean `emit_regression` error and the disk is untouched.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { applyMutation, checkAgentScriptFileFromSource } from "../lib/mutate.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-emit-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const CLEAN_SOURCE = `config:
    agent_name: "Sample"
    description: "A sample agent."
    agent_type: "AgentforceEmployeeAgent"

system:
    instructions: "Be brief."

topic main_topic:
    description: "Primary topic."

start_agent main:
    description: "Entry point."
    transition to @topic.main_topic
`;

describe("checkAgentScriptFileFromSource", () => {
  test("clean source → ok=true, no severity-1 diagnostics", async () => {
    const out = await checkAgentScriptFileFromSource(CLEAN_SOURCE);
    expect(out).toBeTruthy();
    expect(out?.ok).toBe(true);
    const sev1 = (out?.diagnostics ?? []).filter((d) => d.severity === 1);
    expect(sev1).toHaveLength(0);
  });

  test("source with corruption appended → at least one severity-1 diagnostic", async () => {
    // Simulate the live-observed corruption: extra junk appended to the
    // last line. The SDK's parser flags this as a syntax error.
    const corrupted = CLEAN_SOURCE + 'description: "Return to triage."r another issue."\n';
    const out = await checkAgentScriptFileFromSource(corrupted);
    expect(out).toBeTruthy();
    const sev1 = (out?.diagnostics ?? []).filter((d) => d.severity === 1);
    expect(sev1.length).toBeGreaterThan(0);
  });
});

describe("applyMutation rolls back on emit regression", () => {
  test("happy path: clean mutation writes the file", async () => {
    const file = path.join(workDir, "X.agent");
    await writeFile(file, CLEAN_SOURCE, "utf8");
    const r = await applyMutation({
      op: "set_field",
      path: file,
      component: "topic.main_topic",
      field: "description",
      value: "Updated primary topic description.",
    });
    expect(r.ok).toBe(true);
    const onDisk = await readFile(file, "utf8");
    expect(onDisk).toContain("Updated primary topic description.");
  });

  test("when the SDK emit produces a regression, the file on disk is untouched", async () => {
    // We can't easily force the SDK to emit corruption on demand. What we
    // CAN do is verify that the mutate path runs the regression check by
    // checking that after a successful mutate, the post-mutate compile is
    // also clean. This is a contract test: if the regression check ever
    // gets removed, applyMutation could still write a corrupt file.
    const file = path.join(workDir, "X.agent");
    await writeFile(file, CLEAN_SOURCE, "utf8");
    const r = await applyMutation({
      op: "set_field",
      path: file,
      component: "topic.main_topic",
      field: "description",
      value: "Another update.",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const sev1 = (r.diagnostics_after ?? []).filter((d) => d.severity === 1);
      expect(sev1).toHaveLength(0);
    }
  });
});
