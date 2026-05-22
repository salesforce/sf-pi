/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Preview context variable helpers.
 *
 * The SFAP preview API accepts a `variables[]` state seed, but linked context
 * variables compile to `variables.<Name>` bound inputs because production
 * resolves them from channel records (VoiceCall, MessagingSession, etc.). In
 * preview there is no source record, so linked values stay empty unless the
 * compiled AgentJSON is patched to read the same test value from state.
 *
 * This module keeps that workaround in sf-pi's direct SFAP request path. We do
 * not patch the installed `sf` CLI or vendor a wrapper.
 */

export interface PreviewContextVariable {
  name: string;
  /** LLM/eval-friendly type label. Defaults to Text. */
  type?: string;
  value: string | number | boolean;
  label?: string;
  description?: string;
  isList?: boolean;
}

export interface WireContextVariable {
  name: string;
  type: string;
  value: string;
}

export interface AgentJsonWithState {
  agentVersion?: {
    stateVariables?: StateVariableDeclaration[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface StateVariableDeclaration {
  developerName?: string;
  developer_name?: string;
  label?: string;
  description?: string;
  dataType?: string;
  data_type?: string;
  isList?: boolean;
  is_list?: boolean;
  default?: unknown;
  visibility?: string;
  [key: string]: unknown;
}

export interface PreviewContextPatchResult {
  variables: WireContextVariable[];
  registeredStateVariables: number;
  rewrittenBindings: number;
}

const TYPE_TO_DATATYPE: Record<string, string> = {
  Text: "string",
  String: "string",
  Boolean: "boolean",
  Number: "number",
  Integer: "number",
  Date: "string",
  DateTime: "string",
  Id: "string",
};

/**
 * Normalize the LLM-friendly `context_variables` shape to the SFAP wire shape.
 * Values are stringified because the preview/eval wire payload treats state
 * seed values as strings and coerces server-side.
 */
export function normalizeContextVariables(
  vars: PreviewContextVariable[] | undefined,
): WireContextVariable[] {
  if (!vars || vars.length === 0) return [];
  return vars.map((v) => ({
    name: v.name,
    type: v.type ?? "Text",
    value: typeof v.value === "string" ? v.value : String(v.value),
  }));
}

/** Merge persisted start-context with per-message overrides. Later wins by name. */
export function mergeContextVariables(
  base: PreviewContextVariable[] | undefined,
  override: PreviewContextVariable[] | undefined,
): PreviewContextVariable[] | undefined {
  if ((!base || base.length === 0) && (!override || override.length === 0)) return undefined;
  const byName = new Map<string, PreviewContextVariable>();
  for (const item of base ?? []) byName.set(item.name, item);
  for (const item of override ?? []) byName.set(item.name, item);
  return Array.from(byName.values());
}

/**
 * Apply the linked-context preview patch to compiled AgentJSON.
 *
 * - Adds state variable declarations for every injected name.
 * - Rewrites string bindings from `variables.<Name>` to `state.<Name>`.
 * - Returns the normalized start `variables[]` payload for the session body.
 */
export function applyPreviewContextPatch(
  agentDefinition: AgentJsonWithState,
  vars: PreviewContextVariable[] | undefined,
): PreviewContextPatchResult {
  const variables = normalizeContextVariables(vars);
  if (!vars || vars.length === 0) {
    return { variables, registeredStateVariables: 0, rewrittenBindings: 0 };
  }

  const agentVersion = ensureAgentVersion(agentDefinition);
  const stateVariables = ensureStateVariables(agentVersion);
  const existing = new Set(
    stateVariables
      .map((s) => s.developerName ?? s.developer_name)
      .filter((name): name is string => typeof name === "string"),
  );

  let registeredStateVariables = 0;
  for (const v of vars) {
    if (existing.has(v.name)) continue;
    stateVariables.push({
      developerName: v.name,
      label: v.label || v.name,
      description: v.description || "Injected by sf-pi preview context",
      dataType: dataTypeFor(v.type),
      isList: Boolean(v.isList),
      default: v.value,
      visibility: "Internal",
    });
    existing.add(v.name);
    registeredStateVariables++;
  }

  const names = new Set(vars.map((v) => v.name));
  const rewrittenBindings = rewriteVariableBindings(agentVersion, names);
  return { variables, registeredStateVariables, rewrittenBindings };
}

function ensureAgentVersion(
  agentDefinition: AgentJsonWithState,
): NonNullable<AgentJsonWithState["agentVersion"]> {
  if (!agentDefinition.agentVersion) agentDefinition.agentVersion = {};
  return agentDefinition.agentVersion;
}

function ensureStateVariables(
  agentVersion: NonNullable<AgentJsonWithState["agentVersion"]>,
): StateVariableDeclaration[] {
  if (!Array.isArray(agentVersion.stateVariables)) agentVersion.stateVariables = [];
  return agentVersion.stateVariables;
}

function dataTypeFor(type: string | undefined): string {
  if (!type) return "string";
  return TYPE_TO_DATATYPE[type] ?? TYPE_TO_DATATYPE[capitalize(type)] ?? "string";
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function rewriteVariableBindings(root: unknown, names: Set<string>): number {
  let rewrites = 0;
  const seen = new WeakSet<object>();
  const rewrite = (value: string): string =>
    value.replace(/\bvariables\.([A-Za-z0-9_]+)\b/g, (match, name: string) => {
      if (!names.has(name)) return match;
      rewrites++;
      return `state.${name}`;
    });

  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] === "string") value[i] = rewrite(value[i]);
        else walk(value[i]);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (typeof child === "string") record[key] = rewrite(child);
      else walk(child);
    }
  };

  walk(root);
  return rewrites;
}
