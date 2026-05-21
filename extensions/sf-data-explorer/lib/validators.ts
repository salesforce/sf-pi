/* SPDX-License-Identifier: Apache-2.0 */
import type { QueryValidationResult } from "./types.ts";

const MUTATION_WORDS = [
  "INSERT",
  "UPDATE",
  "UPSERT",
  "DELETE",
  "UNDELETE",
  "MERGE",
  "CALL",
  "EXEC",
  "SYSTEM.",
  "DATABASE.",
];

function stripLeadingCommentsAndWhitespace(text: string): string {
  let s = text.trim();
  let changed = true;
  while (changed) {
    changed = false;
    if (s.startsWith("--")) {
      const idx = s.indexOf("\n");
      s = idx >= 0 ? s.slice(idx + 1).trimStart() : "";
      changed = true;
    }
    if (s.startsWith("/*")) {
      const idx = s.indexOf("*/");
      s = idx >= 0 ? s.slice(idx + 2).trimStart() : "";
      changed = true;
    }
  }
  return s;
}

function hasMutationWord(text: string): string | undefined {
  const upper = text.toUpperCase();
  return MUTATION_WORDS.find((word) => upper.includes(word));
}

export function validateSelectOnly(
  queryText: string,
  label: "SOQL" | "Data 360 SQL",
): QueryValidationResult {
  const stripped = stripLeadingCommentsAndWhitespace(queryText);
  if (!stripped) return { ok: false, error: `${label} query is empty.` };
  if (!/^SELECT\b/i.test(stripped))
    return { ok: false, error: `${label} must start with SELECT in this read-only explorer.` };
  const mutation = hasMutationWord(stripped);
  if (mutation)
    return {
      ok: false,
      error: `${label} contains blocked token ${mutation}. This explorer is read-only.`,
    };
  const warnings: string[] = [];
  if (!/\bLIMIT\s+\d+\b/i.test(stripped))
    warnings.push(`${label} has no LIMIT. Consider adding one before running broad queries.`);
  return { ok: true, warnings };
}

export function validateFindOnly(queryText: string): QueryValidationResult {
  const stripped = stripLeadingCommentsAndWhitespace(queryText);
  if (!stripped) return { ok: false, error: "SOSL query is empty." };
  if (!/^FIND\b/i.test(stripped))
    return { ok: false, error: "SOSL must start with FIND in this read-only explorer." };
  const mutation = hasMutationWord(stripped);
  if (mutation)
    return {
      ok: false,
      error: `SOSL contains blocked token ${mutation}. This explorer is read-only.`,
    };
  const warnings: string[] = [];
  if (!/\bRETURNING\b/i.test(stripped))
    warnings.push("SOSL has no RETURNING clause; results may be broad.");
  if (!/\bLIMIT\s+\d+\b/i.test(stripped))
    warnings.push(
      "SOSL has no per-object LIMIT. Consider adding one before running broad searches.",
    );
  return { ok: true, warnings };
}

export function escapeSoslTerm(term: string): string {
  return term.replace(/[{}]/g, " ").trim();
}
