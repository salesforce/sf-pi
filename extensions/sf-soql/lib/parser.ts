/* SPDX-License-Identifier: Apache-2.0 */
/** SOQL parsing, comment extraction, and safe query normalization. */

import { createRequire } from "node:module";
import type {
  parseHeaderComments as parseHeaderCommentsType,
  SOQLParser as SOQLParserType,
} from "@salesforce/soql-common";
import type { SoqlQueryShape } from "./types.ts";

const require = createRequire(import.meta.url);
const { parseHeaderComments, SOQLParser } = require("@salesforce/soql-common") as {
  parseHeaderComments: typeof parseHeaderCommentsType;
  SOQLParser: typeof SOQLParserType;
};

const TRAILING_ALL_ROWS = /\s+ALL\s+ROWS\s*;?\s*$/i;

export function parseSoql(rawQuery: string): SoqlQueryShape {
  const raw = rawQuery.trim();
  const parsedComments = parseHeaderComments(raw);
  const { soql, allRows } = stripAllRows(parsedComments.soqlText.trim().replace(/;\s*$/, ""));
  const syntaxErrors = validateSyntax(soql);
  const shape = parseShape(soql);
  return {
    raw,
    normalized: soql,
    operation: allRows ? "queryAll" : "query",
    all_rows: allRows,
    header_comments: parsedComments.headerComments?.trim() || undefined,
    syntax_errors: syntaxErrors.length ? syntaxErrors : undefined,
    ...shape,
  };
}

export function stripAllRows(soql: string): { soql: string; allRows: boolean } {
  const allRows = TRAILING_ALL_ROWS.test(soql);
  return { soql: soql.replace(TRAILING_ALL_ROWS, "").trim(), allRows };
}

export function hasTopLevelLimit(query: string): boolean {
  return topLevelKeywordValue(query, "LIMIT") !== undefined;
}

export function readTopLevelLimit(query: string): number | undefined {
  const value = topLevelKeywordValue(query, "LIMIT");
  if (!value) return undefined;
  const match = /^(\d+)/.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

export function withLimit(query: string, limit: number): string {
  const current = readTopLevelLimit(query);
  if (current !== undefined)
    return query.replace(/\bLIMIT\s+\d+\b/i, `LIMIT ${Math.min(current, limit)}`);
  return `${query.trim()} LIMIT ${limit}`;
}

export function isAggregateOrCount(query: string): boolean {
  const select = topLevelSelectClause(query).toLowerCase();
  return select.includes("count(") || /\b(sum|avg|min|max)\s*\(/i.test(select);
}

export function toCountQuery(query: string): string {
  const fromIndex = findTopLevelKeyword(query, "FROM");
  if (fromIndex < 0) return query;
  let tail = query.slice(fromIndex);
  const stopKeywords = ["ORDER BY", "LIMIT", "OFFSET", "FOR", "UPDATE"];
  let stop = tail.length;
  for (const keyword of stopKeywords) {
    const idx = findTopLevelKeyword(tail, keyword);
    if (idx > 0 && idx < stop) stop = idx;
  }
  tail = tail.slice(0, stop).trim();
  return `SELECT COUNT() ${tail}`;
}

function validateSyntax(query: string): SoqlQueryShape["syntax_errors"] {
  try {
    const parser = SOQLParser({ isApex: true, isMultiCurrencyEnabled: true, apiVersion: 67.0 });
    const result = parser.parseQuery(query);
    return result.getParserErrors().map((err) => ({
      line: err.getLineNumber(),
      column: err.getCharacterPositionInLine(),
      message: err.getMessage(),
    }));
  } catch (err) {
    return [{ line: 0, column: 0, message: err instanceof Error ? err.message : String(err) }];
  }
}

function parseShape(query: string): Partial<SoqlQueryShape> {
  const selectClause = topLevelSelectClause(query);
  const fields = splitTopLevel(selectClause)
    .map((field) => field.trim())
    .filter(Boolean);
  const fromIndex = findTopLevelKeyword(query, "FROM");
  const primaryObject =
    fromIndex >= 0 ? readIdentifier(query.slice(fromIndex + 4).trim()) : undefined;
  const subqueries = fields
    .filter((field) => /^\(\s*SELECT\b/i.test(field))
    .map(parseSubquery)
    .filter((value): value is { relationship: string; fields: string[] } => Boolean(value));
  const normalFields = fields.filter((field) => !/^\(\s*SELECT\b/i.test(field));
  const whereClause = topLevelClause(query, "WHERE", [
    "GROUP BY",
    "HAVING",
    "ORDER BY",
    "LIMIT",
    "OFFSET",
    "FOR",
    "UPDATE",
  ]);
  const orderByClause = topLevelClause(query, "ORDER BY", ["LIMIT", "OFFSET", "FOR", "UPDATE"]);
  const groupByClause = topLevelClause(query, "GROUP BY", [
    "HAVING",
    "ORDER BY",
    "LIMIT",
    "OFFSET",
    "FOR",
    "UPDATE",
  ]);
  const havingClause = topLevelClause(query, "HAVING", [
    "ORDER BY",
    "LIMIT",
    "OFFSET",
    "FOR",
    "UPDATE",
  ]);
  const aliases = extractAliases(normalFields);
  return {
    primary_object: primaryObject,
    fields: normalFields,
    relationships: normalFields
      .filter((field) => field.includes("."))
      .map((field) => field.split(".")[0]),
    subqueries,
    where_fields: whereClause ? extractWhereFields(whereClause) : [],
    order_by_fields: orderByClause ? extractOrderByFields(orderByClause) : [],
    group_by_fields: groupByClause ? extractGroupByFields(groupByClause) : [],
    having_fields: havingClause ? extractHavingFields(havingClause) : [],
    aliases,
    bind_variables: extractBindVariables(query),
    type_of_fields: normalFields.filter((field) => /^TYPEOF\b/i.test(field)),
    aggregate_fields: extractAggregateFields(normalFields),
    literal_filters: whereClause ? extractLiteralFilters(whereClause) : [],
    limit: readTopLevelLimit(query),
  };
}

function parseSubquery(field: string): { relationship: string; fields: string[] } | undefined {
  const inner = field.trim().replace(/^\(/, "").replace(/\)$/, "");
  const select = topLevelSelectClause(inner);
  const fromIndex = findTopLevelKeyword(inner, "FROM");
  const relationship =
    fromIndex >= 0 ? readIdentifier(inner.slice(fromIndex + 4).trim()) : undefined;
  if (!relationship) return undefined;
  return {
    relationship,
    fields: splitTopLevel(select)
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function topLevelSelectClause(query: string): string {
  const selectIndex = findTopLevelKeyword(query, "SELECT");
  const fromIndex = findTopLevelKeyword(query, "FROM");
  if (selectIndex < 0 || fromIndex < 0 || fromIndex <= selectIndex) return "";
  return query.slice(selectIndex + 6, fromIndex).trim();
}

function topLevelKeywordValue(query: string, keyword: string): string | undefined {
  const idx = findTopLevelKeyword(query, keyword);
  if (idx < 0) return undefined;
  return query.slice(idx + keyword.length).trim();
}

function topLevelClause(
  query: string,
  keyword: string,
  stopKeywords: string[],
): string | undefined {
  const idx = findTopLevelKeyword(query, keyword);
  if (idx < 0) return undefined;
  const start = idx + keyword.length;
  let end = query.length;
  const tail = query.slice(start);
  for (const stopKeyword of stopKeywords) {
    const stop = findTopLevelKeyword(tail, stopKeyword);
    if (stop >= 0 && stop < end - start) end = start + stop;
  }
  return query.slice(start, end).trim() || undefined;
}

function extractWhereFields(whereClause: string): string[] {
  const fields = new Set<string>();
  const re =
    /\b([a-zA-Z_][\w.]*)\s*(=|!=|<>|<=|>=|<|>|LIKE\b|IN\b|NOT\s+IN\b|INCLUDES\b|EXCLUDES\b)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(whereClause))) fields.add(match[1]);
  return [...fields];
}

function extractHavingFields(havingClause: string): string[] {
  const fields = new Set<string>();
  for (const aggregate of extractAggregateFields([havingClause])) {
    if (aggregate.field) fields.add(aggregate.field);
  }
  for (const field of extractWhereFields(havingClause)) fields.add(field);
  return [...fields];
}

function extractBindVariables(query: string): string[] {
  const variables = new Set<string>();
  const re = /:([a-zA-Z_][\w.]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(query))) variables.add(match[1]);
  return [...variables];
}

function extractAliases(fields: string[]): string[] {
  return fields
    .filter((field) => !/^TYPEOF\b/i.test(field))
    .map((field) => /\s+([a-zA-Z_][\w]*)\s*$/i.exec(field)?.[1])
    .filter((alias): alias is string => Boolean(alias))
    .filter((alias) => !SOQL_KEYWORDS.has(alias.toUpperCase()));
}

const SOQL_KEYWORDS = new Set([
  "ASC",
  "DESC",
  "NULLS",
  "FIRST",
  "LAST",
  "FROM",
  "WHERE",
  "GROUP",
  "ORDER",
  "LIMIT",
]);

function extractLiteralFilters(
  whereClause: string,
): Array<{ field: string; operator: string; value: string }> {
  const filters: Array<{ field: string; operator: string; value: string }> = [];
  const re = /\b([a-zA-Z_][\w.]*)\s*(=|!=|<>|LIKE\b)\s*'((?:\\'|[^'])*)'/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(whereClause))) {
    filters.push({
      field: match[1],
      operator: match[2].toUpperCase(),
      value: match[3].replace(/\\'/g, "'"),
    });
  }
  return filters;
}

function extractOrderByFields(orderByClause: string): string[] {
  return splitTopLevel(orderByClause)
    .map((part) => readIdentifier(part.trim()))
    .filter((value): value is string => Boolean(value));
}

function extractGroupByFields(groupByClause: string): string[] {
  const normalized = groupByClause
    .replace(/^ROLLUP\s*\((.*)\)$/i, "$1")
    .replace(/^CUBE\s*\((.*)\)$/i, "$1");
  return splitTopLevel(normalized)
    .map((part) => readIdentifier(part.trim()))
    .filter((value): value is string => Boolean(value));
}

function extractAggregateFields(fields: string[]): Array<{ fn: string; field?: string }> {
  return fields.flatMap((field) => {
    const aggregates: Array<{ fn: string; field?: string }> = [];
    const re = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*([a-zA-Z_][\w.]*)?\s*\)/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(field)))
      aggregates.push({ fn: match[1].toUpperCase(), field: match[2] });
    return aggregates;
  });
}

function readIdentifier(value: string): string | undefined {
  return /^[a-zA-Z_][\w.]*/.exec(value)?.[0];
}

export function findTopLevelKeyword(query: string, keyword: string): number {
  const upperKeyword = keyword.toUpperCase();
  let depth = 0;
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    const prev = query[i - 1];
    if (quote) {
      if (ch === quote && prev !== "\\") quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;
    if (query.slice(i, i + upperKeyword.length).toUpperCase() !== upperKeyword) continue;
    const before = i === 0 ? " " : query[i - 1];
    const after = query[i + upperKeyword.length] ?? " ";
    if (/[^a-zA-Z0-9_]/.test(before) && /[^a-zA-Z0-9_]/.test(after)) return i;
  }
  return -1;
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let typeOfDepth = 0;
  let quote: "'" | '"' | undefined;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const prev = value[i - 1];
    if (quote) {
      if (ch === quote && prev !== "\\") quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (matchesKeywordAt(value, i, "TYPEOF")) {
      typeOfDepth++;
      i += "TYPEOF".length - 1;
      continue;
    }
    if (typeOfDepth > 0 && matchesKeywordAt(value, i, "END")) {
      typeOfDepth--;
      i += "END".length - 1;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0 && typeOfDepth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function matchesKeywordAt(value: string, index: number, keyword: string): boolean {
  if (value.slice(index, index + keyword.length).toUpperCase() !== keyword) return false;
  const before = index === 0 ? " " : value[index - 1];
  const after = value[index + keyword.length] ?? " ";
  return /[^a-zA-Z0-9_]/.test(before) && /[^a-zA-Z0-9_]/.test(after);
}
