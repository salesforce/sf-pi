/* SPDX-License-Identifier: Apache-2.0 */
/** Schema describe and relationship helpers for sf-soql. */

import type { Connection } from "@salesforce/core";
import { apiCall, apiVersion, describeSObject } from "./api.ts";
import { buildDigest, row, section, toolResultFromDigest } from "./digest.ts";
import type { SfSoqlParams, SObjectDescribe, SObjectFieldDescribe, ToolResult } from "./types.ts";

export async function schemaDescribe(conn: Connection, params: SfSoqlParams): Promise<ToolResult> {
  const objectName = requireObject(params);
  const describe = await describeSObject(conn, objectName);
  const commonFields = describe.fields
    .map((field) => field.name)
    .filter((name) => ["Id", "Name", "OwnerId", "CreatedDate", "LastModifiedDate"].includes(name))
    .slice(0, 6);
  const digest = buildDigest({
    action: "schema.describe",
    status: describe.queryable ? "pass" : "warning",
    icon: "🧬",
    title: `SOQL Schema · ${describe.name}`,
    org: { alias: params.target_org, api_version: apiVersion(conn) },
    meta: [
      `fields=${describe.fields.length}`,
      `relationships=${describe.childRelationships?.length ?? 0}`,
    ],
    api_calls: [
      apiCall("GET", `/sobjects/${describe.name}/describe`, `fields=${describe.fields.length}`),
    ],
    sections: [
      section("🧾", "Object Shape", [
        row("🧾", "Object", describe.name),
        row("🏷️", "Label", describe.label),
        row("✅", "Queryable", describe.queryable),
        row("🔎", "Searchable", describe.searchable),
        row("🧩", "Common Fields", commonFields.join(", ") || "—"),
      ]),
      section("🔗", "Relationships", [
        row("⬆️", "Parent refs", parentReferenceFields(describe).length),
        row(
          "⬇️",
          "Child rels",
          describe.childRelationships?.filter((rel) => rel.relationshipName).length ?? 0,
        ),
      ]),
    ],
  });
  return toolResultFromDigest(digest);
}

export async function schemaRelationships(
  conn: Connection,
  params: SfSoqlParams,
): Promise<ToolResult> {
  const objectName = requireObject(params);
  const describe = await describeSObject(conn, objectName);
  const parentRefs = parentReferenceFields(describe);
  const childRels = (describe.childRelationships ?? []).filter((rel) => rel.relationshipName);
  const digest = buildDigest({
    action: "schema.relationships",
    status: "pass",
    icon: "🔗",
    title: `SOQL Relationships · ${describe.name}`,
    org: { alias: params.target_org, api_version: apiVersion(conn) },
    meta: [`parents=${parentRefs.length}`, `children=${childRels.length}`],
    api_calls: [apiCall("GET", `/sobjects/${describe.name}/describe`, "relationships=true")],
    sections: [
      section(
        "⬆️",
        "Child-to-Parent",
        parentRefs
          .slice(0, 12)
          .map((field) =>
            row(
              "🔸",
              field.relationshipName ?? field.name,
              `${field.name} → ${summarizeList(field.referenceTo ?? [], 6)}`,
            ),
          ),
      ),
      section(
        "⬇️",
        "Parent-to-Child",
        childRels
          .slice(0, 12)
          .map((rel) => row("🔹", rel.relationshipName ?? "—", `${rel.childSObject}.${rel.field}`)),
      ),
    ],
  });
  return toolResultFromDigest(digest);
}

export function parentReferenceFields(describe: SObjectDescribe): SObjectFieldDescribe[] {
  return describe.fields.filter((field) => field.relationshipName && field.referenceTo?.length);
}

function summarizeList(values: string[], max: number): string {
  if (values.length <= max) return values.join(", ") || "—";
  return `${values.slice(0, max).join(", ")} … +${values.length - max} more`;
}

export function requireObject(params: SfSoqlParams): string {
  const objectName = params.object?.trim();
  if (!objectName) throw new Error("object is required for this sf_soql action.");
  return objectName;
}
