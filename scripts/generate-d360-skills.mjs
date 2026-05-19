#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Generate the extension-owned Data 360 phase skill pack.
 *
 * The phase skills are committed so pi can discover them through the normal
 * resources_discover skill path. This generator keeps the repeated operation
 * coverage data-driven while letting humans review the generated markdown.
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
const SKILLS_DIR = path.join(ROOT, "extensions/sf-data360/skills");
const CHECK = process.argv.includes("--check");

const phases = readJson("phases.json");
const families = readJson("families.json");
const operations = readJson("operations.json");
const runbooks = readJson("runbooks.json");

validatePhases(phases, families, operations);

const generated = buildSkillFiles({ phases, families, operations, runbooks });
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
      `❌ Data 360 phase skills are out of date: ${mismatches
        .map((file) => path.relative(ROOT, file.path))
        .join(", ")}. Run: npm run generate-d360-skills`,
    );
    process.exit(1);
  }
  console.log(`✅ d360 phase skills are up to date (${generated.length} skill(s))`);
} else {
  for (const file of generated) {
    mkdirSync(path.dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content, "utf8");
  }
  removeStaleGeneratedSkillDirs(generated.map((file) => path.dirname(file.path)));
  console.log(`✅ d360 phase skills generated (${generated.length} skill(s))`);
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
    "observe",
    "orchestrate",
  ];
  const ids = phaseEntries.map((phase) => phase.id);
  if (!isDeepStrictEqual(ids, canonicalIds)) {
    errors.push(`phases.json must declare canonical phases in order: ${canonicalIds.join(", ")}.`);
  }

  const familyNames = new Set(familyEntries.map((family) => family.name));
  const operationNames = new Set(operationEntries.map((operation) => operation.name));
  const assignedFamilies = new Map();
  const assignedOperations = new Map();

  for (const phase of phaseEntries) {
    if (!phase.skillName?.startsWith("sf-data360-")) {
      errors.push(`Phase ${phase.id} skillName must start with sf-data360-.`);
    }
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
      if (previous) {
        errors.push(`Operation ${operationName} assigned to both ${previous} and ${phase.id}.`);
      }
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

function buildSkillFiles({
  phases: phaseEntries,
  families: familyEntries,
  operations: operationEntries,
  runbooks: runbookEntries,
}) {
  const familyByName = new Map(familyEntries.map((family) => [family.name, family]));
  const phaseByOperation = buildPhaseByOperation(phaseEntries);
  const phaseByFamily = buildPhaseByFamily(phaseEntries);
  const operationsByPhase = new Map(phaseEntries.map((phase) => [phase.id, []]));
  const runbooksByPhase = new Map(phaseEntries.map((phase) => [phase.id, []]));

  for (const operation of operationEntries) {
    const phaseId = phaseByOperation.get(operation.name) ?? phaseByFamily.get(operation.family);
    operationsByPhase.get(phaseId)?.push(operation);
  }

  for (const runbook of runbookEntries) {
    const phaseId = phaseByFamily.get(runbook.family);
    if (phaseId) runbooksByPhase.get(phaseId)?.push(runbook);
  }

  return phaseEntries.map((phase) => ({
    path: path.join(SKILLS_DIR, phase.skillName, "SKILL.md"),
    content: renderSkill({
      phase,
      phases: phaseEntries,
      familyByName,
      operations: operationsByPhase.get(phase.id) ?? [],
      runbooks: runbooksByPhase.get(phase.id) ?? [],
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

function renderSkill({ phase, phases, familyByName, operations, runbooks }) {
  const phaseTitle = `SF Data 360 — ${phase.label}`;
  const familyNames = [...new Set(operations.map((operation) => operation.family))].sort();
  const safetyCounts = countBy(operations, "safety");
  const recommendedCapabilities = selectRecommendedCapabilities(operations, runbooks);
  const generatedNotice =
    "Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand.";

  return `---
name: ${phase.skillName}
description: ${phase.description}
---

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- ${generatedNotice} -->

# ${phaseTitle}

${phase.summary}

## Use this skill when

${phase.description}

## Tool discipline

1. Use \`d360_probe\` first when org readiness is uncertain.
2. Use \`d360\` action=\`search\` to find matching D360 capabilities.
3. Use \`d360\` action=\`examples\` with a capability before complex or mutating calls.
4. Use \`d360\` action=\`execute\` with that capability and reviewed params.
5. Use \`d360_api\` only as the raw REST escape hatch when no capability fits.
6. Keep broad results bounded with \`output_mode: "summary"\` or \`"file_only"\`.
7. Promote repeated fallback paths into tested D360 capabilities.

## Phase coverage

${renderCoverage({ familyNames, familyByName, operations, runbooks, safetyCounts })}

## D360 capabilities

${renderRecommendedCapabilities(recommendedCapabilities)}

## Cross-phase routing

${renderPhaseMap(phases)}

## Upstream reference fallback

If this generated skill and the local sf-data360 references are insufficient, inspect the public upstream Data 360 MCP server repository for reference material. Do not run or embed the upstream Java MCP server from this extension.
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
    : "- Cross-phase orchestration skill. Use the phase map below to route work.";

  return `${familyLines}

- Capabilities: ${operations.length + runbooks.length} (${runbooks.length} runbook-backed)
- Safety mix: read=${safetyCounts.read ?? 0}, safe_post=${safetyCounts.safe_post ?? 0}, confirmed=${safetyCounts.confirmed ?? 0}, destructive=${safetyCounts.destructive ?? 0}`;
}

function selectRecommendedCapabilities(operations, runbooks) {
  return [
    ...runbooks.map((runbook) => ({
      name: runbook.name,
      kind: "runbook",
      safety: "read",
      description: runbook.description,
    })),
    ...operations.map((operation) => ({
      name: operation.name,
      kind: operation.path.startsWith("/local/") ? "local_helper" : "rest_operation",
      safety: operation.safety,
      description: operation.description,
    })),
  ]
    .sort((a, b) => capabilityRank(a) - capabilityRank(b) || a.name.localeCompare(b.name))
    .slice(0, 6);
}

function capabilityRank(capability) {
  if (capability.kind === "runbook") return 0;
  if (capability.safety === "read") return 1;
  if (capability.safety === "safe_post") return 2;
  if (capability.kind === "local_helper") return 3;
  return 4;
}

function renderRecommendedCapabilities(capabilities) {
  if (!capabilities.length) {
    return "Use this orchestration skill to choose the right phase, then discover D360 capabilities with `d360` action=`search`.";
  }
  return capabilities
    .map(
      (capability) =>
        `- \`${capability.name}\` (${capability.kind}, ${capability.safety}) — ${capability.description}`,
    )
    .join("\n");
}

function renderPhaseMap(phases) {
  return [
    "| Phase | Skill | Summary |",
    "| --- | --- | --- |",
    ...phases.map(
      (entry) => `| ${entry.label} | \`${entry.skillName}\` | ${escapeTable(entry.summary)} |`,
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

function removeStaleGeneratedSkillDirs(currentDirs) {
  const current = new Set(currentDirs.map((dir) => path.resolve(dir)));
  for (const phase of phases) {
    const dir = path.join(SKILLS_DIR, phase.skillName);
    if (!current.has(path.resolve(dir))) rmSync(dir, { recursive: true, force: true });
  }
}
