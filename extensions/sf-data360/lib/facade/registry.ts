/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Data 360 facade registry loader.
 *
 * The registry is data-driven so the facade can grow toward the upstream
 * Data 360 MCP server's ~190 operation surface without turning this TypeScript
 * module into a giant hand-maintained endpoint list. The JSON files are read at
 * call time (with a small mtime cache) so `/reload` can pick up registry-only
 * edits without a full pi process restart.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_DIR = path.resolve(__dirname, "..", "..", "registry");

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

interface RegistrySnapshot {
  families: D360Family[];
  operations: D360Operation[];
  runbooks: D360RunbookInfo[];
  examples: Record<string, unknown>;
  mtimeKey: string;
}

let registryCache: RegistrySnapshot | undefined;

export function getD360Families(): D360Family[] {
  return loadRegistry().families;
}

export function getD360Operations(): D360Operation[] {
  return loadRegistry().operations;
}

export function getD360Runbooks(): D360RunbookInfo[] {
  return loadRegistry().runbooks;
}

export function getD360Examples(): Record<string, unknown> {
  return loadRegistry().examples;
}

export function findOperation(name: string): D360Operation | undefined {
  return getD360Operations().find((op) => op.name === name);
}

export function findRunbook(name: string): D360RunbookInfo | undefined {
  return getD360Runbooks().find((runbook) => runbook.name === name);
}

export function searchRegistry(query: string): Array<{
  family: string;
  score: number;
  summary: string;
  operations: string[];
  runbooks: string[];
}> {
  const registry = loadRegistry();
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
  const scored = registry.families.map((family) => {
    const operations = registry.operations.filter((op) => op.family === family.name);
    const runbooks = registry.runbooks.filter((runbook) => runbook.family === family.name);
    const haystack = [
      family.name,
      family.summary,
      ...family.keywords,
      ...operations.flatMap((op) => [op.name, op.description, op.tips ?? ""]),
      ...runbooks.flatMap((runbook) => [runbook.name, runbook.description, runbook.tips ?? ""]),
    ]
      .join(" ")
      .toLowerCase();
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
    return {
      family: family.name,
      score,
      summary: family.summary,
      operations: operations.map((op) => op.name),
      runbooks: runbooks.map((runbook) => runbook.name),
    };
  });
  return scored
    .filter((entry) => entry.score > 0 || terms.length === 0)
    .sort((a, b) => b.score - a.score || a.family.localeCompare(b.family))
    .slice(0, 6);
}

function loadRegistry(): RegistrySnapshot {
  const mtimeKey = ["families.json", "operations.json", "runbooks.json", "examples.json"]
    .map((fileName) => statSync(path.join(REGISTRY_DIR, fileName)).mtimeMs)
    .join(":");
  if (registryCache?.mtimeKey === mtimeKey) return registryCache;

  registryCache = {
    families: readJson<D360Family[]>("families.json"),
    operations: readJson<D360Operation[]>("operations.json"),
    runbooks: readJson<D360RunbookInfo[]>("runbooks.json"),
    examples: readJson<Record<string, unknown>>("examples.json"),
    mtimeKey,
  };
  return registryCache;
}

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(path.join(REGISTRY_DIR, fileName), "utf8")) as T;
}
