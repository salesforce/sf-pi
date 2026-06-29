/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Upstream AgentScript navigation adapter.
 *
 * SF Pi's public tools accept explicit symbols such as `@subagent.billing`,
 * while the official language/LSP APIs operate on parsed documents, ranges,
 * and language-service state. Keep that bridging logic here so inspect and
 * mutate do not each carry their own reference/definition plumbing.
 */

import { processAgentforceDocument } from "./agentforce-document.ts";
import type { AgentScriptRange } from "./types.ts";

export interface AgentforceSymbol {
  namespace: string;
  name: string;
}

export interface AgentforceReferenceOccurrence {
  range: AgentScriptRange;
  isDefinition: boolean;
}

export interface AgentforceTextEdit {
  range: AgentScriptRange;
  newText: string;
}

export interface AgentforceDefinition {
  definitionRange: AgentScriptRange;
  fullRange?: AgentScriptRange;
}

export type ParsedAgentforceSymbol =
  { ok: true; symbol: AgentforceSymbol } | { ok: false; reason: string };

export const DECLARABLE_NAVIGATION_NAMESPACES = new Set([
  "topic",
  "subagent",
  "actions",
  "variables",
]);

export function parseAgentforceSymbol(
  raw: string,
  opts: { requireAt?: boolean } = {},
): ParsedAgentforceSymbol {
  const re = opts.requireAt ? /^@([\w-]+)\.([\w-]+)$/ : /^@?([\w-]+)\.([\w-]+)$/;
  const m = re.exec(raw);
  if (!m) {
    const expected = opts.requireAt
      ? "'@<namespace>.<property>'"
      : "'@<namespace>.<name>' or '<namespace>.<name>'";
    return {
      ok: false,
      reason: `Symbol must be of the form ${expected}, got '${raw}'.`,
    };
  }
  return { ok: true, symbol: { namespace: m[1], name: m[2] } };
}

export function formatAgentforceSymbol(symbol: AgentforceSymbol): string {
  return `@${symbol.namespace}.${symbol.name}`;
}

export function isDeclarableNavigationNamespace(namespace: string): boolean {
  return DECLARABLE_NAVIGATION_NAMESPACES.has(namespace);
}

export async function resolveAgentforceSymbol(
  source: string,
  symbol: AgentforceSymbol,
): Promise<AgentforceDefinition | null> {
  const state = await processAgentforceDocument(source);
  if (!state.ast) return null;

  const { resolveReference } = await import("@sf-agentscript/language");
  const definition = resolveReference(
    state.ast,
    symbol.namespace,
    symbol.name,
    state.service.schemaContext,
    undefined,
    state.service.getSymbols(),
  ) as {
    definitionRange?: AgentScriptRange;
    fullRange?: AgentScriptRange;
  } | null;

  return definition?.definitionRange ? (definition as AgentforceDefinition) : null;
}

export async function findAgentforceReferences(
  source: string,
  symbol: AgentforceSymbol,
  includeDeclaration = true,
): Promise<AgentforceReferenceOccurrence[]> {
  const state = await processAgentforceDocument(source);
  if (!state.ast) return [];

  const { findAllReferences } = await import("@sf-agentscript/language");
  return findAllReferences(
    state.ast,
    symbol.namespace,
    symbol.name,
    state.service.schemaContext,
    undefined,
    includeDeclaration,
    state.service.getSymbols(),
  ) as AgentforceReferenceOccurrence[];
}

export async function findAgentforceReferenceEdits(
  source: string,
  from: AgentforceSymbol,
  newText: string,
): Promise<AgentforceTextEdit[]> {
  const refs = await findAgentforceReferences(source, from, true);
  return refs.filter((ref) => !ref.isDefinition).map((ref) => ({ range: ref.range, newText }));
}
