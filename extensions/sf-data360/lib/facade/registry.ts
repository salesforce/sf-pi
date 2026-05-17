/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Data 360 facade registry loader.
 *
 * The registry is data-driven so the facade can grow toward the upstream
 * Data 360 MCP server's ~190 operation surface without turning this TypeScript
 * module into a giant hand-maintained endpoint list.
 */
import familiesJson from "../../registry/families.json" with { type: "json" };
import operationsJson from "../../registry/operations.json" with { type: "json" };
import runbooksJson from "../../registry/runbooks.json" with { type: "json" };
import examplesJson from "../../registry/examples.json" with { type: "json" };

export type D360OperationSafety = "read" | "safe_post" | "confirmed" | "destructive";

export interface D360Operation {
  name: string;
  family: string;
  description: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  safety: D360OperationSafety;
  requiredParams?: string[];
  optionalParams?: string[];
  tips?: string;
}

export interface D360RunbookInfo {
  name: string;
  family: string;
  description: string;
  requiredParams?: string[];
  optionalParams?: string[];
  tips?: string;
}

export interface D360Family {
  name: string;
  summary: string;
  keywords: string[];
}

export const D360_FAMILIES = familiesJson as D360Family[];
export const D360_OPERATIONS = operationsJson as D360Operation[];
export const D360_RUNBOOKS = runbooksJson as D360RunbookInfo[];
export const D360_EXAMPLES = examplesJson as Record<string, unknown>;

export function findOperation(name: string): D360Operation | undefined {
  return D360_OPERATIONS.find((op) => op.name === name);
}

export function findRunbook(name: string): D360RunbookInfo | undefined {
  return D360_RUNBOOKS.find((runbook) => runbook.name === name);
}

export function searchRegistry(query: string): Array<{
  family: string;
  score: number;
  summary: string;
  operations: string[];
  runbooks: string[];
}> {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
  const scored = D360_FAMILIES.map((family) => {
    const haystack = [family.name, family.summary, ...family.keywords].join(" ").toLowerCase();
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
    return {
      family: family.name,
      score,
      summary: family.summary,
      operations: D360_OPERATIONS.filter((op) => op.family === family.name).map((op) => op.name),
      runbooks: D360_RUNBOOKS.filter((runbook) => runbook.family === family.name).map(
        (runbook) => runbook.name,
      ),
    };
  });
  return scored
    .filter((entry) => entry.score > 0 || terms.length === 0)
    .sort((a, b) => b.score - a.score || a.family.localeCompare(b.family))
    .slice(0, 6);
}
