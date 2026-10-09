/* SPDX-License-Identifier: Apache-2.0 */
/** Org-versioned SOQL normalization and the single syntax-validation pass. */

import { createRequire } from "node:module";
import type {
  parseHeaderComments as parseHeaderCommentsType,
  SOQLParser as SOQLParserType,
} from "@salesforce/soql-common";
import type { SoqlFormulaExpression, SoqlParseContext, SoqlQueryShape } from "./types.ts";

const require = createRequire(import.meta.url);
const { parseHeaderComments, SOQLParser } = require("@salesforce/soql-common") as {
  parseHeaderComments: typeof parseHeaderCommentsType;
  SOQLParser: typeof SOQLParserType;
};

const TRAILING_ALL_ROWS = /\s+ALL\s+ROWS\s*;?\s*$/i;
const FORMULA_EXPRESSION =
  /\bFORMULA\s*\(\s*'([a-zA-Z_][\w.]*)\s*([+-])\s*([a-zA-Z_][\w.]*)'\s*\)/gi;
// FORMULA() in WHERE entered the SOQL reference with Summer '26 / API 67.
const MIN_FORMULA_API_VERSION = 67;

export interface SoqlParseOptions {
  apiVersion?: number;
  context?: SoqlParseContext;
}

export function normalizeAndValidateSoql(
  rawQuery: string,
  options: SoqlParseOptions,
): SoqlQueryShape {
  const raw = rawQuery.trim();
  const parsedComments = parseHeaderComments(raw);
  const comments = stripSoqlComments(parsedComments.soqlText);
  const { soql, allRows } = stripAllRows(comments.text.trim().replace(/;\s*$/, ""));
  const syntaxErrors = [
    ...(comments.unterminated
      ? [{ line: comments.line, column: comments.column, message: "Unterminated block comment." }]
      : []),
    ...validateSyntax(soql, options),
  ];
  return {
    raw,
    normalized: soql,
    operation: allRows ? "queryAll" : "query",
    all_rows: allRows,
    header_comments: parsedComments.headerComments?.trim() || undefined,
    syntax_context: options.context,
    syntax_api_version: options.apiVersion,
    syntax_errors: syntaxErrors.length ? syntaxErrors : undefined,
  };
}

export function stripAllRows(soql: string): { soql: string; allRows: boolean } {
  const allRows = TRAILING_ALL_ROWS.test(soql);
  return { soql: soql.replace(TRAILING_ALL_ROWS, "").trim(), allRows };
}

export function extractFormulaExpressions(value?: string): SoqlFormulaExpression[] {
  return value ? formulaMatches(value, false).map((match) => match.expression) : [];
}

function validateSyntax(
  query: string,
  options: SoqlParseOptions,
): NonNullable<SoqlQueryShape["syntax_errors"]> {
  if (options.apiVersion === undefined) return [];
  try {
    const parser = SOQLParser({
      isApex: options.context === "apex",
      isMultiCurrencyEnabled: true,
      apiVersion: options.apiVersion,
    });
    const result = parser.parseQuery(prepareParserInput(query, options));
    return result.getParserErrors().map((err) => ({
      line: err.getLineNumber(),
      column: err.getCharacterPositionInLine(),
      message: err.getMessage(),
    }));
  } catch (err) {
    return [{ line: 0, column: 0, message: err instanceof Error ? err.message : String(err) }];
  }
}

function stripSoqlComments(value: string): {
  text: string;
  unterminated: boolean;
  line: number;
  column: number;
} {
  let text = "";
  let quote: "'" | '"' | undefined;
  let line = 1;
  let column = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    const next = value[index + 1];
    const previous = value[index - 1];
    if (quote) {
      text += char;
      if (char === quote && previous !== "\\") quote = undefined;
    } else if (char === "'" || char === '"') {
      quote = char;
      text += char;
    } else if (char === "/" && next === "/") {
      text += "  ";
      index++;
      column += 2;
      while (index + 1 < value.length && value[index + 1] !== "\n") {
        text += " ";
        index++;
        column++;
      }
    } else if (char === "/" && next === "*") {
      const startLine = line;
      const startColumn = column;
      text += "  ";
      index++;
      column += 2;
      let closed = false;
      while (index + 1 < value.length) {
        index++;
        const current = value[index];
        const after = value[index + 1];
        if (current === "*" && after === "/") {
          text += "  ";
          index++;
          column += 2;
          closed = true;
          break;
        }
        text += current === "\n" ? "\n" : " ";
        if (current === "\n") {
          line++;
          column = 0;
        } else {
          column++;
        }
      }
      if (!closed) return { text, unterminated: true, line: startLine, column: startColumn };
    } else {
      text += char;
    }
    if (char === "\n") {
      line++;
      column = 0;
    } else {
      column++;
    }
  }
  return { text, unterminated: false, line, column };
}

function prepareParserInput(query: string, options: SoqlParseOptions): string {
  let prepared = maskSupportedFormulaExpressions(query, options.apiVersion as number);
  if (options.context === "apex") {
    prepared = prepared.replace(/\bFOR\s+UPDATE\s*$/i, (clause) => " ".repeat(clause.length));
  }
  return prepared;
}

function maskSupportedFormulaExpressions(query: string, apiVersion: number): string {
  if (apiVersion < MIN_FORMULA_API_VERSION) return query;
  const matches = formulaMatches(query, true);
  if (!matches.length) return query;
  let result = query;
  for (const match of [...matches].reverse()) {
    const replacement = match.expression.left_field.padEnd(match.length, " ");
    result = `${result.slice(0, match.index)}${replacement}${result.slice(match.index + match.length)}`;
  }
  return result;
}

function formulaMatches(value: string, requireWhere: boolean) {
  const matches: Array<{
    expression: SoqlFormulaExpression;
    index: number;
    length: number;
  }> = [];
  const pattern = new RegExp(FORMULA_EXPRESSION.source, FORMULA_EXPRESSION.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    if (requireWhere && clauseAtPosition(value, match.index) !== "WHERE") continue;
    matches.push({
      expression: {
        left_field: match[1],
        operator: match[2] as "+" | "-",
        right_field: match[3],
      },
      index: match.index,
      length: match[0].length,
    });
  }
  return matches;
}

function clauseAtPosition(value: string, position: number): string | undefined {
  const clauses = [
    "SET OPTIONS",
    "GROUP BY",
    "ORDER BY",
    "SELECT",
    "FROM",
    "WHERE",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "WITH",
    "FOR",
    "UPDATE",
  ];
  const active = new Map<number, string>();
  let depth = 0;
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < position; index++) {
    const char = value[index];
    const previous = value[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth++;
      continue;
    }
    if (char === ")") {
      active.delete(depth);
      depth = Math.max(0, depth - 1);
      continue;
    }
    for (const clause of clauses) {
      if (!matchesKeywordAt(value, index, clause)) continue;
      active.set(depth, clause);
      index += clause.length - 1;
      break;
    }
  }
  return quote ? undefined : active.get(depth);
}

function matchesKeywordAt(value: string, index: number, keyword: string): boolean {
  if (value.slice(index, index + keyword.length).toUpperCase() !== keyword) return false;
  const before = index === 0 ? " " : value[index - 1];
  const after = value[index + keyword.length] ?? " ";
  return /[^a-zA-Z0-9_]/.test(before) && /[^a-zA-Z0-9_]/.test(after);
}
