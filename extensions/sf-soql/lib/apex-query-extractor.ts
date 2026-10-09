/* SPDX-License-Identifier: Apache-2.0 */
/** Best-effort static SOQL discovery for Apex bracket queries. */

export interface EmbeddedSoqlQuery {
  query: string;
  start: number;
  end: number;
  line: number;
  column: number;
  source: "bracket" | "database-call" | "file";
}

export function extractStaticSoqlQueries(source: string): EmbeddedSoqlQuery[] {
  return [...extractBracketQueries(source), ...extractConstantDatabaseQueries(source)].sort(
    (left, right) => left.start - right.start,
  );
}

function extractBracketQueries(source: string): EmbeddedSoqlQuery[] {
  const queries: EmbeddedSoqlQuery[] = [];
  let quote: "'" | '"' | undefined;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    const previous = source[index - 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (char === quote && previous !== "\\") quote = undefined;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char !== "[") continue;

    const queryStart = skipTrivia(source, index + 1);
    if (!matchesKeywordAt(source, queryStart, "SELECT")) continue;
    const queryEnd = findClosingBracket(source, index);
    if (queryEnd < 0) continue;
    const location = locationAt(source, queryStart);
    queries.push({
      query: source.slice(queryStart, queryEnd).trim(),
      start: queryStart,
      end: queryEnd,
      line: location.line,
      column: location.column,
      source: "bracket",
    });
    index = queryEnd;
  }
  return queries;
}

function extractConstantDatabaseQueries(source: string): EmbeddedSoqlQuery[] {
  const queries: EmbeddedSoqlQuery[] = [];
  let quote: "'" | '"' | undefined;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    const previous = source[index - 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (char === quote && previous !== "\\") quote = undefined;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    const call =
      /^Database\.(?:query(?:WithBinds)?|countQuery(?:WithBinds)?|getQueryLocator)\s*\(/i.exec(
        source.slice(index),
      );
    if (!call || (index > 0 && /[a-zA-Z0-9_.]/.test(source[index - 1]))) continue;
    const openParen = index + call[0].lastIndexOf("(");
    const argument = readFirstArgument(source, openParen);
    if (!argument) continue;
    const value = evaluateConstantString(argument.text);
    if (value === undefined || !/^\s*SELECT\b/i.test(value)) continue;
    const start = argument.start + argument.text.search(/\S/);
    const location = locationAt(source, start);
    queries.push({
      query: value.trim(),
      start,
      end: argument.end,
      line: location.line,
      column: location.column,
      source: "database-call",
    });
    index = argument.end;
  }
  return queries;
}

function readFirstArgument(
  source: string,
  openParen: number,
): { text: string; start: number; end: number } | undefined {
  const start = openParen + 1;
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  let quote: "'" | '"' | undefined;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    const previous = source[index - 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (char === quote && previous !== "\\") quote = undefined;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") parens++;
    else if (char === ")") {
      if (parens === 0 && brackets === 0 && braces === 0) {
        return { text: source.slice(start, index), start, end: index };
      }
      parens--;
    } else if (char === "[") brackets++;
    else if (char === "]") brackets--;
    else if (char === "{") braces++;
    else if (char === "}") braces--;
    else if (char === "," && parens === 0 && brackets === 0 && braces === 0) {
      return { text: source.slice(start, index), start, end: index };
    }
  }
  return undefined;
}

function evaluateConstantString(expression: string): string | undefined {
  let index = 0;
  const skip = () => {
    while (index < expression.length) {
      if (/\s/.test(expression[index])) {
        index++;
        continue;
      }
      if (expression[index] === "/" && expression[index + 1] === "/") {
        index += 2;
        while (index < expression.length && expression[index] !== "\n") index++;
        continue;
      }
      if (expression[index] === "/" && expression[index + 1] === "*") {
        const end = expression.indexOf("*/", index + 2);
        if (end < 0) return false;
        index = end + 2;
        continue;
      }
      break;
    }
    return true;
  };
  const parseTerm = (): string | undefined => {
    if (!skip()) return undefined;
    if (expression[index] === "'") {
      const parsed = parseApexString(expression, index);
      if (!parsed) return undefined;
      index = parsed.next;
      return parsed.value;
    }
    if (expression[index] !== "(") return undefined;
    index++;
    const nested = parseExpression();
    if (nested === undefined || !skip() || expression[index] !== ")") return undefined;
    index++;
    return nested;
  };
  const parseExpression = (): string | undefined => {
    let value = parseTerm();
    if (value === undefined) return undefined;
    while (true) {
      if (!skip()) return undefined;
      if (expression[index] !== "+") return value;
      index++;
      const next = parseTerm();
      if (next === undefined) return undefined;
      value += next;
    }
  };

  const value = parseExpression();
  if (value === undefined || !skip() || index !== expression.length) return undefined;
  return value;
}

function parseApexString(
  source: string,
  offset: number,
): { value: string; next: number } | undefined {
  let index = offset;
  if (source[index] !== "'") return undefined;
  index++;
  let value = "";
  while (index < source.length) {
    const char = source[index++];
    if (char === "'") return { value, next: index };
    if (char !== "\\") {
      value += char;
      continue;
    }
    if (index >= source.length) return undefined;
    const escaped = source[index++];
    value += APEX_ESCAPES[escaped] ?? `\\${escaped}`;
  }
  return undefined;
}

const APEX_ESCAPES: Record<string, string> = {
  "'": "'",
  "\\": "\\",
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
};

function findClosingBracket(source: string, open: number): number {
  let depth = 0;
  let quote: "'" | '"' | undefined;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    const previous = source[index - 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (char === quote && previous !== "\\") quote = undefined;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "[") depth++;
    if (char === "]" && --depth === 0) return index;
  }
  return -1;
}

function skipTrivia(source: string, offset: number): number {
  let index = offset;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index++;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index++;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      return end < 0 ? source.length : skipTrivia(source, end + 2);
    }
    break;
  }
  return index;
}

function matchesKeywordAt(source: string, index: number, keyword: string): boolean {
  if (source.slice(index, index + keyword.length).toUpperCase() !== keyword) return false;
  const after = source[index + keyword.length] ?? " ";
  return /[^a-zA-Z0-9_]/.test(after);
}

function locationAt(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index++) {
    if (source[index] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}
