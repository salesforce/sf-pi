/* SPDX-License-Identifier: Apache-2.0 */
/** Query-shape semantic rules that don't require org describe metadata. */

import { finding } from "./digest.ts";
import type { SoqlFinding, SoqlQueryShape } from "./types.ts";

const DATE_FUNCTION =
  "CALENDAR_MONTH|CALENDAR_QUARTER|CALENDAR_YEAR|DAY_IN_MONTH|DAY_IN_WEEK|DAY_IN_YEAR|DAY_ONLY|FISCAL_MONTH|FISCAL_QUARTER|FISCAL_YEAR|HOUR_IN_DAY|WEEK_IN_MONTH|WEEK_IN_YEAR";
const DATE_LITERAL =
  "YESTERDAY|TODAY|TOMORROW|LAST_WEEK|THIS_WEEK|NEXT_WEEK|LAST_MONTH|THIS_MONTH|NEXT_MONTH|LAST_90_DAYS|NEXT_90_DAYS|THIS_QUARTER|LAST_QUARTER|NEXT_QUARTER|THIS_YEAR|LAST_YEAR|NEXT_YEAR|THIS_FISCAL_QUARTER|LAST_FISCAL_QUARTER|NEXT_FISCAL_QUARTER|THIS_FISCAL_YEAR|LAST_FISCAL_YEAR|NEXT_FISCAL_YEAR|(?:NEXT|LAST|N)_[A-Z_]+:\\d+";

export function validateQuerySemantics(shape: SoqlQueryShape): SoqlFinding[] {
  const findings: SoqlFinding[] = [];
  const hasGrouping = Boolean(
    shape.group_by_fields?.length ||
    shape.function_fields?.some((reference) => reference.context === "group_by"),
  );

  if (shape.aggregate_fields?.length && shape.limit !== undefined && !hasGrouping) {
    findings.push(
      finding(
        "error",
        "❌",
        "Aggregate Limit",
        "Aggregate queries without GROUP BY cannot use LIMIT.",
      ),
    );
  }

  const standaloneTimezone = (shape.selected_fields ?? []).some(
    (field) => field.kind === "function" && /^CONVERTTIMEZONE\s*\(/i.test(field.raw),
  );
  if (standaloneTimezone) {
    findings.push(
      finding(
        "error",
        "❌",
        "convertTimezone",
        "convertTimezone() must be nested inside a date function.",
      ),
    );
  }

  const dateLiteralComparison = new RegExp(
    `\\b(?:${DATE_FUNCTION})\\s*\\([^)]*\\)\\s*(?:=|!=|<>|<=|>=|<|>)\\s*(?:${DATE_LITERAL})\\b`,
    "i",
  );
  if (shape.where_clause && dateLiteralComparison.test(shape.where_clause)) {
    findings.push(
      finding(
        "error",
        "❌",
        "Date Function Literal",
        "A date-function result cannot be compared with a date literal.",
      ),
    );
  }

  const selectedDateFunctions = (shape.function_fields ?? []).filter(
    (reference) => reference.context === "select" && DATE_FUNCTION_NAMES.has(reference.function),
  );
  for (const selected of selectedDateFunctions) {
    const groupedByFunction = shape.function_fields?.some(
      (reference) =>
        reference.context === "group_by" &&
        reference.function === selected.function &&
        reference.field.toLowerCase() === selected.field.toLowerCase(),
    );
    const groupedByField = shape.group_by_fields?.some(
      (field) => field.toLowerCase() === selected.field.toLowerCase(),
    );
    if (groupedByFunction || groupedByField) continue;
    findings.push(
      finding(
        "error",
        "❌",
        "Date Function Grouping",
        `${selected.function}(${selected.field}) in SELECT must also be grouped.`,
      ),
    );
  }
  return findings;
}

const DATE_FUNCTION_NAMES = new Set(DATE_FUNCTION.split("|"));
