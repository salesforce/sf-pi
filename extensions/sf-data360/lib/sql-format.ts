/* SPDX-License-Identifier: Apache-2.0 */
/** Small dependency-free formatter for Data 360 SQL presentation. */

const CLAUSES = [
  "UNION ALL",
  "GROUP BY",
  "ORDER BY",
  "LEFT OUTER JOIN",
  "RIGHT OUTER JOIN",
  "FULL OUTER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
  "INNER JOIN",
  "CROSS JOIN",
  "FROM",
  "WHERE",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "UNION",
] as const;

export function formatData360Sql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) return "";
  const { text, literals } = protectQuotedValues(trimmed);
  let normalized = text.replace(/\s+/g, " ").trim();
  for (const clause of CLAUSES) {
    const pattern = new RegExp(`\\s+${clause.replace(/ /g, "\\s+")}\\s+`, "gi");
    normalized = normalized.replace(pattern, `\n${clause} `);
  }
  normalized = normalized.replace(/^select\s+/i, "SELECT\n  ");
  normalized = formatSelectList(normalized);
  normalized = normalized
    .replace(/\s+AND\s+/gi, "\n  AND ")
    .replace(/\s+OR\s+/gi, "\n  OR ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return restoreQuotedValues(normalized, literals);
}

function formatSelectList(sql: string): string {
  const fromIndex = sql.indexOf("\nFROM ");
  if (!sql.startsWith("SELECT\n  ") || fromIndex < 0) return sql;
  const prefix = "SELECT\n  ";
  const list = sql.slice(prefix.length, fromIndex);
  const fields = splitTopLevel(list, ",");
  if (fields.length <= 1) return sql;
  return `${prefix}${fields.map((field) => field.trim()).join(",\n  ")}${sql.slice(fromIndex)}`;
}

function splitTopLevel(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === delimiter && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function protectQuotedValues(value: string): { text: string; literals: string[] } {
  const literals: string[] = [];
  let text = "";
  for (let index = 0; index < value.length;) {
    const quote = value[index];
    if (quote !== "'" && quote !== '"') {
      text += quote;
      index++;
      continue;
    }
    const start = index;
    index++;
    while (index < value.length) {
      if (value[index] === quote) {
        if (value[index + 1] === quote) {
          index += 2;
          continue;
        }
        index++;
        break;
      }
      if (value[index] === "\\") index++;
      index++;
    }
    const token = `\uE000${literals.length}\uE001`;
    literals.push(value.slice(start, index));
    text += token;
  }
  return { text, literals };
}

function restoreQuotedValues(value: string, literals: string[]): string {
  return value.replace(
    /\uE000(\d+)\uE001/g,
    (_match, index: string) => literals[Number(index)] ?? "",
  );
}
