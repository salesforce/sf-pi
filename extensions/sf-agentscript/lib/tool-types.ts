/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared tool-result helpers.
 *
 * `safeResolveToolPath` wraps `resolveToolPath` so every tool surface gets
 * the same clean INVALID_PATH error when the LLM passes a `..`-escape or a
 * relative path that resolves outside the workspace.
 *
 * Shared tool result + error contracts for sf-agentscript.
 *
 * Every LLM-callable tool returns a `ToolEnvelope<T>`. On success `details`
 * is a structured `T`; on failure `details` is a `ToolError` carrying both
 * a human suggestion and a programmatic `recover_via` tool call so the LLM
 * can chain a follow-up without parsing prose.
 *
 * This file is the canonical source for tool result shapes — every tool in
 * `lib/tools/` constructs its result through `toolOk()` / `toolError()`.
 */

import { PathEscapeError, resolveToolPath } from "./file-classify.ts";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

/** One item from Pi's tool result `content` array. We only emit `text` parts. */
export interface ToolTextPart {
  type: "text";
  text: string;
}

/**
 * Universal tool envelope. `details` is the structured payload the sf-pi UI
 * and the LLM both consume; `content[0].text` is the LLM-readable rendering
 * of the same data.
 */
export interface ToolEnvelope<T> {
  content: ToolTextPart[];
  details: T | ToolError;
}

/**
 * Standard tool error shape. `recover_via` is optional but strongly
 * encouraged — when present the LLM can dispatch the next tool call directly.
 */
export interface ToolError {
  ok: false;
  error: string;
  suggestion?: string;
  recover_via?: ToolRecoverVia;
  [key: string]: unknown;
}

/** Programmatic recovery hint: which tool to call next, with which params. */
export interface ToolRecoverVia {
  tool: string;
  params: Record<string, unknown>;
}

// -------------------------------------------------------------------------------------------------
// Builders
// -------------------------------------------------------------------------------------------------

/**
 * Build a successful tool envelope.
 *
 * `summaryText` is what the LLM sees first — keep it short. `details` is
 * the full structured payload.
 */
export function toolOk<T extends Record<string, unknown>>(
  details: T,
  summaryText?: string,
): ToolEnvelope<T> {
  const safeDetails = makeJsonSafe(details) as T;
  const text = summaryText ?? JSON.stringify(safeDetails, null, 2);
  return {
    content: [{ type: "text", text }],
    details: safeDetails,
  };
}

function makeJsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => makeJsonSafe(item, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const safeChild = makeJsonSafe(child, seen);
      if (safeChild !== undefined) out[key] = safeChild;
    }
    return out;
  }
  return String(value);
}

/**
 * Build a failure envelope.
 *
 * `error` is a one-line description. `suggestion` is the human-readable hint
 * (always include one). `recoverVia` lets the LLM chain a follow-up tool
 * call programmatically — include it whenever a clear next step exists.
 */
export function toolError(
  error: string,
  suggestion?: string,
  recoverVia?: ToolRecoverVia,
  extra?: Record<string, unknown>,
): ToolEnvelope<ToolError> {
  const details = makeJsonSafe({
    ok: false,
    error,
    ...(suggestion ? { suggestion } : {}),
    ...(recoverVia ? { recover_via: recoverVia } : {}),
    ...(extra ?? {}),
  }) as ToolError;
  const lines = [`❌ ${error}`];
  if (suggestion) lines.push(`Suggested fix: ${suggestion}`);
  if (recoverVia) {
    lines.push(`Recover via: ${recoverVia.tool}(${JSON.stringify(recoverVia.params)})`);
  }
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    details,
  };
}

/**
 * Resolve a tool-supplied path with workspace containment.
 *
 * Returns either a tool error envelope (when the path escapes the workspace
 * or contains literal `..` traversal) or the absolute resolved path. Tools
 * should `return` the envelope on failure and use the resolved path on
 * success.
 */
export function safeResolveToolPath(
  inputPath: string | undefined,
  cwd: string,
): { ok: true; absPath: string } | ToolEnvelope<ToolError> {
  if (!inputPath) {
    return toolError("INVALID_PARAMS", "`path` is required.");
  }
  try {
    return { ok: true, absPath: resolveToolPath(inputPath, cwd) };
  } catch (err) {
    if (err instanceof PathEscapeError) {
      return toolError(
        `INVALID_PATH: ${err.message}`,
        "Pass an absolute path or a relative path that stays inside the workspace.",
      );
    }
    throw err;
  }
}

/** Type guard for the failure branch of an envelope. */
export function isToolError(value: unknown): value is ToolError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ToolError).ok === false &&
    typeof (value as ToolError).error === "string"
  );
}
