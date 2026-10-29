/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared sObject describe access over the sf-conn boundary.
 *
 * One describe contract for every extension that grounds metadata against org
 * schema (SOQL authoring, Flow diagnostics). Callers pass an explicit
 * `SalesforceSession`; this module performs no startup work and keeps only an
 * optional caller-owned cache, so describes stay bounded and request-scoped.
 */

import { SalesforceRequestError, type SalesforceSession } from "../sf-conn/index.ts";

export type SchemaApiMode = "rest" | "tooling";

export interface SchemaPicklistValue {
  active?: boolean;
  value?: string;
  label?: string;
}

export interface SchemaFieldDescribe {
  name: string;
  label?: string;
  type?: string;
  relationshipName?: string | null;
  referenceTo?: string[];
  namePointing?: boolean;
  polymorphicForeignKey?: boolean;
  filterable?: boolean;
  groupable?: boolean;
  sortable?: boolean;
  aggregatable?: boolean;
  nillable?: boolean;
  createable?: boolean;
  updateable?: boolean;
  defaultedOnCreate?: boolean;
  calculated?: boolean;
  custom?: boolean;
  picklistValues?: SchemaPicklistValue[];
}

export interface SchemaChildRelationship {
  childSObject?: string;
  field?: string;
  relationshipName?: string | null;
}

export interface SchemaObjectDescribe {
  name: string;
  label?: string;
  queryable?: boolean;
  searchable?: boolean;
  createable?: boolean;
  updateable?: boolean;
  fields: SchemaFieldDescribe[];
  childRelationships?: SchemaChildRelationship[];
}

export function sobjectsPath(mode: SchemaApiMode): string {
  return mode === "tooling" ? "/tooling/sobjects" : "/sobjects";
}

export interface DescribeOptions {
  mode?: SchemaApiMode;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Describe one sObject; throws SalesforceRequestError for HTTP failures. */
export async function describeSObject(
  session: SalesforceSession,
  objectName: string,
  options: DescribeOptions = {},
): Promise<SchemaObjectDescribe> {
  const response = await session.request<SchemaObjectDescribe>({
    method: "GET",
    path: `${sobjectsPath(options.mode ?? "rest")}/${encodeURIComponent(objectName)}/describe`,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  if (response.status >= 400) {
    throw new SalesforceRequestError(
      response.status,
      response.path,
      response.body,
      response.target,
    );
  }
  return { ...response.body, fields: response.body.fields ?? [] };
}

/**
 * Caller-owned describe cache. A missing object resolves to `undefined` instead
 * of throwing, because "does this object exist" is itself grounding evidence.
 */
export interface SchemaCatalog {
  object(name: string): Promise<SchemaObjectDescribe | undefined>;
  readonly calls: number;
}

export function createSchemaCatalog(
  session: SalesforceSession,
  options: DescribeOptions = {},
): SchemaCatalog {
  const cache = new Map<string, Promise<SchemaObjectDescribe | undefined>>();
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    object(name) {
      const key = name.toLowerCase();
      let pending = cache.get(key);
      if (!pending) {
        calls += 1;
        pending = describeSObject(session, name, options).catch((error: unknown) => {
          if (error instanceof SalesforceRequestError && error.status === 404) return undefined;
          throw error;
        });
        cache.set(key, pending);
      }
      return pending;
    },
  };
}

/** Case-insensitive field lookup, matching Salesforce API-name semantics. */
export function findSchemaField(
  object: SchemaObjectDescribe,
  fieldName: string,
): SchemaFieldDescribe | undefined {
  const wanted = fieldName.toLowerCase();
  return object.fields.find((field) => field.name.toLowerCase() === wanted);
}

export function activePicklistValues(field: SchemaFieldDescribe): string[] {
  return (field.picklistValues ?? [])
    .filter((value) => value.active !== false && typeof value.value === "string")
    .map((value) => value.value as string);
}
