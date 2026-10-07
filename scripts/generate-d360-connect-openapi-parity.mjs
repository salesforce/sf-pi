#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/** Compare the normalized Connect OpenAPI contract with sf_data360 endpoint actions. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";

import { buildConnectOpenApiParity } from "./lib/d360-connect-openapi.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = path.join(ROOT, "extensions", "sf-data360", "registry");
const REFERENCES = path.join(ROOT, "extensions", "sf-data360", "references");
const JSON_PATH = path.join(REGISTRY, "connect-openapi-parity.json");
const MARKDOWN_PATH = path.join(REFERENCES, "connect-openapi-parity.md");
const check = process.argv.includes("--check");

const snapshot = readJson(path.join(REGISTRY, "connect-openapi-contracts.json"));
const overrides = readJson(path.join(REGISTRY, "connect-openapi-overrides.json"));
const promotions = readJson(path.join(REGISTRY, "connect-openapi-promotions.json"));
const actions = readJson(path.join(REGISTRY, "actions.json"));
const report = buildConnectOpenApiParity(snapshot, actions, overrides, promotions);
const unassigned = report.promotionWaves.find((wave) => wave.id === "unassigned");
if (unassigned?.remaining) {
  throw new Error(
    `${unassigned.remaining} Connect OpenAPI operation(s) are not assigned to a wave.`,
  );
}
const prettierOptions = {
  printWidth: 100,
  ...((await resolveConfig(path.join(ROOT, "package.json"))) ?? {}),
};
const json = await format(JSON.stringify(report), { ...prettierOptions, parser: "json" });
const markdown = await format(renderMarkdown(report), {
  ...prettierOptions,
  parser: "markdown",
});

if (check) {
  const stale = [
    [JSON_PATH, json],
    [MARKDOWN_PATH, markdown],
  ].filter(([file, expected]) => !existsSync(file) || readFileSync(file, "utf8") !== expected);
  if (stale.length) {
    console.error(
      `❌ Data 360 Connect OpenAPI parity artifacts are stale: ${stale
        .map(([file]) => path.relative(ROOT, file))
        .join(", ")}. Run npm run generate-d360-connect-openapi-parity.`,
    );
    process.exit(1);
  }
  console.log(
    `✅ Data 360 Connect OpenAPI parity is current (${report.summary.matchedOpenApiOperations}/${report.summary.openApiOperations} OpenAPI operation(s) matched)`,
  );
} else {
  writeFileSync(JSON_PATH, json, "utf8");
  writeFileSync(MARKDOWN_PATH, markdown, "utf8");
  console.log(
    `✅ Generated Data 360 Connect OpenAPI parity (${report.summary.matchedOpenApiOperations}/${report.summary.openApiOperations} OpenAPI operation(s) matched)`,
  );
}

function renderMarkdown(value) {
  const openApiOnly = value.entries.filter((entry) => entry.status === "openapi_only");
  const openApiPathOverlaps = openApiOnly.filter((entry) => entry.sdkMethodsAtPath.length);
  const sdkOnly = value.sdkOnly;
  const sdkPathOverlaps = sdkOnly.filter((entry) => entry.openApiMethods.length);
  const parameterDrift = value.entries.flatMap((entry) =>
    entry.actions
      .filter((action) => action.parameterStatus === "drift")
      .map((action) => ({ key: entry.key, ...action })),
  );
  const sdkStricter = value.entries.flatMap((entry) =>
    entry.actions
      .filter((action) => action.parameterStatus === "sdk_stricter")
      .map((action) => ({ key: entry.key, ...action })),
  );
  return [
    "# SF Data 360 Connect OpenAPI Parity",
    "",
    "This generated report compares the official Data 360 Connect OpenAPI contract with endpoint-backed actions exposed through the single `sf_data360` tool. Query API V3, tenant Ingestion API, local helpers, and journeys are outside this Connect contract.",
    "",
    `- Source: ${value.source.url}`,
    `- OpenAPI: ${value.source.openapi}`,
    `- Connect API version: ${value.source.apiVersion}`,
    `- SHA-256: \`${value.source.sha256}\``,
    `- OpenAPI operations: ${value.summary.openApiOperations}`,
    `- Matched OpenAPI operations: ${value.summary.matchedOpenApiOperations}`,
    `- OpenAPI-only operations: ${value.summary.openApiOnlyOperations}`,
    `- SDK endpoint actions: ${value.summary.sdkEndpointActions}`,
    `- Matched SDK actions: ${value.summary.matchedSdkActions}`,
    `- SDK-only actions: ${value.summary.sdkOnlyActions}`,
    `- Method mismatches: ${value.summary.methodMismatches}`,
    `- OpenAPI operations sharing a path with other SDK methods: ${value.summary.openApiOperationsWithSdkPathOverlap}`,
    `- SDK actions sharing a path with other OpenAPI methods: ${value.summary.sdkActionsWithOpenApiPathOverlap}`,
    `- Exact parameter actions: ${value.summary.exactParameterActions}`,
    `- Adjusted parameter actions: ${value.summary.adjustedParameterActions}`,
    `- SDK-stricter parameter actions: ${value.summary.sdkStricterParameterActions}`,
    `- Parameter-drift actions: ${value.summary.parameterDriftActions}`,
    "",
    "## Promotion waves",
    "",
    "| Wave | Scope | Total | Promoted | Remaining |",
    "| --- | --- | ---: | ---: | ---: |",
    ...value.promotionWaves.map(
      (wave) =>
        `| ${wave.id} | ${wave.label} | ${wave.total} | ${wave.promoted} | ${wave.remaining} |`,
    ),
    "",
    "## OpenAPI-only product families",
    "",
    "| Product family | Total | Read | Action/create | Update | Destructive |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...value.openApiOnlyFamilies.map(
      (family) =>
        `| ${family.family} | ${family.total} | ${family.promotionCandidates.read} | ${family.promotionCandidates.actionOrCreate} | ${family.promotionCandidates.update} | ${family.promotionCandidates.destructive} |`,
    ),
    "",
    "## OpenAPI-only operations",
    "",
    ...listOrNone(
      openApiOnly,
      (entry) => `- \`${entry.key}\` (${entry.operationId ?? "no operationId"})`,
    ),
    "",
    "## Path-method overlaps",
    "",
    "These are distinct operations that share a resource path; they are not method mismatches.",
    "",
    ...listOrNone(
      openApiPathOverlaps,
      (entry) =>
        `- OpenAPI \`${entry.key}\`; SDK methods at path: ${entry.sdkMethodsAtPath.join(", ")}`,
    ),
    ...listOrNone(
      sdkPathOverlaps,
      (entry) =>
        `- SDK \`${entry.method} ${entry.path}\`; OpenAPI methods at path: ${entry.openApiMethods.join(", ")}`,
    ),
    "",
    "## SDK-only Connect endpoints",
    "",
    ...listOrNone(sdkOnly, (entry) => `- \`${entry.method} ${entry.path}\` → \`${entry.action}\``),
    "",
    "## SDK-stricter parameters",
    "",
    ...listOrNone(
      sdkStricter,
      (entry) => `- \`${entry.key}\` → \`${entry.action}\`: ${entry.sdkStricter.join(", ")}`,
    ),
    "",
    "## Parameter drift",
    "",
    ...listOrNone(parameterDrift, (entry) => {
      const details = [
        entry.missingRequired?.length
          ? `missing required: ${entry.missingRequired.join(", ")}`
          : "",
        entry.requirednessDrift?.length ? entry.requirednessDrift.join(", ") : "",
      ]
        .filter(Boolean)
        .join("; ");
      return `- \`${entry.key}\` → \`${entry.action}\`: ${details}`;
    }),
    "",
    "## Interpretation",
    "",
    "OpenAPI-only, SDK-only, adjusted, SDK-stricter, and drift classifications are evidence for review. SDK-stricter requirements are safer caller contracts, while drift means the SDK can still issue a request that omits an OpenAPI-required input. Live Salesforce behavior and reviewed SDK overlays remain explicit evidence when the published contract and service differ.",
    "",
  ].join("\n");
}

function listOrNone(values, render) {
  return values.length ? values.map(render) : ["None."];
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}
