/* SPDX-License-Identifier: Apache-2.0 */
/** Salesforce FIELDS() expansion rules that depend on query shape and describe metadata. */

import { finding } from "./digest.ts";
import type { SObjectDescribe, SoqlFinding, SoqlQueryShape } from "./types.ts";

export function validateFieldExpansions(
  describe: SObjectDescribe,
  shape: SoqlQueryShape,
): SoqlFinding[] {
  const expansions = shape.field_expansions ?? [];
  if (!expansions.length) return [];
  const findings: SoqlFinding[] = [];
  const unique = new Set(expansions);
  if (expansions.length !== unique.size || unique.size > 1) {
    findings.push(
      finding("error", "❌", "FIELDS", "A query cannot combine overlapping FIELDS() expansions."),
    );
  }

  const hasAggregateOrGrouping = Boolean(
    shape.aggregate_fields?.length ||
    shape.group_by_fields?.length ||
    shape.having_fields?.length ||
    shape.function_fields?.some(
      (reference) => reference.context === "group_by" || reference.context === "having",
    ),
  );
  if (hasAggregateOrGrouping) {
    findings.push(
      finding(
        "error",
        "❌",
        "FIELDS Aggregate",
        "FIELDS() cannot be combined with aggregate or grouping clauses in this validation path.",
      ),
    );
  }

  const unbounded = expansions.filter((expansion) => expansion === "ALL" || expansion === "CUSTOM");
  if (unbounded.length) {
    if (shape.syntax_context === "apex") {
      findings.push(
        finding(
          "error",
          "❌",
          "FIELDS Apex",
          `FIELDS(${unbounded[0]}) is unbounded and is not supported in Apex SOQL.`,
        ),
      );
    } else if (!isFieldsQueryBounded(shape)) {
      findings.push(
        finding(
          "error",
          "❌",
          "FIELDS Limit",
          `FIELDS(${unbounded[0]}) requires LIMIT 200 or less, or a documented Id bound.`,
        ),
      );
    }
  }

  const explicitFields = (shape.selected_fields ?? []).filter(
    (field) => field.kind === "field" && field.field && !field.field.includes("."),
  );
  for (const expansion of unique) {
    const duplicates = explicitFields.filter((selected) => {
      const field = describe.fields.find(
        (candidate) => candidate.name.toLowerCase() === selected.field?.toLowerCase(),
      );
      if (!field) return false;
      if (expansion === "ALL") return true;
      if (expansion === "CUSTOM") return field.custom === true;
      return field.custom === false;
    });
    if (duplicates.length) {
      findings.push(
        finding(
          "error",
          "❌",
          "FIELDS Duplicate",
          `FIELDS(${expansion}) duplicates explicitly selected fields: ${duplicates
            .map((field) => field.field)
            .join(", ")}.`,
        ),
      );
    }
  }

  if (
    unique.has("CUSTOM") &&
    explicitFields.length === 0 &&
    describe.fields.length > 0 &&
    describe.fields.every((field) => field.custom === false)
  ) {
    findings.push(
      finding(
        "error",
        "❌",
        "FIELDS Custom",
        `${describe.name} has no custom fields, so FIELDS(CUSTOM) expands to an empty field list.`,
      ),
    );
  }
  return findings;
}

function isFieldsQueryBounded(shape: SoqlQueryShape): boolean {
  if (shape.limit !== undefined && shape.limit <= 200) return true;
  const where = shape.where_clause?.trim();
  if (!where) return false;
  const idList = /^Id\s+IN\s*\((.*)\)$/i.exec(where)?.[1];
  if (idList !== undefined) {
    const values = idList.split(",").map((value) => value.trim());
    return (
      values.length > 0 &&
      values.length <= 200 &&
      values.every((value) => /^'(?:\\'|[^'])*'$/.test(value))
    );
  }
  const tests = where.split(/\s+(?:AND|OR)\s+/i).map((value) => value.replace(/[()]/g, "").trim());
  return (
    tests.length > 0 &&
    tests.length <= 200 &&
    tests.every((value) => /^Id\s*=\s*'(?:\\'|[^'])*'$/i.test(value))
  );
}
