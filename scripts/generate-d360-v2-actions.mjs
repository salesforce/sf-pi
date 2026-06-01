#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const registryDir = path.join(root, "extensions", "sf-data360", "registry");
const v2Dir = path.join(registryDir, "v2");
const check = process.argv.includes("--check");

const operations = readJson(path.join(registryDir, "operations.json"));
const rules = readJson(path.join(v2Dir, "action-rules.json"));
const overrides = readJson(path.join(v2Dir, "action-overrides.json"));
const journeys = readJson(path.join(v2Dir, "journeys.json"));
const runbooks = readJson(path.join(registryDir, "runbooks.json"));

function buildActions() {
  const result = [];
  const primaryActions = new Set();
  const operationOverrides = overrides.operations ?? {};
  for (const operation of operations) {
    const rule = ruleForOperation(operation);
    if (!rule) throw new Error(`No v2 action rule matched ${operation.name} (${operation.family})`);
    const override = operationOverrides[operation.name] ?? {};
    const tool = override.tool ?? rule.tool;
    const phase = override.phase ?? rule.phase;
    const baseAction = override.action ?? deriveAction(operation.name);
    const action = uniquePrimaryAction(
      primaryActions,
      tool,
      baseAction,
      operation.name,
      Boolean(override.action),
    );
    result.push({
      tool,
      action,
      phase,
      family: operation.family,
      capability: operation.name,
      description: override.description ?? operation.description,
      safety: operation.safety,
      requiredParams: operation.requiredParams ?? [],
      optionalParams: operation.optionalParams ?? [],
      endpoint: { method: operation.method, path: operation.path },
      aliases: unique([operation.name, ...(override.aliases ?? [])]),
      ...(operation.tips || override.tips ? { tips: override.tips ?? operation.tips } : {}),
    });
  }

  for (const runbook of runbooks) {
    const action = uniquePrimaryAction(
      primaryActions,
      "data360_observe",
      deriveRunbookAction(runbook.name),
      runbook.name,
      false,
    );
    result.push({
      tool: "data360_observe",
      action,
      phase: "observe",
      family: runbook.family,
      capability: runbook.name,
      description: runbook.description,
      safety: "read",
      requiredParams: runbook.requiredParams ?? [],
      optionalParams: runbook.optionalParams ?? [],
      aliases: unique([runbook.name]),
      ...(runbook.tips ? { tips: runbook.tips } : {}),
    });
  }

  for (const localAction of overrides.localActions ?? [])
    result.push(normalizeExtraAction(localAction));
  for (const journey of journeys) result.push(normalizeExtraAction(journey));

  assertUniquePrimaryActions(result);
  assertEveryOperationMappedOnce(result);
  return result.sort((a, b) => a.tool.localeCompare(b.tool) || a.action.localeCompare(b.action));
}

function ruleForOperation(operation) {
  const matches = rules.filter((rule) => {
    if (rule.operationNames?.includes(operation.name)) return true;
    if (rule.operationNamePrefixes?.some((prefix) => operation.name.startsWith(prefix)))
      return true;
    if (rule.families?.includes(operation.family)) return true;
    return false;
  });
  if (matches.length === 0) return undefined;
  return matches[0];
}

const VERBS = new Set([
  "add",
  "cancel",
  "clone",
  "config",
  "create",
  "deactivate",
  "delete",
  "dependencies",
  "deploy",
  "disable",
  "enable",
  "get",
  "list",
  "lookup",
  "manifest",
  "metadata",
  "preview",
  "publish",
  "query",
  "remove",
  "run",
  "status",
  "suggest",
  "update",
  "undeploy",
  "validate",
]);

const RESOURCE_RENAMES = new Map([
  ["datastream", "stream"],
  ["datastreams", "stream"],
  ["data_streams", "stream"],
  ["data_transforms", "transform"],
  ["data_actions", "data_action"],
  ["calculated_insights", "ci"],
  ["identity_resolutions", "identity"],
  ["semantic_models", "semantic_model"],
  ["retrievers", "retriever"],
  ["search_indexes", "search_index"],
  ["activations", "activation"],
  ["segments", "segment"],
]);

function deriveAction(operationName) {
  const raw = operationName.replace(/^d360_/, "");
  const renamed = RESOURCE_RENAMES.get(raw) ?? raw;
  const parts = renamed.split("_");
  const last = parts.at(-1);
  if (last && VERBS.has(last) && parts.length > 1) {
    return `${normalizeResource(parts.slice(0, -1).join("_"))}.${normalizeVerb(last)}`;
  }
  return normalizeResource(renamed);
}

function deriveRunbookAction(runbookName) {
  return runbookName
    .replace(/^agent_observability\./, "")
    .replace(/^stdm_/, "stdm.")
    .replace(/^platform_/, "trace.")
    .replace(/^operation_/, "trace.operation_")
    .replace(/^join_/, "trace.join_");
}

function normalizeResource(resource) {
  return RESOURCE_RENAMES.get(resource) ?? resource;
}

function normalizeVerb(verb) {
  return verb;
}

function normalizeExtraAction(action) {
  return {
    tool: required(action.tool, "extra action tool"),
    action: required(action.action, "extra action action"),
    phase: required(action.phase, "extra action phase"),
    family: required(action.family, "extra action family"),
    description: required(action.description, "extra action description"),
    safety: required(action.safety, "extra action safety"),
    requiredParams: action.requiredParams ?? [],
    optionalParams: action.optionalParams ?? [],
    implementation: action.implementation,
    aliases: unique(action.aliases ?? []),
    ...(action.tips ? { tips: action.tips } : {}),
  };
}

function uniquePrimaryAction(used, tool, action, operationName, curated) {
  const key = `${tool}:${action}`;
  if (!used.has(key)) {
    used.add(key);
    return action;
  }
  if (curated) throw new Error(`Curated v2 action ${key} is already assigned.`);
  const fallback = `${action}.${operationName.replace(/^d360_/, "")}`;
  const fallbackKey = `${tool}:${fallback}`;
  if (used.has(fallbackKey))
    throw new Error(`Fallback v2 action ${fallbackKey} is already assigned.`);
  used.add(fallbackKey);
  return fallback;
}

function assertUniquePrimaryActions(actions) {
  const seen = new Map();
  for (const action of actions) {
    const key = `${action.tool}:${action.action}`;
    const previous = seen.get(key);
    if (previous)
      throw new Error(
        `Duplicate v2 action ${key}: ${previous} and ${action.capability ?? action.implementation?.name}`,
      );
    seen.set(key, action.capability ?? action.implementation?.name ?? key);
  }
}

function assertEveryOperationMappedOnce(actions) {
  const byCapability = new Map();
  for (const action of actions) {
    if (!action.capability) continue;
    byCapability.set(action.capability, (byCapability.get(action.capability) ?? 0) + 1);
  }
  for (const operation of operations) {
    const count = byCapability.get(operation.name) ?? 0;
    if (count !== 1)
      throw new Error(`${operation.name} mapped ${count} time(s), expected exactly 1.`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${label}.`);
  return value;
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))].sort();
}

const actions = buildActions();
const outputPath = path.join(v2Dir, "actions.json");
const output = await prettier.format(JSON.stringify(actions), {
  parser: "json",
  printWidth: 100,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
});

if (check) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (current !== output) {
    console.error("registry/v2/actions.json is out of date. Run npm run generate-d360-v2-actions.");
    process.exit(1);
  }
} else {
  fs.writeFileSync(outputPath, output);
}
