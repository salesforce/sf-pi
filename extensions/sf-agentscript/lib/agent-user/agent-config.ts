/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read `config.agent_type` and `config.default_agent_user` from a parsed
 * .agent file. Tiny on purpose — the agent-user verbs only need those two
 * fields, and depending on the broader inspect surface here would couple
 * lifecycle preflight to inspect's evolving shape.
 *
 * Uses the official SDK package to parse + walk the AST exactly the way the
 * mutate path does (lib/mutate.ts), so a malformed config block is
 * surfaced as a clean error instead of a silent skip.
 */

import { readFile } from "node:fs/promises";
import { loadAgentforceSDK } from "../sdk.ts";

export interface AgentConfigSlice {
  ok: true;
  agent_type?: string;
  default_agent_user?: string;
  agent_name?: string;
}

export interface AgentConfigSliceFailure {
  ok: false;
  reason: "sdk_unavailable" | "read_failed" | "parse_failed";
  reason_detail: string;
}

/**
 * Read the .agent file at `agentFile` and return its `config` block's
 * agent_type / default_agent_user / agent_name fields. All three are
 * optional in the source — we only return them when present.
 */
export async function readAgentConfigSlice(
  agentFile: string,
): Promise<AgentConfigSlice | AgentConfigSliceFailure> {
  let source: string;
  try {
    source = await readFile(agentFile, "utf8");
  } catch (err) {
    return {
      ok: false,
      reason: "read_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }
  return readAgentConfigSliceFromSource(source);
}

export async function readAgentConfigSliceFromSource(
  source: string,
): Promise<AgentConfigSlice | AgentConfigSliceFailure> {
  const sdk = await loadAgentforceSDK();
  if (!sdk) {
    return {
      ok: false,
      reason: "sdk_unavailable",
      reason_detail: "Vendored Agentforce SDK is not loadable.",
    };
  }
  let ast: Record<string, unknown>;
  try {
    const doc = (sdk as { parse: (s: string) => unknown }).parse(source) as {
      ast: Record<string, unknown>;
      hasErrors?: boolean;
    };
    if (doc.hasErrors) {
      return {
        ok: false,
        reason: "parse_failed",
        reason_detail:
          "Source has parse errors. Run agentscript_authoring compile/check to see them.",
      };
    }
    ast = doc.ast;
  } catch (err) {
    return {
      ok: false,
      reason: "parse_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }
  const config = ast.config as Record<string, unknown> | undefined;
  if (!config || typeof config !== "object") {
    return { ok: true };
  }
  const out: AgentConfigSlice = { ok: true };
  const agent_type = unwrapScalar(config.agent_type);
  if (typeof agent_type === "string") out.agent_type = agent_type;
  const default_agent_user = unwrapScalar(config.default_agent_user);
  if (typeof default_agent_user === "string") out.default_agent_user = default_agent_user;
  const agent_name = unwrapScalar(config.agent_name);
  if (typeof agent_name === "string") out.agent_name = agent_name;
  return out;
}

/**
 * The SDK wraps scalar field values in Literal nodes shaped like
 * `{ value: <real value>, __cst: ... }`. Unwrap to the raw scalar.
 */
function unwrapScalar(node: unknown): unknown {
  if (node == null) return undefined;
  // The `node == null` guard above already returned for both null and
  // undefined, so a second `node !== null` check here is provably true.
  if (typeof node === "object" && "value" in node) {
    return (node as { value: unknown }).value;
  }
  return node;
}
