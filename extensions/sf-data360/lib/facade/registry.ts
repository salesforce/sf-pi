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

export interface D360Phase {
  id: string;
  label: string;
  skillName: string;
  summary: string;
  description: string;
  familyDefaults?: string[];
  operationOverrides?: string[];
}

export type D360CapabilityKind = "rest_operation" | "local_helper" | "runbook";

export interface D360Capability {
  name: string;
  kind: D360CapabilityKind;
  family: string;
  phase?: string;
  description: string;
  safety: D360OperationSafety;
  requiredParams?: string[];
  optionalParams?: string[];
  tips?: string;
  operation?: D360Operation;
  runbook?: D360RunbookInfo;
}

interface RegistrySnapshot {
  families: D360Family[];
  operations: D360Operation[];
  runbooks: D360RunbookInfo[];
  phases: D360Phase[];
  capabilities: D360Capability[];
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

export function getD360Capabilities(): D360Capability[] {
  return loadRegistry().capabilities;
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

export function findCapability(name: string): D360Capability | undefined {
  return getD360Capabilities().find((capability) => capability.name === name);
}

export function searchRegistry(query: string): Array<{
  family: string;
  score: number;
  summary: string;
  capabilities: Array<Pick<D360Capability, "name" | "kind" | "safety" | "phase" | "description">>;
}> {
  const registry = loadRegistry();
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
  const scored = registry.families.map((family) => {
    const capabilities = registry.capabilities.filter(
      (capability) => capability.family === family.name,
    );
    const haystack = [
      family.name,
      family.summary,
      ...family.keywords,
      ...capabilities.flatMap((capability) => [
        capability.name,
        capability.name.replaceAll("_", " "),
        capability.description,
        capability.tips ?? "",
      ]),
    ]
      .join(" ")
      .toLowerCase();
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
    return {
      family: family.name,
      score,
      summary: family.summary,
      capabilities: capabilities.map((capability) => ({
        name: capability.name,
        kind: capability.kind,
        safety: capability.safety,
        phase: capability.phase,
        description: capability.description,
      })),
    };
  });
  return scored
    .filter((entry) => entry.score > 0 || terms.length === 0)
    .sort((a, b) => b.score - a.score || a.family.localeCompare(b.family))
    .slice(0, 6);
}

function loadRegistry(): RegistrySnapshot {
  const mtimeKey = [
    "families.json",
    "operations.json",
    "runbooks.json",
    "phases.json",
    "examples.json",
  ]
    .map((fileName) => statSync(path.join(REGISTRY_DIR, fileName)).mtimeMs)
    .join(":");
  if (registryCache?.mtimeKey === mtimeKey) return registryCache;

  const families = readJson<D360Family[]>("families.json");
  const operations = readJson<D360Operation[]>("operations.json");
  const runbooks = readJson<D360RunbookInfo[]>("runbooks.json");
  const phases = readJson<D360Phase[]>("phases.json");

  registryCache = {
    families,
    operations,
    runbooks,
    phases,
    capabilities: buildCapabilities(operations, runbooks, phases),
    examples: readJson<Record<string, unknown>>("examples.json"),
    mtimeKey,
  };
  return registryCache;
}

function buildCapabilities(
  operations: D360Operation[],
  runbooks: D360RunbookInfo[],
  phases: D360Phase[],
): D360Capability[] {
  const phaseByFamily = new Map<string, string>();
  const phaseByOperation = new Map<string, string>();
  for (const phase of phases) {
    for (const family of phase.familyDefaults ?? []) phaseByFamily.set(family, phase.id);
    for (const operation of phase.operationOverrides ?? [])
      phaseByOperation.set(operation, phase.id);
  }

  return [
    ...operations.map(
      (operation): D360Capability => ({
        name: operation.name,
        kind: operation.path.startsWith("/local/") ? "local_helper" : "rest_operation",
        family: operation.family,
        phase: phaseByOperation.get(operation.name) ?? phaseByFamily.get(operation.family),
        description: operation.description,
        safety: operation.safety,
        requiredParams: operation.requiredParams,
        optionalParams: operation.optionalParams,
        tips: operation.tips,
        operation,
      }),
    ),
    ...runbooks.map(
      (runbook): D360Capability => ({
        name: runbook.name,
        kind: "runbook",
        family: runbook.family,
        phase: phaseByFamily.get(runbook.family),
        description: runbook.description,
        safety: "read",
        requiredParams: runbook.requiredParams,
        optionalParams: runbook.optionalParams,
        tips: runbook.tips,
        runbook,
      }),
    ),
  ];
}

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(path.join(REGISTRY_DIR, fileName), "utf8")) as T;
}
