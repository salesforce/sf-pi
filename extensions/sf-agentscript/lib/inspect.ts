/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Structural inspection of a `.agent` file — agent-friendly navigation.
 *
 * The LLM uses this instead of re-reading the file to locate components.
 * Returns a navigable, JSON-serializable summary: dialect, config, system,
 * topics (with action + subagent references), subagents, variables, actions.
 *
 * Implementation: parse via the vendored SDK, walk the typed AST once,
 * project the fields we care about. No I/O beyond the file read.
 *
 * Never throws. Failures surface as `{ok: false, reason: ...}`.
 */

import fs from "node:fs/promises";
import { loadAgentforceSDK, getSdkLoadError } from "./sdk.ts";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

export interface InspectResult {
  ok: boolean;
  reason?: "sdk_unavailable" | "read_failed" | "parse_failed" | "has_parse_errors";
  reason_detail?: string;
  dialect?: { name: string; version?: string; unknown?: boolean };
  components?: {
    config?: Record<string, unknown>;
    system?: { instructions: string; agent_type?: string };
    topics: ComponentSummary[];
    subagents: ComponentSummary[];
    variables: VariableSummary[];
    actions: ComponentSummary[];
  };
  stats?: { topics: number; subagents: number; variables: number; actions: number };
}

export interface ComponentSummary {
  name: string;
  line?: number;
  description?: string;
  /** `@actions.X` referenced anywhere in this component. */
  action_refs?: string[];
  /** `@subagent.X` referenced anywhere in this component. */
  subagent_refs?: string[];
  /** `@variables.X` referenced anywhere in this component. */
  variable_refs?: string[];
}

export interface VariableSummary {
  name: string;
  type?: string;
  mutable?: boolean;
  line?: number;
  default?: unknown;
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

const MAX_INSTRUCTIONS_CHARS = 600;

function truncate(s: unknown, n: number): string {
  if (typeof s !== "string") return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/**
 * Extract a scalar value from a node that may be a raw primitive or a
 * vendored SDK wrapper like `_StringLiteral { value: "..." }` /
 * `_NumberLiteral { value: N }`. Returns `undefined` for non-scalar shapes.
 */
function unwrapScalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value && typeof value === "object") {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "string" || typeof inner === "number" || typeof inner === "boolean") {
      return inner;
    }
  }
  return undefined;
}

interface CstMetaLite {
  range?: { start?: { line?: number } };
  node?: { startRow?: number };
}

function startLine(node: unknown): number | undefined {
  const cst = (node as { __cst?: CstMetaLite } | null)?.__cst;
  const lspLine = cst?.range?.start?.line;
  if (typeof lspLine === "number") return lspLine + 1; // 1-based for humans
  const cstRow = cst?.node?.startRow;
  if (typeof cstRow === "number") return cstRow + 1;
  return undefined;
}

function isNamedMap(value: unknown): value is { entries: () => Iterable<[string, unknown]> } {
  return (
    !!value &&
    typeof (value as { entries?: unknown }).entries === "function" &&
    typeof (value as { size?: unknown }).size === "number"
  );
}

function namedMapEntries(value: unknown): Array<[string, unknown]> {
  if (!isNamedMap(value)) return [];
  return Array.from(value.entries());
}

/**
 * Walk an AST node, collecting `@namespace.property` references.
 *
 * Looks for `MemberExpression(object: AtIdentifier(name), property)` shape
 * — same pattern the upstream code-actions provider uses. We don't import
 * the SDK's walker; we walk plain objects and arrays defensively.
 */
function collectAtRefs(
  node: unknown,
  refs: { actions: Set<string>; subagents: Set<string>; variables: Set<string> },
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectAtRefs(child, refs);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj.__kind === "MemberExpression") {
    const objExpr = obj.object as Record<string, unknown> | undefined;
    if (objExpr && objExpr.__kind === "AtIdentifier") {
      const ns = objExpr.name;
      const prop = obj.property;
      if (typeof ns === "string" && typeof prop === "string") {
        if (ns === "actions") refs.actions.add(prop);
        else if (ns === "subagent" || ns === "topic") refs.subagents.add(prop);
        else if (ns === "variables") refs.variables.add(prop);
      }
    }
  }
  // Recurse defensively. Skip __cst (huge backref tree).
  for (const [key, child] of Object.entries(obj)) {
    if (key === "__cst" || key === "__diagnostics") continue;
    collectAtRefs(child, refs);
  }
}

function summarizeWithRefs(name: string, entry: unknown): ComponentSummary {
  const refs = {
    actions: new Set<string>(),
    subagents: new Set<string>(),
    variables: new Set<string>(),
  };
  collectAtRefs(entry, refs);
  const e = entry as Record<string, unknown>;
  const summary: ComponentSummary = { name };
  const line = startLine(entry);
  if (typeof line === "number") summary.line = line;
  const desc = unwrapScalar(e.description);
  if (typeof desc === "string") summary.description = truncate(desc, 200);
  if (refs.actions.size) summary.action_refs = Array.from(refs.actions).sort();
  if (refs.subagents.size) summary.subagent_refs = Array.from(refs.subagents).sort();
  if (refs.variables.size) summary.variable_refs = Array.from(refs.variables).sort();
  return summary;
}

function summarizeVariable(name: string, entry: unknown): VariableSummary {
  const e = entry as Record<string, unknown>;
  const summary: VariableSummary = { name };
  const line = startLine(entry);
  if (typeof line === "number") summary.line = line;
  const type = unwrapScalar(e.type);
  if (typeof type === "string") summary.type = type;
  const mutable = unwrapScalar(e.mutable);
  if (typeof mutable === "boolean") summary.mutable = mutable;
  if ("default" in e) {
    const def = unwrapScalar(e.default);
    summary.default = def !== undefined ? def : e.default;
  }
  return summary;
}

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

export async function inspectFile(filePath: string): Promise<InspectResult> {
  const sdk = await loadAgentforceSDK();
  if (!sdk) {
    return { ok: false, reason: "sdk_unavailable", reason_detail: getSdkLoadError() };
  }

  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (err) {
    return {
      ok: false,
      reason: "read_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  let doc: { ast: unknown; hasErrors: boolean; diagnostics: readonly unknown[] };
  try {
    doc = (sdk as unknown as { parse: (s: string) => typeof doc }).parse(source);
  } catch (err) {
    return {
      ok: false,
      reason: "parse_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  const dialect = resolveDialectInfo(source, sdk);
  const ast = (doc.ast ?? {}) as Record<string, unknown>;

  // Config + system are singular blocks.
  const config = extractConfigSummary(ast.config);
  const system = extractSystemSummary(ast.system);

  // Topics, subagents, actions are NamedMaps. Variables too.
  const topics = namedMapEntries(ast.topic).map(([n, e]) => summarizeWithRefs(n, e));
  const subagents = namedMapEntries(ast.subagent).map(([n, e]) => summarizeWithRefs(n, e));
  const actions = namedMapEntries(ast.actions).map(([n, e]) => summarizeWithRefs(n, e));
  const variables = namedMapEntries(ast.variables).map(([n, e]) => summarizeVariable(n, e));

  const components = {
    ...(config !== undefined ? { config } : {}),
    ...(system !== undefined ? { system } : {}),
    topics,
    subagents,
    variables,
    actions,
  };

  return {
    ok: true,
    dialect,
    components,
    stats: {
      topics: topics.length,
      subagents: subagents.length,
      variables: variables.length,
      actions: actions.length,
    },
  };
}

function extractConfigSummary(configNode: unknown): Record<string, unknown> | undefined {
  if (!configNode || typeof configNode !== "object") return undefined;
  const c = configNode as Record<string, unknown>;
  // Surface flat scalar fields. Skip CST/internal markers.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (k.startsWith("__")) continue;
    const scalar = unwrapScalar(v);
    if (scalar !== undefined) out[k] = scalar;
  }
  return Object.keys(out).length ? out : undefined;
}

function extractSystemSummary(
  systemNode: unknown,
): { instructions: string; agent_type?: string } | undefined {
  if (!systemNode || typeof systemNode !== "object") return undefined;
  const s = systemNode as Record<string, unknown>;
  const instructions = unwrapScalar(s.instructions);
  const summary: { instructions: string; agent_type?: string } = {
    instructions: truncate(instructions, MAX_INSTRUCTIONS_CHARS),
  };
  const agentType = unwrapScalar(s.agent_type);
  if (typeof agentType === "string") summary.agent_type = agentType;
  return summary;
}

function resolveDialectInfo(source: string, sdk: unknown): InspectResult["dialect"] | undefined {
  const s = sdk as {
    parseDialectAnnotation?: (src: string) => { name?: string; version?: string } | null;
    resolveDialect?: (
      src: string,
      cfg: { dialects: unknown[] },
    ) => {
      dialect?: { name?: string };
      unknownDialect?: { name?: string };
    };
    agentforceDialect?: unknown;
  };

  try {
    const ann = s.parseDialectAnnotation?.(source);
    if (ann?.name) {
      const out: { name: string; version?: string } = { name: ann.name };
      if (ann.version) out.version = ann.version;
      return out;
    }
    if (s.resolveDialect && s.agentforceDialect) {
      const r = s.resolveDialect(source, { dialects: [s.agentforceDialect] });
      if (r.unknownDialect?.name) {
        return { name: r.unknownDialect.name, unknown: true };
      }
      if (r.dialect?.name) return { name: r.dialect.name };
    }
  } catch {
    /* fall through — dialect info is best-effort */
  }
  return undefined;
}
