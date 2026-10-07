#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/** Compare the official upstream operation snapshot to the sf_data360 action catalog. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { format, resolveConfig } from "prettier";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryDir = path.join(root, "extensions/sf-data360/registry");
const referencePath = path.join(root, "extensions/sf-data360/references/action-parity.md");
const check = process.argv.includes("--check");
const upstream = readJson("upstream-tools.json");
const upstreamPayloadExamples = readJson("upstream-payload-examples.json");
const examples = readJson("examples.json");
const actions = readJson("actions.json");
const upstreamNames = new Set(upstream.tools.map((tool) => tool.name));

const entries = upstream.tools.map((tool) => {
  const action = actions.find(
    (candidate) =>
      candidate.operationId === tool.name || candidate.operationAliases?.includes(tool.name),
  );
  return {
    upstreamName: tool.name,
    upstreamFamily: tool.family,
    upstreamMethod: tool.method,
    upstreamPath: tool.path,
    status: action ? "supported" : "missing",
    ...(action
      ? {
          action: action.action,
          namespace: action.namespace,
          method: action.endpoint?.method,
          path: action.endpoint?.path,
          safety: action.safety,
          shape: sameShape(tool, action) ? "exact" : "adjusted",
        }
      : {}),
  };
});
const missing = entries.filter((entry) => entry.status === "missing");
const extras = actions
  .filter((action) => !action.operationId || !upstreamNames.has(action.operationId))
  .map((action) => ({
    action: action.action,
    namespace: action.namespace,
    operationId: action.operationId,
    implementation: action.implementation?.kind ?? "endpoint_extension",
    safety: action.safety,
  }));
const payloadKeys = Object.keys(upstreamPayloadExamples ?? {});
const exactPayloads = payloadKeys.filter((key) => Boolean(examples[key]));
const variantPayloads = payloadKeys.filter(
  (key) =>
    !examples[key] &&
    Object.values(examples).some((example) =>
      Object.values(record(record(example).variants)).some(
        (variant) => record(variant).sourceExample === key,
      ),
    ),
);
const missingPayloads = payloadKeys.filter(
  (key) => !exactPayloads.includes(key) && !variantPayloads.includes(key),
);
const report = JSON.parse(
  JSON.stringify({
    generatedAt: upstream.capturedAt,
    upstream: {
      source: upstream.source,
      capturedAt: upstream.capturedAt,
      commit: upstream.commit,
      count: upstream.count,
    },
    summary: {
      upstreamTools: entries.length,
      supportedUpstreamTools: entries.length - missing.length,
      missingUpstreamTools: missing.length,
      actionCount: actions.length,
      extraActions: extras.length,
      exactShapes: entries.filter((entry) => entry.shape === "exact").length,
      adjustedShapes: entries.filter((entry) => entry.shape === "adjusted").length,
      payloadExamples: {
        upstreamPayloadExamples: payloadKeys.length,
        exactPayloadExamples: exactPayloads.length,
        variantPayloadExamples: variantPayloads.length,
        missingPayloadExamples: missingPayloads.length,
        missing: missingPayloads,
      },
    },
    entries,
    extras,
  }),
);
const prettierOptions = {
  printWidth: 100,
  ...((await resolveConfig(path.join(root, "package.json"))) ?? {}),
};
const json = await format(JSON.stringify(report), { ...prettierOptions, parser: "json" });
const markdown = await format(renderMarkdown(report), { ...prettierOptions, parser: "markdown" });
const jsonPath = path.join(registryDir, "upstream-parity.json");
if (check) {
  const failures = [];
  if (!isDeepStrictEqual(JSON.parse(readFileSync(jsonPath, "utf8")), report))
    failures.push(jsonPath);
  if (readFileSync(referencePath, "utf8") !== markdown) failures.push(referencePath);
  if (failures.length) {
    console.error(`❌ Data 360 action parity artifacts are stale: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(
    `✅ sf_data360 covers ${report.summary.supportedUpstreamTools}/${report.summary.upstreamTools} upstream operations`,
  );
} else {
  writeFileSync(jsonPath, json, "utf8");
  writeFileSync(referencePath, markdown, "utf8");
  console.log(
    `✅ Generated sf_data360 action parity (${report.summary.supportedUpstreamTools}/${report.summary.upstreamTools})`,
  );
}

function readJson(file) {
  return JSON.parse(readFileSync(path.join(registryDir, file), "utf8"));
}
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function normalizePath(value) {
  return value == null ? value : String(value).replaceAll(/\{[^}]+\}/g, "{}");
}
function sameShape(tool, action) {
  return (
    tool.method === action.endpoint?.method &&
    normalizePath(tool.path) === normalizePath(action.endpoint?.path)
  );
}
function renderMarkdown(value) {
  const lines = [
    "# SF Data 360 Action Parity",
    "",
    "This generated report compares the official public Data 360 operation snapshot with the single `sf_data360` business action catalog.",
    "",
    `- Snapshot: ${value.upstream.source}`,
    `- Commit: ${value.upstream.commit}`,
    `- Upstream operations: ${value.summary.upstreamTools}`,
    `- Supported: ${value.summary.supportedUpstreamTools}`,
    `- Missing: ${value.summary.missingUpstreamTools}`,
    `- SF Data 360 actions: ${value.summary.actionCount}`,
    `- Exact endpoint shapes: ${value.summary.exactShapes}`,
    `- Adjusted endpoint shapes: ${value.summary.adjustedShapes}`,
    `- Payload examples: ${value.summary.payloadExamples.upstreamPayloadExamples} (${value.summary.payloadExamples.missingPayloadExamples} missing)`,
    "",
    "## Missing operations",
    "",
    ...(value.summary.missingUpstreamTools
      ? value.entries
          .filter((entry) => entry.status === "missing")
          .map((entry) => `- ${entry.upstreamName}`)
      : ["None."]),
    "",
    "## Contract",
    "",
    "Every known upstream operation maps to one `sf_data360` action. Additional actions provide discovery, direct Query API V3, tenant ingestion, local helpers, observability, and orchestration. Runtime MCP or Java fallback is not used.",
    "",
  ];
  return lines.join("\n");
}
