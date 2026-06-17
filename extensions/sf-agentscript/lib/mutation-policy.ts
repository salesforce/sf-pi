/* SPDX-License-Identifier: Apache-2.0 */
/** Schema-aware safety policy for structured Agent Script mutations. */

import { AgentforceSchemaInfo } from "@sf-agentscript/agentforce";
import type { MutateResult } from "./mutate.ts";

export interface ComponentAddress {
  kind: string;
  entryName?: string;
}

type FieldSchema = { __fieldKind?: string };
type ComponentSchema = {
  __fieldKind?: string;
  schema?: Record<string, FieldSchema>;
  propertiesSchema?: Record<string, FieldSchema>;
};

const LEGACY_ACTION_SCHEMA = schemaFor("subagent")?.schema?.actions as ComponentSchema | undefined;

export function parseComponentAddress(
  component: string,
): { ok: true; address: ComponentAddress } | { ok: false; error: MutateResult } {
  const parts = component.split(".");
  const kind = parts[0];
  if (!kind) {
    return badComponent(component, "Component path must start with a schema kind.");
  }
  if (!isAddressableKind(kind)) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "unknown_component_kind",
        reason_detail:
          `Unknown component kind '${kind}'. Supported: existing top-level Agentforce schema ` +
          `blocks and named entries with first-level scalar fields.`,
      },
    };
  }

  if (isNamedComponentKind(kind)) {
    const entryName = parts[1];
    if (!entryName || parts.length !== 2) {
      return badComponent(
        component,
        `Component '${component}' must be '<kind>.<name>' for named schema kind '${kind}'.`,
      );
    }
    return { ok: true, address: { kind, entryName } };
  }

  if (parts.length !== 1) {
    return badComponent(
      component,
      `Component '${component}' is a singular schema block and must not include an entry name.`,
    );
  }
  return { ok: true, address: { kind } };
}

export function isSchemaScalarField(component: string, field: string): boolean {
  const parsed = parseComponentAddress(component);
  if (!parsed.ok) return false;
  return fieldSchemaFor(parsed.address.kind, field)?.__fieldKind === "Primitive";
}

export function isNamedComponentKind(kind: string): boolean {
  if (kind === "actions" || kind === "variables") return true;
  return schemaFor(kind)?.__fieldKind === "Collection";
}

export function isAddressableKind(kind: string): boolean {
  return kind === "actions" || !!schemaFor(kind);
}

export function fieldSchemaFor(kind: string, field: string): FieldSchema | undefined {
  return componentFieldSchema(kind)?.[field];
}

function componentFieldSchema(kind: string): Record<string, FieldSchema> | undefined {
  if (kind === "actions") return LEGACY_ACTION_SCHEMA?.schema;
  const schema = schemaFor(kind);
  if (!schema) return undefined;
  if (schema.__fieldKind === "TypedMap") return schema.propertiesSchema;
  return schema.schema;
}

function schemaFor(kind: string): ComponentSchema | undefined {
  return (AgentforceSchemaInfo.schema as Record<string, ComponentSchema | undefined>)[kind];
}

function badComponent(component: string, reason: string): { ok: false; error: MutateResult } {
  return {
    ok: false,
    error: {
      ok: false,
      reason: "bad_component",
      reason_detail: reason,
    },
  };
}
