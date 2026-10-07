#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/** Generate the single-tool sf_data360 business action catalog. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryDir = path.join(root, "extensions", "sf-data360", "registry");
const check = process.argv.includes("--check");
const operations = readJson("operations.json");
const rules = readJson("action-rules.json");
const overrides = readJson("action-overrides.json");
const journeys = readJson("journeys.json");
const runbooks = readJson("runbooks.json");
const examples = readJson("examples.json");

const OWNER_NAMESPACE = {
  discover: "discover",
  connect: "connect",
  prepare: "prepare",
  harmonize: "harmonize",
  segment: "segment",
  activate: "activate",
  query: "query",
  semantic: "semantic",
  observe: "observe",
  orchestrate: "orchestrate",
  api: "api",
};

const PURE_COMPATIBILITY_ALIASES = new Set([
  "d360_data_spaces_list",
  "d360_dmo_describe",
  "d360_dlo_describe",
  "d360_segments_list",
  "d360_activations_list",
  "d360_calculated_insights_list",
  "d360_connectors_list",
  "d360_data_streams_list",
  "d360_data_transforms_list",
  "d360_data_actions_list",
  "d360_identity_resolutions_list",
  "d360_semantic_models_list",
  "d360_search_indexes_list",
  "d360_retrievers_list",
  "d360_datakits_list",
  "d360_metadata_get",
  "d360_model_artifact_list",
  "d360_semantic_model_get",
  "d360_semantic_model_validate",
  "d360_semantic_query",
]);

const META_ACTIONS = [
  meta("discover.route", "Route natural-language Data 360 intent to business actions."),
  meta("discover.readiness.probe", "Probe Data 360 API readiness with bounded reads.", {
    internalAction: "readiness.probe",
  }),
  meta("discover.action.list", "List registered Data 360 actions."),
  meta("discover.action.search", "Search Data 360 actions by business intent."),
  meta("discover.action.describe", "Describe one action, endpoint, safety, and parameters."),
  meta("discover.action.example", "Return a curated payload example for one action."),
  meta("query.sql.metadata", "Get Query API V3 result metadata without fetching rows.", {
    namespace: "query",
    internalOwner: "query",
    internalAction: "query.sql.metadata",
    family: "Query",
  }),
  meta("query.sql.chunk", "Fetch one preferred Query API V3 result chunk.", {
    namespace: "query",
    internalOwner: "query",
    internalAction: "query.sql.chunk",
    family: "Query",
  }),
  meta("api.request", "Call an exact versionless Data 360 Connect REST endpoint.", {
    namespace: "api",
    internalOwner: "api",
    internalAction: "rest.request",
    family: "API",
  }),
];

function meta(action, description, options = {}) {
  const namespace = options.namespace ?? "discover";
  const contracts = {
    "discover.route": { required: ["intent"], optional: ["query", "limit"] },
    "discover.readiness.probe": { required: [], optional: [] },
    "discover.action.list": { required: [], optional: ["namespace", "limit"] },
    "discover.action.search": { required: [], optional: ["query", "intent", "limit"] },
    "discover.action.describe": { required: ["action"], optional: [] },
    "discover.action.example": { required: ["action"], optional: ["variant"] },
    "query.sql.metadata": { required: ["queryId"], optional: ["authSessionId"] },
    "query.sql.chunk": { required: ["queryId", "chunkId"], optional: ["authSessionId"] },
    "api.request": {
      required: ["method", "path"],
      optional: ["api_family", "authSessionId", "query", "body"],
    },
  };
  const contract = contracts[action] ?? { required: [], optional: [] };
  const requiredParams = contract.required;
  const optionalParams = contract.optional;
  const inputSchema = buildInputSchema(requiredParams, optionalParams);
  if (action === "discover.route" || action === "discover.action.search") {
    if (inputSchema.properties.query) inputSchema.properties.query = { type: "string" };
    if (inputSchema.properties.intent) inputSchema.properties.intent = { type: "string" };
  }
  return {
    namespace,
    action,
    internalOwner: options.internalOwner ?? "discover",
    internalAction: options.internalAction ?? action,
    phase: namespace,
    family: options.family ?? "Discovery",
    description,
    safety: "read",
    requiredParams,
    optionalParams,
    inputSchema,
    implementation: { kind: "local", name: action },
    aliases: [],
  };
}

function buildActions() {
  const result = [...META_ACTIONS];
  const primary = new Set(result.map((action) => action.action));
  const compatibilityOperations = [];
  const operationOverrides = overrides.operations ?? {};
  const orderedOperations = [...operations].sort(
    (a, b) => (a.origin === "upstream" ? 0 : 1) - (b.origin === "upstream" ? 0 : 1),
  );
  for (const operation of orderedOperations) {
    const promotion = operation.promotion ?? {};
    const rule = operation.promotion
      ? { namespace: promotion.namespace, phase: promotion.phase }
      : ruleForOperation(operation);
    if (!rule) throw new Error(`No action rule matched ${operation.name} (${operation.family})`);
    const override = operationOverrides[operation.name] ?? {};
    const internalOwner = override.namespace ?? promotion.namespace ?? rule.namespace;
    const namespace = namespaceFor(internalOwner);
    const internalAction = override.action ?? promotion.action ?? deriveAction(operation.name);
    if (PURE_COMPATIBILITY_ALIASES.has(operation.name)) {
      compatibilityOperations.push({ operation, namespace, internalAction });
      continue;
    }
    if (internalAction.includes(".compat") && operation.origin !== "upstream") {
      compatibilityOperations.push({ operation, namespace, internalAction });
      continue;
    }
    const publicInternalAction = internalAction.replace(".compat", "");
    const action = uniqueAction(
      primary,
      publicAction(namespace, publicInternalAction),
      operation.name,
    );
    result.push({
      namespace,
      action,
      internalOwner,
      internalAction,
      phase: override.phase ?? promotion.phase ?? rule.phase,
      family: operation.family,
      ...(promotion.wave ? { promotionWave: promotion.wave } : {}),
      operationId: operation.name,
      capability: operation.name,
      description: override.description ?? operation.description,
      safety: operation.safety,
      requiredParams: operation.requiredParams ?? [],
      optionalParams: operation.optionalParams ?? [],
      ...(operation.requiredAnyOf?.length ? { requiredAnyOf: operation.requiredAnyOf } : {}),
      inputSchema: buildInputSchema(
        operation.requiredParams ?? [],
        operation.optionalParams ?? [],
        operation.name,
        operation.requiredAnyOf,
        operation.parameterSchemas,
      ),
      endpoint: { method: operation.method, path: operation.path },
      aliases: unique([operation.name, ...(override.aliases ?? [])]),
      ...(v2SafetyTips(operation.safety, override.tips ?? operation.tips)
        ? { tips: v2SafetyTips(operation.safety, override.tips ?? operation.tips) }
        : {}),
    });
  }

  for (const { operation, internalAction } of compatibilityOperations) {
    const canonical = result.find(
      (action) =>
        action.endpoint?.method === operation.method &&
        normalizePath(action.endpoint?.path) === normalizePath(operation.path),
    );
    if (!canonical) {
      throw new Error(`No canonical action found for compatibility operation ${operation.name}`);
    }
    canonical.aliases = unique([...(canonical.aliases ?? []), operation.name, internalAction]);
    canonical.operationAliases = unique([...(canonical.operationAliases ?? []), operation.name]);
  }

  for (const runbook of runbooks) {
    const namespace = "observe";
    const internalAction = deriveRunbookAction(runbook.name);
    result.push({
      namespace,
      action: uniqueAction(primary, publicAction(namespace, internalAction), runbook.name),
      internalOwner: "observe",
      internalAction,
      phase: "observe",
      family: runbook.family,
      capability: runbook.name,
      description: runbook.description,
      safety: "read",
      requiredParams: runbook.requiredParams ?? [],
      optionalParams: runbook.optionalParams ?? [],
      ...(runbook.requiredAnyOf?.length ? { requiredAnyOf: runbook.requiredAnyOf } : {}),
      inputSchema: buildInputSchema(
        runbook.requiredParams ?? [],
        runbook.optionalParams ?? [],
        runbook.name,
        runbook.requiredAnyOf,
        runbook.parameterSchemas,
      ),
      aliases: unique([runbook.name]),
      ...(runbook.tips ? { tips: runbook.tips } : {}),
    });
  }

  for (const action of [...(overrides.localActions ?? []), ...journeys]) {
    const normalized = normalizeExtraAction(action);
    normalized.action = uniqueAction(primary, normalized.action, normalized.internalAction);
    result.push(normalized);
  }

  assertEveryOperationMappedOnce(result);
  return result.sort((a, b) => a.action.localeCompare(b.action));
}

function normalizeExtraAction(entry) {
  const namespace = namespaceFor(entry.namespace);
  const safety = required(entry.safety, "extra action safety");
  const internalAction = required(entry.action, "extra action action");
  return {
    namespace,
    action: publicAction(namespace, internalAction),
    internalOwner: entry.namespace,
    internalAction,
    phase: required(entry.phase, "extra action phase"),
    family: required(entry.family, "extra action family"),
    description: required(entry.description, "extra action description"),
    safety,
    requiredParams: entry.requiredParams ?? [],
    optionalParams: entry.optionalParams ?? [],
    ...(entry.requiredAnyOf?.length ? { requiredAnyOf: entry.requiredAnyOf } : {}),
    inputSchema: buildInputSchema(
      entry.requiredParams ?? [],
      entry.optionalParams ?? [],
      entry.capability,
      entry.requiredAnyOf,
      entry.parameterSchemas,
    ),
    implementation: entry.implementation,
    aliases: unique(entry.aliases ?? []),
    ...(v2SafetyTips(safety, entry.tips) ? { tips: v2SafetyTips(safety, entry.tips) } : {}),
  };
}

function namespaceFor(owner) {
  const namespace = OWNER_NAMESPACE[owner];
  if (!namespace) throw new Error(`Unknown Data 360 action owner: ${owner}`);
  return namespace;
}

function publicAction(namespace, action) {
  if (namespace === "segment" && action.startsWith("segment.")) return action;
  if (namespace === "api" && action === "rest.request") return "api.request";
  return `${namespace}.${action}`;
}

function ruleForOperation(operation) {
  return rules.find(
    (rule) =>
      rule.operationNames?.includes(operation.name) ||
      rule.operationNamePrefixes?.some((prefix) => operation.name.startsWith(prefix)) ||
      rule.families?.includes(operation.family),
  );
}

function v2SafetyTips(safety, tips) {
  if (safety !== "destructive") return tips;
  const actionSpecific = String(tips ?? "Destructive operation.")
    .replace(/\s*Actual execution is allowed only with target_org=.*$/s, "")
    .trim();
  return `${actionSpecific} Execution requires a verified non-production target, dry_run review, allow_mutation=true, and Pi confirmation.`;
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
    return `${normalizeResource(parts.slice(0, -1).join("_"))}.${last}`;
  }
  return normalizeResource(renamed);
}
function deriveRunbookAction(name) {
  return name
    .replace(/^agent_observability\./, "")
    .replace(/^stdm_/, "stdm.")
    .replace(/^platform_/, "trace.")
    .replace(/^operation_/, "trace.operation_")
    .replace(/^join_/, "trace.join_");
}
function normalizeResource(resource) {
  return RESOURCE_RENAMES.get(resource) ?? resource;
}
function normalizePath(value) {
  return String(value ?? "").replaceAll(/\{[^}]+\}/g, "{}");
}
function uniqueAction(used, action, source) {
  if (!used.has(action)) {
    used.add(action);
    return action;
  }
  const fallback = `${action}.${source.replace(/^d360_/, "")}`;
  if (used.has(fallback)) throw new Error(`Duplicate action ${action} from ${source}`);
  used.add(fallback);
  return fallback;
}
function assertEveryOperationMappedOnce(actions) {
  const counts = new Map();
  for (const action of actions) {
    if (action.operationId)
      counts.set(action.operationId, (counts.get(action.operationId) ?? 0) + 1);
    for (const alias of action.operationAliases ?? []) {
      counts.set(alias, (counts.get(alias) ?? 0) + 1);
    }
  }
  for (const operation of operations) {
    const count = counts.get(operation.name) ?? 0;
    if (count !== 1) throw new Error(`${operation.name} mapped ${count} time(s), expected 1.`);
  }
}
function buildInputSchema(
  requiredParams,
  optionalParams,
  capability,
  requiredAnyOf = [],
  parameterSchemas = {},
) {
  const sample = exampleParams(capability);
  const properties = {};
  for (const name of unique([...requiredParams, ...optionalParams])) {
    properties[name] = parameterSchemas[name] ?? schemaForValue(sample?.[name], name);
  }
  return {
    type: "object",
    properties,
    required: [...requiredParams],
    ...(requiredAnyOf.length
      ? { anyOf: requiredAnyOf.map((required) => ({ required: [...required] })) }
      : {}),
    additionalProperties: true,
  };
}
function exampleParams(capability) {
  if (!capability) return undefined;
  const example = examples[capability];
  if (!example || typeof example !== "object" || Array.isArray(example)) return undefined;
  if (example.params && typeof example.params === "object" && !Array.isArray(example.params)) {
    return example.params;
  }
  const firstVariant = Object.values(example.variants ?? {})[0];
  return firstVariant?.params && typeof firstVariant.params === "object"
    ? firstVariant.params
    : undefined;
}
function schemaForValue(value, name) {
  if (Array.isArray(value)) {
    return { type: "array", items: value.length ? schemaForValue(value[0], `${name} item`) : {} };
  }
  if (value && typeof value === "object") return { type: "object", additionalProperties: true };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "string") return { type: "string" };
  if (/^(limit|offset|byteLimit|queryRowLimit|max[A-Z]|polls|timeout)/.test(name)) {
    return { type: "integer" };
  }
  if (/^(body|query|settings|resultRange|advancedAttributes)$/.test(name)) {
    return { type: "object", additionalProperties: true };
  }
  if (/Ids$|^scopes$|^prefixes$/.test(name)) return { type: "array", items: { type: "string" } };
  return { type: "string" };
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(registryDir, file), "utf8"));
}
function required(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${label}.`);
  return value;
}
function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))].sort();
}

const actions = buildActions();
const outputPath = path.join(registryDir, "actions.json");
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
    console.error("registry/actions.json is out of date. Run npm run generate-d360-actions.");
    process.exit(1);
  }
} else {
  fs.writeFileSync(outputPath, output);
  console.log(`✅ Generated ${actions.length} sf_data360 business action(s)`);
}
