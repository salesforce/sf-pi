#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/** Generate exhaustive recursive-test classifications for every sf_data360 action. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

const check = process.argv.includes("--check");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryDir = path.join(root, "extensions", "sf-data360", "registry");
const actions = readJson("actions.json");
const rules = readJson("action-test-rules.json");
const parameterKinds = buildParameterKinds(rules.parameterKinds ?? {});
const externalCapabilities = new Set(rules.externalEffectCapabilities ?? []);

const contracts = actions.map((action) => {
  const capability = capabilityFor(action.action, rules.capabilityRules ?? []);
  const requirements = unique([
    ...(action.requiredParams ?? []),
    ...(action.requiredAnyOf ?? []).flat(),
  ]).map((name) => ({ name, source: parameterKinds.get(name) ?? "unmapped" }));
  const unmapped = requirements.filter((requirement) => requirement.source === "unmapped");
  if (unmapped.length) {
    throw new Error(
      `${action.action} has unclassified test parameters: ${unmapped
        .map((requirement) => requirement.name)
        .join(", ")}`,
    );
  }
  return {
    action: action.action,
    namespace: action.namespace,
    safety: action.safety,
    implementation: action.implementation?.kind ?? "endpoint",
    mode: modeFor(action),
    capability,
    fixturePolicy: fixturePolicyFor(action, capability, externalCapabilities),
    requirements,
    requiredAnyOf: action.requiredAnyOf ?? [],
    endpoint: action.endpoint,
  };
});

const output = {
  schemaVersion: 1,
  generatedFrom: "registry/actions.json",
  actionCount: contracts.length,
  actions: contracts,
};
const outputPath = path.join(registryDir, "action-test-contracts.json");
const formatted = await prettier.format(JSON.stringify(output), {
  parser: "json",
  printWidth: 100,
  trailingComma: "all",
});
if (check) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (current !== formatted) {
    console.error(
      "registry/action-test-contracts.json is out of date. Run npm run generate-d360-test-contracts.",
    );
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(outputPath, formatted);
  console.log(`✅ Generated ${contracts.length} sf_data360 recursive test contract(s)`);
}

function modeFor(action) {
  if (action.action === "api.request") return "dynamic_api";
  if (action.safety === "destructive") return "fixture_cleanup";
  if (action.safety === "confirmed") return "fixture_mutation";
  if (action.safety === "safe_post") return "validation_post";
  const needsInputs =
    (action.requiredParams?.length ?? 0) > 0 || (action.requiredAnyOf?.length ?? 0) > 0;
  if (action.implementation?.kind === "local") return needsInputs ? "asset_read" : "local";
  if (action.implementation?.kind === "journey") return "orchestration";
  return needsInputs ? "asset_read" : "catalog_read";
}

function fixturePolicyFor(action, capability, externalCapabilities) {
  if (action.safety === "destructive") return "owned_only";
  if (action.safety === "confirmed") {
    return externalCapabilities.has(capability) ? "external_explicit" : "owned_only";
  }
  if (action.action === "api.request") return "method_dependent";
  return "none";
}

function capabilityFor(action, capabilityRules) {
  for (const rule of capabilityRules) {
    if ((rule.actions ?? []).includes(action)) return rule.capability;
    if ((rule.actionPrefixes ?? []).some((prefix) => action.startsWith(prefix))) {
      return rule.capability;
    }
  }
  return "core";
}

function buildParameterKinds(groups) {
  const result = new Map();
  for (const [kind, names] of Object.entries(groups)) {
    for (const name of names) {
      const previous = result.get(name);
      if (previous)
        throw new Error(`Test parameter ${name} is classified as ${previous} and ${kind}.`);
      result.set(name, kind);
    }
  }
  return result;
}

function unique(values) {
  return [...new Set(values)].sort();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(registryDir, file), "utf8"));
}
