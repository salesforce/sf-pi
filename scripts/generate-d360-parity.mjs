#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Generate a parity report between the upstream Data 360 reference catalog and
 * sf-pi's d360 facade registry.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { format, resolveConfig } from "prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const REGISTRY_DIR = path.join(ROOT, "extensions/sf-data360/registry");
const REFERENCES_DIR = path.join(ROOT, "extensions/sf-data360/references");
const CHECK = process.argv.includes("--check");

const upstreamSnapshot = readJson(path.join(REGISTRY_DIR, "upstream-tools.json"));
const upstreamPayloadExamples = readJson(path.join(REGISTRY_DIR, "upstream-payload-examples.json"));
const operations = readJson(path.join(REGISTRY_DIR, "operations.json"));
const examples = readJson(path.join(REGISTRY_DIR, "examples.json"));

const report = buildReport(upstreamSnapshot, operations, examples, upstreamPayloadExamples);
const prettierOptions = {
  printWidth: 100,
  ...((await resolveConfig(path.join(ROOT, "package.json"))) ?? {}),
};
const reportJson = await format(JSON.stringify(report), { ...prettierOptions, parser: "json" });
const markdown = await format(buildMarkdown(report), { ...prettierOptions, parser: "markdown" });

const jsonPath = path.join(REGISTRY_DIR, "upstream-parity.json");
const markdownPath = path.join(REFERENCES_DIR, "upstream-parity.md");

if (CHECK) {
  const currentJson = readJson(jsonPath);
  const currentMarkdown = readText(markdownPath);
  const errors = [];
  if (!isDeepStrictEqual(currentJson, report)) errors.push("upstream-parity.json");
  if (currentMarkdown !== markdown) errors.push("references/upstream-parity.md");
  if (errors.length) {
    console.error(
      `❌ Data 360 parity artifacts out of date: ${errors.join(", ")}. Run: npm run generate-d360-parity`,
    );
    process.exit(1);
  }
  console.log(
    `✅ d360 upstream parity is up to date (${report.summary.upstreamTools} upstream tool(s))`,
  );
} else {
  writeFileSync(jsonPath, reportJson, "utf8");
  writeFileSync(markdownPath, markdown, "utf8");
  console.log(
    `✅ d360 upstream parity generated (${report.summary.upstreamTools} upstream tool(s))`,
  );
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return readFileSync(filePath, "utf8");
}

function buildReport(upstream, facadeOperations, facadeExamples, upstreamPayloadExamples) {
  const facadeByName = new Map(facadeOperations.map((operation) => [operation.name, operation]));
  const upstreamNames = new Set(upstream.tools.map((tool) => tool.name));
  const entries = upstream.tools.map((tool) => {
    const operation = facadeByName.get(tool.name);
    if (!operation) {
      return {
        upstreamName: tool.name,
        upstreamFamily: tool.family,
        upstreamMethod: tool.method,
        upstreamPath: tool.path,
        status: "missing",
      };
    }
    const kind = classifyKind(operation, tool);
    return {
      upstreamName: tool.name,
      upstreamFamily: tool.family,
      upstreamMethod: tool.method,
      upstreamPath: tool.path,
      facadeOperation: operation.name,
      facadeFamily: operation.family,
      facadeMethod: operation.method,
      facadePath: operation.path,
      safety: operation.safety,
      kind,
      status: "supported",
      hasExample: Boolean(facadeExamples[operation.name]),
      notes: parityNotes(tool, operation, kind),
    };
  });

  const extras = facadeOperations
    .filter((operation) => !upstreamNames.has(operation.name))
    .map((operation) => ({
      facadeOperation: operation.name,
      facadeFamily: operation.family,
      facadeMethod: operation.method,
      facadePath: operation.path,
      safety: operation.safety,
      kind: classifyExtra(operation),
      hasExample: Boolean(facadeExamples[operation.name]),
      notes: extraNotes(operation),
    }));

  const byStatus = countBy(entries, "status");
  const byKind = countBy(entries, "kind");
  const bySafety = countBy(
    entries.filter((entry) => entry.safety),
    "safety",
  );
  const extrasByKind = countBy(extras, "kind");
  const missing = entries.filter((entry) => entry.status === "missing");
  const payloadExamples = buildPayloadExampleSummary(upstreamPayloadExamples, facadeExamples);

  return {
    generatedAt: upstream.capturedAt,
    upstream: {
      source: upstream.source,
      capturedAt: upstream.capturedAt,
      count: upstream.count,
    },
    summary: {
      upstreamTools: upstream.tools.length,
      supportedUpstreamTools: entries.length - missing.length,
      missingUpstreamTools: missing.length,
      facadeOperations: facadeOperations.length,
      facadeExtras: extras.length,
      byStatus,
      byKind,
      bySafety,
      extrasByKind,
      payloadExamples,
    },
    entries,
    extras,
  };
}

function buildPayloadExampleSummary(upstreamPayloadExamples, facadeExamples) {
  const upstreamKeys = Object.keys(upstreamPayloadExamples ?? {});
  const exact = upstreamKeys.filter((key) => Boolean(facadeExamples[key]));
  const variants = upstreamKeys.filter(
    (key) => !facadeExamples[key] && findVariantBySourceExample(facadeExamples, key),
  );
  const missing = upstreamKeys.filter(
    (key) => !facadeExamples[key] && !findVariantBySourceExample(facadeExamples, key),
  );
  return {
    upstreamPayloadExamples: upstreamKeys.length,
    exactPayloadExamples: exact.length,
    variantPayloadExamples: variants.length,
    missingPayloadExamples: missing.length,
    missing,
  };
}

function findVariantBySourceExample(facadeExamples, sourceExample) {
  for (const example of Object.values(facadeExamples ?? {})) {
    const variants = asRecord(asRecord(example)?.variants);
    if (!variants) continue;
    for (const value of Object.values(variants)) {
      if (asRecord(value)?.sourceExample === sourceExample) return value;
    }
  }
  return undefined;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function classifyKind(operation, upstreamTool) {
  if (operation.path.startsWith("/local/")) return "local_helper";
  if (operation.safety === "destructive") return "destructive_rest";
  if (
    normalizePath(operation.path) !== normalizePath(upstreamTool.path) ||
    operation.method !== upstreamTool.method
  ) {
    return "rest_adjusted";
  }
  return "rest";
}

function normalizePath(pathText) {
  if (pathText === null || pathText === undefined) return pathText;
  return String(pathText).replaceAll(/\{[^}]+\}/g, "{}");
}

function classifyExtra(operation) {
  if (operation.path.startsWith("/local/")) return "local_helper";
  if (operation.name.endsWith("s_list") || operation.name.includes("_describe")) return "alias";
  if (operation.safety === "destructive") return "destructive_rest";
  return "facade_extension";
}

function parityNotes(tool, operation, kind) {
  const notes = [];
  if (kind === "local_helper") notes.push("Local deterministic helper, not a REST request.");
  if (kind === "destructive_rest")
    notes.push("Requires AgentforceSTDM target, allow_confirmed, and interactive Pi confirmation.");
  if (kind === "rest_adjusted")
    notes.push("Facade REST shape differs from upstream catalog snapshot; see facadePath.");
  if (operation.safety === "confirmed")
    notes.push("Requires dry-run review before allow_confirmed execution.");
  if (tool.method === null) notes.push("Upstream helper has no direct HTTP method/path.");
  return notes;
}

function extraNotes(operation) {
  if (operation.path.startsWith("/local/")) return ["Facade local helper entry."];
  if (operation.name.endsWith("s_list") || operation.name.includes("_describe")) {
    return ["Compatibility alias retained for existing sf-pi workflows."];
  }
  if (operation.safety === "destructive") {
    return ["Destructive facade operation with AgentforceSTDM + HIL guardrails."];
  }
  return ["Facade-specific compatibility or observability operation."];
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key] ?? "unknown";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function buildMarkdown(report) {
  const lines = [
    "# Data 360 Upstream Parity",
    "",
    "This generated report compares the public upstream Data 360 reference catalog to the sf-pi `d360` facade registry.",
    "",
    `Generated from upstream snapshot: ${report.upstream.source}`,
    `Snapshot date: ${report.upstream.capturedAt}`,
    "",
    "## Summary",
    "",
    `- Upstream tools: ${report.summary.upstreamTools}`,
    `- Supported upstream tools: ${report.summary.supportedUpstreamTools}`,
    `- Missing upstream tools: ${report.summary.missingUpstreamTools}`,
    `- Facade registry operations: ${report.summary.facadeOperations}`,
    `- Facade extras / aliases: ${report.summary.facadeExtras}`,
    `- Upstream payload examples: ${report.summary.payloadExamples.upstreamPayloadExamples}`,
    `- Payload examples covered exactly: ${report.summary.payloadExamples.exactPayloadExamples}`,
    `- Payload examples covered as variants: ${report.summary.payloadExamples.variantPayloadExamples}`,
    `- Missing payload examples: ${report.summary.payloadExamples.missingPayloadExamples}`,
    "",
    "### Supported upstream tools by kind",
    "",
    markdownCountTable(report.summary.byKind, [
      "rest",
      "rest_adjusted",
      "local_helper",
      "destructive_rest",
    ]),
    "",
    "### Supported upstream tools by safety",
    "",
    markdownCountTable(report.summary.bySafety, ["read", "safe_post", "confirmed", "destructive"]),
    "",
    "### Facade extras by kind",
    "",
    markdownCountTable(report.summary.extrasByKind, [
      "alias",
      "facade_extension",
      "local_helper",
      "destructive_rest",
    ]),
    "",
    "## Missing upstream tools",
    "",
    report.summary.missingUpstreamTools === 0
      ? "All upstream tools in the snapshot have an exact facade entry."
      : report.entries
          .filter((entry) => entry.status === "missing")
          .map((entry) => `- ${entry.upstreamName}`)
          .join("\n"),
    "",
    "## Changed or adjusted REST shapes",
    "",
    renderAdjustedEntries(report.entries),
    "",
    "## Local compatibility / extension entries",
    "",
    renderExtras(report.extras),
    "",
    "## Notes",
    "",
    "- `rest_adjusted` means sf-pi intentionally uses a REST shape that differs from the imported upstream catalog snapshot. Review adjusted entries before assuming upstream parity.",
    "- `local_helper` means the operation is deterministic local logic, not a Salesforce REST call.",
    "- `destructive_rest` operations require dry-run review, `allow_confirmed: true`, and Guardrail mediation before execution.",
    "- Facade extras include compatibility aliases and sf-pi-specific convenience entries; this is why facade operation count can exceed upstream tool count.",
    "- Full operation-level detail is stored in `extensions/sf-data360/registry/upstream-parity.json`.",
    "",
  ];
  return lines.join("\n");
}

function markdownCountTable(counts, order) {
  const rows = order.filter((key) => counts[key]).map((key) => `| ${key} | ${counts[key]} |`);
  const extras = Object.keys(counts)
    .filter((key) => !order.includes(key))
    .sort()
    .map((key) => `| ${key} | ${counts[key]} |`);
  return ["| Kind | Count |", "| --- | ---: |", ...rows, ...extras].join("\n");
}

function renderAdjustedEntries(entries) {
  const adjusted = entries.filter((entry) => entry.kind === "rest_adjusted");
  if (!adjusted.length)
    return "No upstream-supported operations currently use adjusted REST shapes.";
  return [
    "| Upstream tool | Upstream | Facade | Safety |",
    "| --- | --- | --- | --- |",
    ...adjusted.map((entry) =>
      row([
        entry.upstreamName,
        `${entry.upstreamMethod} ${entry.upstreamPath}`,
        `${entry.facadeMethod} ${entry.facadePath}`,
        entry.safety,
      ]),
    ),
  ].join("\n");
}

function renderExtras(extras) {
  if (!extras.length) return "No local compatibility or extension entries.";
  return [
    "| Facade operation | Family | Kind | Safety |",
    "| --- | --- | --- | --- |",
    ...extras.map((entry) =>
      row([entry.facadeOperation, entry.facadeFamily, entry.kind, entry.safety]),
    ),
  ].join("\n");
}

function row(values) {
  return `| ${values.map(escapeCell).join(" | ")} |`;
}

function escapeCell(value) {
  return String(value ?? "—").replaceAll("|", "\\|");
}
