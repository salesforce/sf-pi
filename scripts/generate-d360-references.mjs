#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Generate Data 360 phase reference documentation.
 *
 * These are plain reference docs, not Agent Skills. The data is generated from
 * the phase and operation registries so the Data 360 action map stays
 * reviewable without injecting a large skill pack into every agent session.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { format, resolveConfig } from "prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const REGISTRY_DIR = path.join(ROOT, "extensions/sf-data360/registry");
const REFERENCES_DIR = path.join(ROOT, "extensions/sf-data360/references/phases");
const CHECK = process.argv.includes("--check");

const phases = readJson("phases.json");
const families = readJson("families.json");
const operations = readJson("operations.json");
const runbooks = readJson("runbooks.json");
const v2Actions = readJson("v2/actions.json");

validatePhases(phases, families, operations);

const generated = buildReferenceFiles({ phases, families, operations, runbooks, v2Actions });
const prettierOptions = {
  printWidth: 100,
  ...((await resolveConfig(path.join(ROOT, "package.json"))) ?? {}),
};

for (const file of generated) {
  file.content = await format(file.content, { ...prettierOptions, parser: "markdown" });
}

if (CHECK) {
  const mismatches = generated.filter((file) => readExisting(file.path) !== file.content);
  if (mismatches.length) {
    console.error(
      `❌ Data 360 phase references are out of date: ${mismatches
        .map((file) => path.relative(ROOT, file.path))
        .join(", ")}. Run: npm run generate-d360-references`,
    );
    process.exit(1);
  }
  console.log(`✅ d360 phase references are up to date (${generated.length} reference(s))`);
} else {
  mkdirSync(REFERENCES_DIR, { recursive: true });
  for (const file of generated) {
    mkdirSync(path.dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content, "utf8");
  }
  removeStaleGeneratedReferenceFiles(generated.map((file) => file.path));
  console.log(`✅ d360 phase references generated (${generated.length} reference(s))`);
}

function readJson(fileName) {
  return JSON.parse(readFileSync(path.join(REGISTRY_DIR, fileName), "utf8"));
}

function readExisting(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function validatePhases(phaseEntries, familyEntries, operationEntries) {
  const errors = [];
  const canonicalIds = [
    "connect",
    "prepare",
    "harmonize",
    "segment",
    "act",
    "retrieve",
    "semantic",
    "observe",
    "orchestrate",
  ];
  const ids = phaseEntries.map((phase) => phase.id);
  if (!isDeepStrictEqual(ids, canonicalIds)) {
    errors.push(`phases.json must declare canonical phases in order: ${canonicalIds.join(", ")}.`);
  }

  const familyNames = new Set((familyEntries ?? []).map((family) => family.name));
  const operationNames = new Set((operationEntries ?? []).map((operation) => operation.name));
  const assignedFamilies = new Map();
  const assignedOperations = new Map();

  for (const phase of phaseEntries) {
    if (!phase.description || phase.description.length > 1024) {
      errors.push(`Phase ${phase.id} description must be present and <= 1024 chars.`);
    }
    for (const family of phase.familyDefaults ?? []) {
      if (!familyNames.has(family))
        errors.push(`Phase ${phase.id} references unknown family ${family}.`);
      const previous = assignedFamilies.get(family);
      if (previous) errors.push(`Family ${family} assigned to both ${previous} and ${phase.id}.`);
      assignedFamilies.set(family, phase.id);
    }
    for (const operationName of phase.operationOverrides ?? []) {
      if (!operationNames.has(operationName)) {
        errors.push(`Phase ${phase.id} references unknown operation ${operationName}.`);
      }
      const previous = assignedOperations.get(operationName);
      if (previous)
        errors.push(`Operation ${operationName} assigned to both ${previous} and ${phase.id}.`);
      assignedOperations.set(operationName, phase.id);
    }
  }

  for (const operation of operationEntries) {
    const phase = assignedOperations.get(operation.name) ?? assignedFamilies.get(operation.family);
    if (!phase) errors.push(`Operation ${operation.name} has no Data 360 phase assignment.`);
  }

  if (errors.length) {
    for (const error of errors) console.error(`❌ ${error}`);
    throw new Error(`d360 phase validation failed with ${errors.length} error(s).`);
  }
}

function buildReferenceFiles({
  phases: phaseEntries,
  families: familyEntries,
  operations: operationEntries,
  runbooks: runbookEntries,
  v2Actions: actionEntries,
}) {
  const familyByName = new Map(familyEntries.map((family) => [family.name, family]));
  const phaseByOperation = buildPhaseByOperation(phaseEntries);
  const phaseByFamily = buildPhaseByFamily(phaseEntries);
  const operationsByPhase = new Map(phaseEntries.map((phase) => [phase.id, []]));
  const runbooksByPhase = new Map(phaseEntries.map((phase) => [phase.id, []]));
  const actionsByPhase = new Map(phaseEntries.map((phase) => [phase.id, []]));

  for (const operation of operationEntries) {
    const phaseId = phaseByOperation.get(operation.name) ?? phaseByFamily.get(operation.family);
    operationsByPhase.get(phaseId)?.push(operation);
  }

  for (const runbook of runbookEntries) {
    const phaseId = phaseByFamily.get(runbook.family);
    if (phaseId) runbooksByPhase.get(phaseId)?.push(runbook);
  }

  for (const action of actionEntries) {
    if (actionsByPhase.has(action.phase)) actionsByPhase.get(action.phase)?.push(action);
  }

  return phaseEntries.map((phase) => ({
    path: path.join(REFERENCES_DIR, `${phase.id}.md`),
    content: renderReference({
      phase,
      phases: phaseEntries,
      familyByName,
      operations: operationsByPhase.get(phase.id) ?? [],
      runbooks: runbooksByPhase.get(phase.id) ?? [],
      actions: actionsByPhase.get(phase.id) ?? [],
    }),
  }));
}

function buildPhaseByOperation(phaseEntries) {
  const map = new Map();
  for (const phase of phaseEntries) {
    for (const operationName of phase.operationOverrides ?? []) map.set(operationName, phase.id);
  }
  return map;
}

function buildPhaseByFamily(phaseEntries) {
  const map = new Map();
  for (const phase of phaseEntries) {
    for (const family of phase.familyDefaults ?? []) map.set(family, phase.id);
  }
  return map;
}

function renderReference({ phase, phases, familyByName, operations, runbooks, actions }) {
  const phaseTitle = `Data 360 ${phase.label} Reference`;
  const familyNames = [...new Set(operations.map((operation) => operation.family))].sort();
  const safetyCounts = countBy(operations, "safety");
  const recommendedActions = selectRecommendedActions(actions, runbooks);
  const generatedNotice =
    "Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand.";

  return `<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- ${generatedNotice} -->

# ${phaseTitle}

${phase.summary}

## Use this reference when

${phase.description}

## Tool discipline

1. Use the matching \`data360_*\` family tool for this phase.
2. Use \`actions.search\` when the exact action is unclear.
3. Use \`action.describe\` and \`examples.get\` before complex or mutating calls.
4. Use \`dry_run: true\` before confirmed/destructive actions and review the resolved request.
5. Use \`data360_api\` only as the raw REST escape hatch when no family action fits.
6. Keep broad results bounded with \`output_mode: "summary"\` or \`"file_only"\`.
7. Promote repeated fallback paths into tested Data 360 family actions or journeys.

## Phase coverage

${renderCoverage({ familyNames, familyByName, operations, runbooks, safetyCounts })}

## Data 360 family actions

${renderRecommendedActions(recommendedActions)}

## Cross-phase routing

${renderPhaseMap(phases)}

## Upstream reference fallback

If this generated reference and the local sf-data360 references are insufficient, inspect the public upstream Data 360 reference repository for operation and payload-shape metadata, then curate findings into Pi-native \`data360_*\` family actions.
`;
}

function renderCoverage({ familyNames, familyByName, operations, runbooks, safetyCounts }) {
  const familyLines = familyNames.length
    ? familyNames
        .map((familyName) => {
          const family = familyByName.get(familyName);
          return `- **${familyName}** — ${family?.summary ?? "Data 360 operations."}`;
        })
        .join("\n")
    : "- Cross-phase orchestration reference. Use the phase map below to route work.";

  return `${familyLines}

- Capabilities: ${operations.length + runbooks.length} (${runbooks.length} runbook-backed)
- Safety mix: read=${safetyCounts.read ?? 0}, safe_post=${safetyCounts.safe_post ?? 0}, confirmed=${safetyCounts.confirmed ?? 0}, destructive=${safetyCounts.destructive ?? 0}`;
}

function selectRecommendedActions(actions, runbooks) {
  const runbookNames = new Set(runbooks.map((runbook) => runbook.name));
  return actions
    .map((action) => ({
      action: action.action,
      tool: action.tool,
      capability: action.capability,
      kind:
        action.implementation?.kind ??
        (runbookNames.has(action.capability) ? "runbook" : "rest_operation"),
      safety: action.safety,
      description: action.description,
    }))
    .sort((a, b) => actionRank(a) - actionRank(b) || a.action.localeCompare(b.action))
    .slice(0, 8);
}

function actionRank(action) {
  if (action.kind === "runbook") return 0;
  if (action.safety === "read") return 1;
  if (action.safety === "safe_post") return 2;
  if (action.kind === "local") return 3;
  return 4;
}

function renderRecommendedActions(actions) {
  if (!actions.length)
    return "Use this orchestration reference to choose the right phase, then discover family actions with `actions.search`.";
  return actions
    .map(
      (action) =>
        `- \`${action.tool}\` \`${action.action}\` (${action.kind}, ${action.safety}) — ${action.description}`,
    )
    .join("\n");
}

function renderPhaseMap(phases) {
  return [
    "| Phase | Reference | Summary |",
    "| --- | --- | --- |",
    ...phases.map(
      (entry) =>
        `| ${entry.label} | \`references/phases/${entry.id}.md\` | ${escapeTable(entry.summary)} |`,
    ),
  ].join("\n");
}

function countBy(entries, key) {
  const counts = {};
  for (const entry of entries) counts[entry[key]] = (counts[entry[key]] ?? 0) + 1;
  return counts;
}

function escapeTable(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function removeStaleGeneratedReferenceFiles(currentFiles) {
  const current = new Set(currentFiles.map((file) => path.resolve(file)));
  for (const phase of phases) {
    const file = path.join(REFERENCES_DIR, `${phase.id}.md`);
    if (!current.has(path.resolve(file))) rmSync(file, { force: true });
  }
}
