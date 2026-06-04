/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Structural Agent Script Inspection projection.
 *
 * This module owns the SF Pi-specific, agent-friendly summary shape over the
 * official AgentScript AST. Generic parse/lint/reference semantics stay with
 * @sf-agentscript packages; this file only projects the parsed tree into the
 * compact JSON surface agents use for navigation and planning.
 */

// Public types
// -------------------------------------------------------------------------------------------------

export interface InspectResult {
  ok: boolean;
  reason?: "sdk_unavailable" | "read_failed" | "parse_failed" | "has_parse_errors";
  reason_detail?: string;
  dialect?: { name: string; version?: string; unknown?: boolean };
  components?: {
    config?: Record<string, unknown>;
    /**
     * Note: `agent_type` is a `config:` field per the SDK schema (see
     * official SDK package around the AgentforceConfigSchema definition).
     * Earlier versions of this summary mirrored it onto `system` too,
     * which was a stale model — readers should use `config.agent_type`.
     */
    system?: { instructions: string };
    start_agents?: ComponentSummary[];
    topics: ComponentSummary[];
    subagents: ComponentSummary[];
    variables: VariableSummary[];
    actions: ComponentSummary[];
    connections?: ConnectionSummary[];
    modalities?: ModalitySummary[];
  };
  stats?: {
    start_agents?: number;
    topics: number;
    subagents: number;
    variables: number;
    actions: number;
    connections?: number;
    modalities?: number;
  };
  /**
   * True when `parse()` produced severity-1 diagnostics. The structural
   * surface may be incomplete — always run `agentscript_authoring compile/check` first to
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
  /** `@response_formats.X` / `@response_actions.X` references in this component. */
  response_format_refs?: string[];
  /** `@utils.X` references such as `@utils.end_session`. */
  utility_refs?: string[];
  /**
   * For action declarations only: the raw `target:` URI (e.g. `flow://X`,
   * `apex://X`, `generatePromptResponse://X`). Empty for topics/subagents.
   * Consumers can split on `://` to get scheme + name.
   */
  target?: string;
  /** Action declaration input names, when present. */
  input_names?: string[];
  /** Action declaration output names, when present. */
  output_names?: string[];
  /**
   * For action declarations only: the parent component when the action is
   * inline-declared inside a subagent or topic body (e.g. `subagent.triage`).
   * Empty for actions declared at the top level.
   */
  parent?: string;
}

export interface VariableSummary {
  name: string;
  type?: string;
  modifier?: "mutable" | "linked" | string;
  mutable?: boolean;
  linked?: boolean;
  line?: number;
  default?: unknown;
  source?: string;
  source_namespace?: string;
  source_field?: string;
  visibility?: string;
  is_displayable?: boolean;
  is_used_by_planner?: boolean;
}

export interface ConnectionSummary extends ComponentSummary {
  input_names?: string[];
  response_formats?: ResponseFormatSummary[];
  response_actions?: string[];
}

export interface ResponseFormatSummary {
  name: string;
  line?: number;
  source?: string;
  target?: string;
  input_names?: string[];
  description?: string;
}

export interface ModalitySummary {
  name: string;
  line?: number;
  fields?: Record<string, unknown>;
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

const MAX_INSTRUCTIONS_CHARS = 600;

type WalkAstExpressions = (
  value: unknown,
  callback: (expr: { __kind?: string; object?: unknown; property?: unknown }) => void,
) => void;

type DecomposeAtMemberExpression = (
  expr: unknown,
) => { namespace: string; property: string } | null;

function truncate(s: unknown, n: number): string {
  if (typeof s !== "string") return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/**
 * Extract a scalar value from a node that may be a raw primitive or a
 * official SDK package wrapper like `_StringLiteral { value: "..." }` /
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

function expressionName(value: unknown): string | undefined {
  const scalar = unwrapScalar(value);
  if (typeof scalar === "string") return scalar;
  if (value && typeof value === "object") {
    const obj = value as { name?: unknown; __kind?: unknown };
    if (typeof obj.name === "string") return obj.name;
  }
  return undefined;
}

function memberRef(
  value: unknown,
  decomposeAtMemberExpression: DecomposeAtMemberExpression,
): { text: string; namespace: string; property: string } | undefined {
  const ref = decomposeAtMemberExpression(value);
  if (!ref) return undefined;
  return {
    text: `@${ref.namespace}.${ref.property}`,
    namespace: ref.namespace,
    property: ref.property,
  };
}

function childProps(entry: Record<string, unknown>): Record<string, unknown> {
  const props = entry.properties;
  return props && typeof props === "object" ? (props as Record<string, unknown>) : entry;
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
  refs: {
    actions: Set<string>;
    subagents: Set<string>;
    variables: Set<string>;
    responseFormats: Set<string>;
    utilities: Set<string>;
  },
  walkAstExpressions: WalkAstExpressions,
  decomposeAtMemberExpression: DecomposeAtMemberExpression,
): void {
  walkAstExpressions(node, (expr) => {
    const ref = memberRef(expr, decomposeAtMemberExpression);
    if (!ref) return;
    if (ref.namespace === "actions") refs.actions.add(ref.property);
    else if (ref.namespace === "subagent" || ref.namespace === "topic") {
      refs.subagents.add(ref.property);
    } else if (ref.namespace === "variables") refs.variables.add(ref.property);
    else if (ref.namespace === "response_formats" || ref.namespace === "response_actions") {
      refs.responseFormats.add(ref.property);
    } else if (ref.namespace === "utils") refs.utilities.add(ref.property);
  });
}

function paramNames(value: unknown): string[] | undefined {
  const names = namedMapEntries(value)
    .map(([n]) => n)
    .sort();
  return names.length > 0 ? names : undefined;
}

function summarizeWithRefs(
  name: string,
  entry: unknown,
  walkAstExpressions: WalkAstExpressions,
  decomposeAtMemberExpression: DecomposeAtMemberExpression,
): ComponentSummary {
  const refs = {
    actions: new Set<string>(),
    subagents: new Set<string>(),
    variables: new Set<string>(),
    responseFormats: new Set<string>(),
    utilities: new Set<string>(),
  };
  collectAtRefs(entry, refs, walkAstExpressions, decomposeAtMemberExpression);
  const e = entry as Record<string, unknown>;
  const summary: ComponentSummary = { name };
  const line = startLine(entry);
  if (typeof line === "number") summary.line = line;
  const desc = unwrapScalar(e.description);
  if (typeof desc === "string") summary.description = truncate(desc, 200);
  if (refs.actions.size) summary.action_refs = Array.from(refs.actions).sort();
  if (refs.subagents.size) summary.subagent_refs = Array.from(refs.subagents).sort();
  if (refs.variables.size) summary.variable_refs = Array.from(refs.variables).sort();
  if (refs.responseFormats.size) {
    summary.response_format_refs = Array.from(refs.responseFormats).sort();
  }
  if (refs.utilities.size) summary.utility_refs = Array.from(refs.utilities).sort();
  // Action declarations carry a `target:` URI — surface it so downstream
  // consumers (publish pre-flight, doctor checks) can validate without
  // re-parsing the AST.
  const target = unwrapScalar(e.target);
  if (typeof target === "string" && target.length > 0) summary.target = target;
  const inputNames = paramNames(e.inputs);
  if (inputNames) summary.input_names = inputNames;
  const outputNames = paramNames(e.outputs);
  if (outputNames) summary.output_names = outputNames;
  return summary;
}

function summarizeVariable(
  name: string,
  entry: unknown,
  decomposeAtMemberExpression: DecomposeAtMemberExpression,
): VariableSummary {
  const e = entry as Record<string, unknown>;
  const props = childProps(e);
  const summary: VariableSummary = { name };
  const line = startLine(entry);
  if (typeof line === "number") summary.line = line;

  const type = expressionName(e.type);
  if (typeof type === "string") summary.type = type;

  const modifier = expressionName(e.modifier);
  if (modifier) {
    summary.modifier = modifier;
    if (modifier === "mutable") summary.mutable = true;
    if (modifier === "linked") summary.linked = true;
  }

  if ("default" in e || "defaultValue" in e) {
    const rawDefault = e.default ?? e.defaultValue;
    const def = unwrapScalar(rawDefault);
    summary.default = def !== undefined ? def : rawDefault;
  }

  const source = memberRef(props.source, decomposeAtMemberExpression);
  if (source) {
    summary.source = source.text;
    summary.source_namespace = source.namespace;
    summary.source_field = source.property;
  }
  const visibility = unwrapScalar(props.visibility);
  if (typeof visibility === "string") summary.visibility = visibility;
  const isDisplayable = unwrapScalar(props.is_displayable);
  if (typeof isDisplayable === "boolean") summary.is_displayable = isDisplayable;
  const isUsedByPlanner = unwrapScalar(props.is_used_by_planner);
  if (typeof isUsedByPlanner === "boolean") summary.is_used_by_planner = isUsedByPlanner;

  return summary;
}

function summarizeConnection(
  name: string,
  entry: unknown,
  walkAstExpressions: WalkAstExpressions,
  decomposeAtMemberExpression: DecomposeAtMemberExpression,
): ConnectionSummary {
  const summary = summarizeWithRefs(
    name,
    entry,
    walkAstExpressions,
    decomposeAtMemberExpression,
  ) as ConnectionSummary;
  const e = entry as Record<string, unknown>;
  const inputNames = paramNames(e.inputs);
  if (inputNames) summary.input_names = inputNames;

  const responseFormats = namedMapEntries(e.response_formats).map(([n, v]) =>
    summarizeResponseFormat(n, v),
  );
  if (responseFormats.length > 0) summary.response_formats = responseFormats;

  const responseActions = namedMapEntries(
    (e.reasoning as Record<string, unknown> | undefined)?.response_actions,
  )
    .map(([n]) => n)
    .sort();
  if (responseActions.length > 0) summary.response_actions = responseActions;
  return summary;
}

function summarizeResponseFormat(name: string, entry: unknown): ResponseFormatSummary {
  const e = entry as Record<string, unknown>;
  const out: ResponseFormatSummary = { name };
  const line = startLine(entry);
  if (typeof line === "number") out.line = line;
  const desc = unwrapScalar(e.description);
  if (typeof desc === "string") out.description = truncate(desc, 200);
  const source = unwrapScalar(e.source);
  if (typeof source === "string") out.source = source;
  const target = unwrapScalar(e.target);
  if (typeof target === "string") out.target = target;
  const inputNames = paramNames(e.inputs);
  if (inputNames) out.input_names = inputNames;
  return out;
}

function summarizeModality(name: string, entry: unknown): ModalitySummary {
  const e = entry as Record<string, unknown>;
  const out: ModalitySummary = { name };
  const line = startLine(entry);
  if (typeof line === "number") out.line = line;
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(e)) {
    if (key.startsWith("__")) continue;
    const scalar = unwrapScalar(value);
    if (scalar !== undefined) fields[key] = scalar;
  }
  if (Object.keys(fields).length > 0) out.fields = fields;
  return out;
}

// -------------------------------------------------------------------------------------------------

export function projectInspectStructure(input: {
  ast: unknown;
  dialect?: InspectResult["dialect"];
  hasParseErrors: boolean;
  parseErrorCount: number;
  walkAstExpressions: WalkAstExpressions;
  decomposeAtMemberExpression: DecomposeAtMemberExpression;
}): InspectResult {
  const ast = (input.ast ?? {}) as Record<string, unknown>;

  // Config + system are singular blocks.
  const config = extractConfigSummary(ast.config);
  const system = extractSystemSummary(ast.system);

  // Topics, subagents, actions are NamedMaps. Variables too.
  const startAgents = namedMapEntries(ast.start_agent).map(([n, e]) =>
    summarizeWithRefs(n, e, input.walkAstExpressions, input.decomposeAtMemberExpression),
  );
  const topics = namedMapEntries(ast.topic).map(([n, e]) =>
    summarizeWithRefs(n, e, input.walkAstExpressions, input.decomposeAtMemberExpression),
  );
  const subagents = namedMapEntries(ast.subagent).map(([n, e]) =>
    summarizeWithRefs(n, e, input.walkAstExpressions, input.decomposeAtMemberExpression),
  );
  // Top-level `actions:` block.
  const topLevelActions = namedMapEntries(ast.actions).map(([n, e]) =>
    summarizeWithRefs(n, e, input.walkAstExpressions, input.decomposeAtMemberExpression),
  );
  // Inline action declarations inside `start_agent.<X>.actions:`,
  // `subagent.<X>.actions:`, and `topic.<X>.actions:`. Many real-world agents
  // (and most recipes) put their action declarations inline; if we only walked
  // the top-level block we'd miss every `target:` in the file. Each inline
  // action gets its parent component recorded so downstream consumers (publish
  // pre-flight, check_targets) can attribute it back to the source block.
  const inlineActions: ComponentSummary[] = [];
  for (const [parentName, entry] of namedMapEntries(ast.start_agent)) {
    const inner = (entry as { actions?: unknown }).actions;
    for (const [aName, aEntry] of namedMapEntries(inner)) {
      const summary = summarizeWithRefs(
        aName,
        aEntry,
        input.walkAstExpressions,
        input.decomposeAtMemberExpression,
      );
      summary.parent = `start_agent.${parentName}`;
      inlineActions.push(summary);
    }
  }
  for (const [parentName, entry] of namedMapEntries(ast.subagent)) {
    const inner = (entry as { actions?: unknown }).actions;
    for (const [aName, aEntry] of namedMapEntries(inner)) {
      const summary = summarizeWithRefs(
        aName,
        aEntry,
        input.walkAstExpressions,
        input.decomposeAtMemberExpression,
      );
      summary.parent = `subagent.${parentName}`;
      inlineActions.push(summary);
    }
  }
  for (const [parentName, entry] of namedMapEntries(ast.topic)) {
    const inner = (entry as { actions?: unknown }).actions;
    for (const [aName, aEntry] of namedMapEntries(inner)) {
      const summary = summarizeWithRefs(
        aName,
        aEntry,
        input.walkAstExpressions,
        input.decomposeAtMemberExpression,
      );
      summary.parent = `topic.${parentName}`;
      inlineActions.push(summary);
    }
  }
  const actions = [...topLevelActions, ...inlineActions];
  const variables = namedMapEntries(ast.variables).map(([n, e]) =>
    summarizeVariable(n, e, input.decomposeAtMemberExpression),
  );
  const connections = namedMapEntries(ast.connection).map(([n, e]) =>
    summarizeConnection(n, e, input.walkAstExpressions, input.decomposeAtMemberExpression),
  );
  const modalities = namedMapEntries(ast.modality).map(([n, e]) => summarizeModality(n, e));

  const components = {
    ...(config !== undefined ? { config } : {}),
    ...(system !== undefined ? { system } : {}),
    ...(startAgents.length > 0 ? { start_agents: startAgents } : {}),
    topics,
    subagents,
    variables,
    actions,
    ...(connections.length > 0 ? { connections } : {}),
    ...(modalities.length > 0 ? { modalities } : {}),
  };

  return {
    ok: true,
    dialect: input.dialect,
    components,
    stats: {
      start_agents: startAgents.length,
      topics: topics.length,
      subagents: subagents.length,
      variables: variables.length,
      actions: actions.length,
      connections: connections.length,
      modalities: modalities.length,
    },
    has_parse_errors: input.hasParseErrors,
    parse_error_count: input.parseErrorCount,
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

function extractSystemSummary(systemNode: unknown): { instructions: string } | undefined {
  if (!systemNode || typeof systemNode !== "object") return undefined;
  const s = systemNode as Record<string, unknown>;
  const instructions = unwrapScalar(s.instructions);
  return {
    instructions: truncate(instructions, MAX_INSTRUCTIONS_CHARS),
  };
  // agent_type used to be mirrored here but it lives on the `config:`
  // block per the SDK schema. extractConfigSummary already surfaces it
  // via the generic scalar-walk; consumers should read it from
  // `summary.config.agent_type` (or use readAgentConfigSlice for a
  // typed slice).
}

// -------------------------------------------------------------------------------------------------
