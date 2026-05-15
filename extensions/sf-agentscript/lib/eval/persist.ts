/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Disk persistence for eval runs.
 *
 * Layout — diff-friendly, LLM-friendly. Mirrors the @salesforce/agents
 * session-store layout but anchored on the run instead of an agent/session
 * pair:
 *
 *   <run_dir>/
 *   ├── metadata.json           # spec, org, version, timing, totals, latency summary
 *   ├── raw.json                # full HTML-decoded merged response
 *   ├── transcript.jsonl        # one line per turn, sortable + diff-able
 *   ├── failures.jsonl          # one line per failed test, LLM-shaped
 *   └── traces/
 *       └── <planId>.json       # full planner trace per failed turn (when fetched)
 *
 * Run directory layout: `<base>/<run_id>/` where `run_id` is an ISO-ish
 * timestamp suffixed with a 6-char random tag. The base directory is
 * `<cwd>/.pi/state/sf-agentscript/runs/` by default.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  EvalApiResponse,
  EvalSpec,
  FailureRecord,
  LastExecution,
  PlannerResponse,
  RunMetadata,
  SessionContext,
} from "./types.ts";

export const DEFAULT_RUN_BASE_REL = path.join(".pi", "state", "sf-agentscript", "runs");

export function defaultRunBase(cwd: string): string {
  return path.join(cwd, DEFAULT_RUN_BASE_REL);
}

export function resolveRunDir(cwd: string, runId: string, base?: string): string {
  return path.join(base ?? defaultRunBase(cwd), runId);
}

export interface PersistInput {
  runDir: string;
  merged: EvalApiResponse;
  traces: Map<string, unknown | null>;
  metadata: RunMetadata;
  failures: FailureRecord[];
  /**
   * Optional: the post-normalize spec, used to cross-reference user
   * utterances onto each turn in transcript.jsonl. The eval API doesn't
   * echo back the original utterance in its response, so without this we
   * write `utterance: null` for every turn — actively misleading when
   * a developer reads the transcript later.
   */
  spec?: EvalSpec;
}

/**
 * Build a map of `${test_id}::${step_id}` → utterance from the spec, so the
 * transcript writer can fill in the user input when the API response omits
 * it.
 */
function buildUtteranceIndex(spec?: EvalSpec): Map<string, string> {
  const out = new Map<string, string>();
  for (const test of spec?.tests ?? []) {
    const tid = String(test.id ?? "?");
    for (const step of test.steps ?? []) {
      if (step.type === "agent.send_message" && typeof step.utterance === "string") {
        out.set(`${tid}::${step.id}`, step.utterance);
      }
    }
  }
  return out;
}

export async function writeRun(input: PersistInput): Promise<void> {
  const { runDir, merged, traces, metadata, failures } = input;
  const utteranceIndex = buildUtteranceIndex(input.spec);
  await mkdir(runDir, { recursive: true });

  // metadata.json
  await writeFile(path.join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");

  // raw.json — the full merged eval response (already HTML-decoded by caller)
  await writeFile(path.join(runDir, "raw.json"), JSON.stringify(merged, null, 2), "utf-8");

  // transcript.jsonl — one entry per agent.send_message turn across all tests
  const transcriptLines: string[] = [];
  for (const test of merged.results ?? []) {
    const tid = test.id ?? "?";
    const outputs = test.outputs ?? [];

    // Pair agent.send_message outputs with the *next* agent.get_state output
    // by execution order. Earlier we keyed on a hardcoded `turn<n>` ↔ `state<n>`
    // naming convention which silently dropped topic + state_variables for any
    // spec using a different naming scheme (e.g. `t1`, `sm`).
    const stateAfter = new Map<number, number>(); // sendIndex → stateIndex
    {
      let lastSendIndex = -1;
      for (let i = 0; i < outputs.length; i++) {
        const out = outputs[i];
        if (out.type === "agent.send_message") {
          lastSendIndex = i;
        } else if (
          out.type === "agent.get_state" &&
          lastSendIndex !== -1 &&
          !stateAfter.has(lastSendIndex)
        ) {
          stateAfter.set(lastSendIndex, i);
        }
      }
    }

    for (let i = 0; i < outputs.length; i++) {
      const o = outputs[i];
      if (o.type !== "agent.send_message") continue;
      const turnId = o.id ?? "";
      const stateIndex = stateAfter.get(i);
      const stateOut = stateIndex !== undefined ? outputs[stateIndex] : undefined;
      const pr = (stateOut?.response as { planner_response?: PlannerResponse } | undefined)
        ?.planner_response;
      const le: LastExecution = pr?.lastExecution ?? {};
      const sc: SessionContext = pr?.sessionContext ?? {};

      const replyResp = o.response;
      let reply: string;
      if (typeof replyResp === "string") reply = replyResp;
      else if (replyResp && typeof replyResp === "object" && "messages" in replyResp) {
        const m = (replyResp as { messages?: Array<{ message?: string }> }).messages?.[0]?.message;
        reply = m ?? JSON.stringify(replyResp);
      } else {
        reply = replyResp == null ? "" : JSON.stringify(replyResp);
      }

      const utteranceFromResponse = typeof o.utterance === "string" ? o.utterance : undefined;
      const utteranceFromSpec = utteranceIndex.get(`${tid}::${turnId}`);
      // planId lives on sessionProperties for the current eval-API shape;
      // fall back to lastExecution.message.planId for the older shape.
      // See trace-client.ts:collectPlanKeys for the same fallback.
      const planIdForTurn =
        (pr?.sessionProperties as { planId?: string } | undefined)?.planId ?? le.message?.planId;
      transcriptLines.push(
        JSON.stringify({
          test_id: tid,
          turn_id: turnId,
          utterance: utteranceFromResponse ?? utteranceFromSpec ?? null,
          agent_response: reply,
          topic: le.topic,
          invoked_actions: le.invokedActions,
          latency_ms: le.latency,
          plan_id: planIdForTurn,
          errors: le.errors ?? [],
          state_variables: sc.stateVariables ?? {},
        }),
      );
    }
  }
  if (transcriptLines.length > 0) {
    await writeFile(
      path.join(runDir, "transcript.jsonl"),
      transcriptLines.join("\n") + "\n",
      "utf-8",
    );
  }

  // failures.jsonl — one line per failed test, LLM-shaped
  if (failures.length > 0) {
    const lines = failures.map((f) => JSON.stringify(f));
    await writeFile(path.join(runDir, "failures.jsonl"), lines.join("\n") + "\n", "utf-8");
  }

  // traces/<planId>.json — only writes for traces that returned a usable body
  if (traces.size > 0) {
    const tracesDir = path.join(runDir, "traces");
    await mkdir(tracesDir, { recursive: true });
    for (const [key, body] of traces.entries()) {
      if (body == null) continue;
      const planId = key.split("::").pop() ?? key;
      await writeFile(
        path.join(tracesDir, `${planId}.json`),
        JSON.stringify(body, null, 2),
        "utf-8",
      );
    }
  }
}

/** Generate a sortable run id: `YYYYMMDD-HHMMSS-<6 hex>`. */
export function newRunId(now: Date = new Date()): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const rand = Math.random().toString(16).slice(2, 8);
  return `${stamp}-${rand}`;
}
