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
  /**
   * True when `parse()` produced severity-1 diagnostics. The structural
   * surface may be incomplete — always run `agentscript_compile` first to
   * decide whether the result is trustworthy for further mutations.
   */
  has_parse_errors?: boolean;
  parse_error_count?: number;
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
  node?: {
    startRow?: number;
    parent?: { startRow?: number; type?: string };
  };
}

/**
 * Best-effort declaration line for a NamedMap entry / block. We prefer the
 * **keyword line** (e.g. `topic billing:`) over the first body line (e.g. its
 * `label:` field) because that's what humans expect when asked "where is
 * @topic.billing declared?".
 *
 * The CST stores `range.start` at the body's start line (post-keyword). The
 * `node.parent` (the enclosing mapping_element) starts at the keyword line,
 * so we walk one parent up when present.
 */
function startLine(node: unknown): number | undefined {
  const cst = (node as { __cst?: CstMetaLite } | null)?.__cst;
  const parentRow = cst?.node?.parent?.startRow;
  if (typeof parentRow === "number") return parentRow + 1;
  const cstRow = cst?.node?.startRow;
  if (typeof cstRow === "number") return cstRow + 1;
  const lspLine = cst?.range?.start?.line;
  if (typeof lspLine === "number") return lspLine + 1;
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
/**
 * Cycle-safe AST walker. Without `seen`, files whose AST nodes carry parent
 * back-references (or any object reused in multiple positions) trigger a
 * stack overflow on `inspect structure`. Empirically observed on the
 * deep-dive `agentscript.agent` example and the `090_shipping_logistics`
 * fixture from `salesforce/agentscript`.
 */
function collectAtRefs(
  node: unknown,
  refs: { actions: Set<string>; subagents: Set<string>; variables: Set<string> },
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (!node || typeof node !== "object") return;
  if (seen.has(node as object)) return;
  seen.add(node as object);
  if (Array.isArray(node)) {
    for (const child of node) collectAtRefs(child, refs, seen);
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
  // Recurse defensively. Skip __cst (huge backref tree) and parent links.
  for (const [key, child] of Object.entries(obj)) {
    if (key === "__cst" || key === "__diagnostics" || key === "parent") continue;
    collectAtRefs(child, refs, seen);
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

  // Count severity-1 diagnostics so the LLM knows whether the structural
  // result is trustworthy. Don't fail — the SDK is error-tolerant on purpose.
  let sev1Count = 0;
  for (const diag of doc.diagnostics ?? []) {
    if (((diag as { severity?: number })?.severity ?? 0) === 1) sev1Count += 1;
  }
  const hasParseErrors = sev1Count > 0;

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
    has_parse_errors: hasParseErrors,
    parse_error_count: sev1Count,
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

// -------------------------------------------------------------------------------------------------
// findReferences — walk AST expressions, collect every `@<ns>.<prop>` matching the symbol
// -------------------------------------------------------------------------------------------------

export interface ReferenceHit {
  line: number;
  character: number;
  context: string;
  is_declaration: boolean;
}

export interface FindReferencesResult {
  ok: boolean;
  reason?: "sdk_unavailable" | "read_failed" | "parse_failed" | "bad_symbol";
  reason_detail?: string;
  symbol?: string;
  references?: ReferenceHit[];
  total?: number;
}

export interface DefinitionResult {
  ok: boolean;
  reason?: "sdk_unavailable" | "read_failed" | "parse_failed" | "bad_symbol" | "not_found";
  reason_detail?: string;
  symbol?: string;
  line?: number;
  character?: number;
  file?: string;
}

function parseSymbol(
  symbol: string,
): { ok: true; namespace: string; property: string } | { ok: false; reason: string } {
  const m = /^@([\w-]+)\.([\w-]+)$/.exec(symbol);
  if (!m) {
    return {
      ok: false,
      reason: `Symbol must be of the form '@<namespace>.<property>', got '${symbol}'.`,
    };
  }
  return { ok: true, namespace: m[1], property: m[2] };
}

function namedMapKeyFor(namespace: string): string | null {
  if (
    namespace === "topic" ||
    namespace === "subagent" ||
    namespace === "actions" ||
    namespace === "variables"
  ) {
    return namespace;
  }
  return null;
}

export async function findReferences(
  filePath: string,
  symbol: string,
): Promise<FindReferencesResult> {
  const sdk = await loadAgentforceSDK();
  if (!sdk) return { ok: false, reason: "sdk_unavailable", reason_detail: getSdkLoadError() };

  const sym = parseSymbol(symbol);
  if (sym.ok === false) return { ok: false, reason: "bad_symbol", reason_detail: sym.reason };

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

  let doc: { ast: unknown };
  try {
    doc = (sdk as unknown as { parse: (s: string) => typeof doc }).parse(source);
  } catch (err) {
    return {
      ok: false,
      reason: "parse_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  const lines = source.split("\n");
  const refs: ReferenceHit[] = [];

  const walkExpressions = (
    sdk as unknown as {
      walkAstExpressions: (ast: unknown, visitor: (expr: unknown) => void) => void;
    }
  ).walkAstExpressions;

  walkExpressions(doc.ast, (expr) => {
    if (!expr || typeof expr !== "object") return;
    const node = expr as {
      __kind?: string;
      object?: unknown;
      property?: string;
      __cst?: { range?: { start?: { line?: number; character?: number } } };
    };
    if (node.__kind !== "MemberExpression") return;
    const objExpr = node.object as
      | {
          __kind?: string;
          name?: string;
          __cst?: { range?: { start?: { line?: number; character?: number } } };
        }
      | undefined;
    if (!objExpr || objExpr.__kind !== "AtIdentifier") return;
    if (objExpr.name !== sym.namespace || node.property !== sym.property) return;

    const cst = objExpr.__cst?.range?.start;
    if (!cst) return;
    const lineIdx = cst.line ?? 0;
    const charIdx = (cst.character ?? 0) > 0 ? (cst.character ?? 0) - 1 : 0;
    refs.push({
      line: lineIdx + 1,
      character: charIdx,
      context: (lines[lineIdx] ?? "").trim().slice(0, 120),
      is_declaration: false,
    });
  });

  // Add the declaration site if present in the corresponding NamedMap.
  const ast = (doc.ast ?? {}) as Record<string, unknown>;
  const mapKey = namedMapKeyFor(sym.namespace);
  if (mapKey) {
    const map = ast[mapKey];
    if (map && typeof (map as { get?: unknown }).get === "function") {
      const entry = (map as { get: (n: string) => unknown }).get(sym.property);
      if (entry) {
        const declLine = startLine(entry);
        if (typeof declLine === "number") {
          refs.unshift({
            line: declLine,
            character: 0,
            context: (lines[declLine - 1] ?? "").trim().slice(0, 120),
            is_declaration: true,
          });
        }
      }
    }
  }

  return { ok: true, symbol, references: refs, total: refs.length };
}

export async function findDefinition(filePath: string, symbol: string): Promise<DefinitionResult> {
  const sdk = await loadAgentforceSDK();
  if (!sdk) return { ok: false, reason: "sdk_unavailable", reason_detail: getSdkLoadError() };

  const sym = parseSymbol(symbol);
  if (sym.ok === false) return { ok: false, reason: "bad_symbol", reason_detail: sym.reason };

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

  let doc: { ast: unknown };
  try {
    doc = (sdk as unknown as { parse: (s: string) => typeof doc }).parse(source);
  } catch (err) {
    return {
      ok: false,
      reason: "parse_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  const ast = (doc.ast ?? {}) as Record<string, unknown>;
  const mapKey = namedMapKeyFor(sym.namespace);
  if (!mapKey) {
    return {
      ok: false,
      reason: "bad_symbol",
      reason_detail: `Namespace '${sym.namespace}' is not declarable. Supported: @topic.X, @subagent.X, @actions.X, @variables.X.`,
    };
  }
  const map = ast[mapKey];
  if (!map || typeof (map as { get?: unknown }).get !== "function") {
    return {
      ok: false,
      reason: "not_found",
      reason_detail: `Namespace '${sym.namespace}' is empty.`,
    };
  }
  const entry = (map as { get: (n: string) => unknown }).get(sym.property);
  if (!entry) {
    return { ok: false, reason: "not_found", reason_detail: `${symbol} is not declared.` };
  }
  const declLine = startLine(entry);
  if (typeof declLine !== "number") {
    return { ok: false, reason: "not_found", reason_detail: `${symbol} has no line metadata.` };
  }
  return {
    ok: true,
    symbol,
    line: declLine,
    character: 0,
    file: filePath,
  };
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
