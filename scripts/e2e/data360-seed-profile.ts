#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/** Discover bounded org-local assets and write a private sf_data360 seed profile. */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { detectEnvironment } from "../../lib/common/sf-environment/detect.ts";
import { runSfData360Action } from "../../extensions/sf-data360/lib/sdk.ts";
import { buildData360SeedProfile, type Data360DiscoveredAssets } from "./data360/seed-profile.ts";

interface Options {
  targetOrg: string;
  output: string;
  dataKitDevName?: string;
  componentType: string;
  profileModel?: string;
  profileFilter?: string;
  profileFields?: string;
}

const options = parseArgs(process.argv.slice(2));
if (!options.targetOrg || !options.output) {
  console.error(
    "Usage: node --experimental-strip-types scripts/e2e/data360-seed-profile.ts --target-org <alias> --output <private-json> [--data-kit-dev-name <name>] [--component-type DataStreamBundle] [--profile-model <name> --profile-filter <filter> --profile-fields <fields>]",
  );
  process.exit(2);
}
const outputPath = path.resolve(options.output);
const workspaceRelative = path.relative(process.cwd(), outputPath);
if (!workspaceRelative.startsWith("..") && !path.isAbsolute(workspaceRelative)) {
  throw new Error("Data 360 seed profiles must be written outside the repository workspace.");
}
const env = await detectEnvironment(exec, process.cwd());
const ctx = { cwd: process.cwd(), hasUI: false } as ExtensionContext;
const call = async (
  action: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> => {
  try {
    return await runSfData360Action(
      { action, params, target_org: options.targetOrg, timeout_ms: 180_000 },
      env,
      ctx,
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

const roots = new Map<string, Record<string, unknown>>();
for (const [key, action, params] of rootDiscovery()) {
  roots.set(key, await call(action, params));
}
const response = (key: string): Record<string, unknown> => recordValue(roots.get(key)?.response);
const assets: Data360DiscoveredAssets = {
  dataspace: firstRecord(response("dataspaces").dataSpaces),
  dlo: preferredRecord(response("dlos").dataLakeObjects, "AiAgentSession__dll"),
  dmo: preferredRecord(response("dmos").dataModelObject, "ssot__AiAgentSession__dlm"),
  stream: firstRecord(response("streams").dataStreams),
  transform: firstRecord(response("transforms").dataTransforms),
  identityResolution: firstRecord(response("identityResolutions").identityResolutions),
  calculatedInsight: firstRecord(recordValue(response("calculatedInsights").collection).items),
  segment: firstRecord(response("segments").segments),
  activationTarget: firstRecord(response("activationTargets").activationTargets),
  activation: firstRecord(response("activations").activations),
  dataActionTarget: firstRecord(response("dataActionTargets").dataActionTargets),
  dataAction: firstRecord(response("dataActions").dataActions),
  connection: firstRecord(response("connections").connections),
  profileModel:
    options.profileModel === undefined
      ? firstRecord(response("profileMetadata").metadata)
      : { name: options.profileModel },
  profileFilter: options.profileFilter,
  profileFields: options.profileFields,
  session: firstRecord(recordValue(recordValue(roots.get("sessions")?.result).data).rows),
  searchIndex: firstRecord(response("searchIndexes").semanticSearchDefinitionDetails),
  retriever: firstRecord(response("retrievers").retrievers),
  semanticModel: firstRecord(response("semanticModels").items),
  configuredModel: firstRecord(response("configuredModels").configuredModels),
  modelArtifact: firstRecord(response("modelArtifacts").modelArtifacts),
  modelSetup: firstRecord(response("modelSetups").modelSetups),
  predictionJobDefinition: firstRecord(response("predictionDefinitions").predictionJobDefinitions),
  dataKitDevName: options.dataKitDevName,
  dataKitComponentType: options.componentType,
};

assets.sourceFields = arrayValue(
  assets.dlo?.dataLakeFieldInfoRepresentation ?? assets.dlo?.fields,
).slice(0, 50);
assets.targetFields = arrayValue(assets.dmo?.fields).slice(0, 50);

if (assets.dmo) {
  const mapping = await call("harmonize.dmo_mapping.list", {
    dmoDeveloperName: assets.dmo.name,
    dataspace: "default",
  });
  assets.mapping = firstRecord(recordValue(mapping.response).objectSourceTargetMaps);
}
if (assets.session) {
  const timeline = await call("observe.stdm.session_timeline", {
    session_id: assets.session.session_id,
    limit: 20,
  });
  assets.interaction = firstRecord(recordValue(recordValue(timeline.result).data).rows);
}
const sql = await call("query.sql.run", {
  sql: 'SELECT COUNT(*) AS row_count FROM "ssot__AiAgentSession__dlm"',
  queryRowLimit: 2,
  transport: "connect",
});
assets.queryId = stringValue(recordValue(recordValue(sql.response).status).queryId);

const retrieverName = qualifiedName(assets.retriever);
if (retrieverName) {
  const configs = await call("semantic.retriever.config.list", {
    retrieverIdOrName: retrieverName,
  });
  assets.retrieverConfiguration = firstRecord(
    recordValue(configs.response).configurations ?? recordValue(configs.response).items,
  );
}
const modelApiName = stringValue(assets.semanticModel?.apiName);
if (modelApiName) {
  assets.semanticDataObject = await firstNested(
    call,
    "semantic.semantic_model.data_object.list",
    {
      modelApiNameOrId: modelApiName,
    },
    ["items", "dataObjects", "semanticDataObjects"],
  );
  assets.semanticMetric = await firstNested(
    call,
    "semantic.semantic_model.metric.list",
    {
      modelApiNameOrId: modelApiName,
    },
    ["items", "metrics"],
  );
  assets.semanticRelationship = await firstNested(
    call,
    "semantic.semantic_model.relationship.list",
    {
      modelApiNameOrId: modelApiName,
    },
    ["items", "relationships"],
  );
  assets.semanticCalculatedDimension = await firstNested(
    call,
    "semantic.semantic_model.calculated_dimension.list",
    { modelApiNameOrId: modelApiName },
    ["items", "calculatedDimensions"],
  );
  assets.semanticCalculatedMeasure = await firstNested(
    call,
    "semantic.semantic_model.calculated_measure.list",
    { modelApiNameOrId: modelApiName },
    ["items", "calculatedMeasurements", "calculatedMeasures"],
  );
}
const configuredModelName = qualifiedName(assets.configuredModel);
if (configuredModelName) {
  const history = await call("semantic.ml.configured_model.history.list", {
    idOrName: configuredModelName,
  });
  assets.configuredModelHistory = firstRecord(
    recordValue(history.response).items ?? recordValue(history.response).history,
  );
}

const fixtureDir = `${outputPath}.fixtures`;
mkdirSync(fixtureDir, { recursive: true, mode: 0o700 });
assets.csvPath = path.join(fixtureDir, "coverage.csv");
writeFileSync(assets.csvPath, "Id,Name,CreatedDate\n1,Example,2026-01-01T00:00:00Z\n", {
  mode: 0o600,
});
const connectionId = stringValue(assets.connection?.id);
if (connectionId) {
  assets.manifestPath = path.join(fixtureDir, "manifest.json");
  writeFileSync(
    assets.manifestPath,
    JSON.stringify(
      {
        source: { name: "PiCoverageSource", connectionId },
        datasets: [
          {
            csvPath: assets.csvPath,
            schemaName: "PiCoverageSchema",
            streamName: "PiCoverageStream",
            primaryKey: "Id",
            recordModifiedField: "CreatedDate",
          },
        ],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
const profile = buildData360SeedProfile(assets);
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(profile, null, 2), { mode: 0o600 });
console.log(`Data 360 seed profile wrote ${outputPath}`);
console.log(`Seeded actions: ${Object.keys(profile.actions ?? {}).length}`);

function rootDiscovery(): Array<[string, string, Record<string, unknown>]> {
  return [
    ["dataspaces", "prepare.dataspace.list", {}],
    ["dlos", "prepare.dlo.list", { limit: 100 }],
    ["dmos", "harmonize.dmo.list", { limit: 100 }],
    ["streams", "prepare.stream.list", { limit: 10 }],
    ["transforms", "prepare.transform.list", { limit: 10 }],
    ["identityResolutions", "harmonize.ir.list", { limit: 10 }],
    ["calculatedInsights", "segment.ci.list", { limit: 10 }],
    ["segments", "segment.list", { limit: 10 }],
    ["activationTargets", "activate.activation_target.list", { limit: 10 }],
    ["activations", "activate.activation.list", { limit: 10 }],
    ["dataActionTargets", "activate.data_action_target.list", { limit: 10 }],
    ["dataActions", "activate.data_action.list", { limit: 10 }],
    ["connections", "connect.connections_sfdc.list", {}],
    ["profileMetadata", "query.profile.metadata", {}],
    ["sessions", "observe.stdm.find_sessions", { since: "30d", limit: 10 }],
    ["searchIndexes", "semantic.search_index.list", { limit: 10 }],
    ["retrievers", "semantic.retriever.list", { limit: 10 }],
    ["semanticModels", "semantic.semantic_model.list", { limit: 10 }],
    ["configuredModels", "semantic.ml.configured_model.list", { limit: 10 }],
    ["modelArtifacts", "semantic.ml.model_artifact.list", { limit: 10 }],
    ["modelSetups", "semantic.ml.model_setup.list", { limit: 10 }],
    ["predictionDefinitions", "semantic.ml.prediction_job_def.list", { limit: 10 }],
  ];
}

async function firstNested(
  execute: typeof call,
  action: string,
  params: Record<string, unknown>,
  keys: string[],
): Promise<Record<string, unknown> | undefined> {
  const result = await execute(action, params);
  const body = recordValue(result.response);
  for (const key of keys) {
    const value = firstRecord(body[key]);
    if (value) return value;
  }
  return undefined;
}

function preferredRecord(
  value: unknown,
  preferredName: string,
): Record<string, unknown> | undefined {
  const values = arrayValue(value).filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
  return values.find((entry) => entry.name === preferredName) ?? values[0];
}
function firstRecord(value: unknown): Record<string, unknown> | undefined {
  const first = Array.isArray(value) ? value[0] : undefined;
  return first && typeof first === "object" && !Array.isArray(first)
    ? (first as Record<string, unknown>)
    : undefined;
}
function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function qualifiedName(value: Record<string, unknown> | undefined): string | undefined {
  const name = stringValue(value?.name) ?? stringValue(value?.id);
  const namespace = stringValue(value?.namespace);
  return name && namespace ? `${namespace}__${name}` : name;
}
function parseArgs(argv: string[]): Options {
  const result: Options = { targetOrg: "", output: "", componentType: "DataStreamBundle" };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--target-org") result.targetOrg = argv[++index] ?? "";
    else if (arg === "--output") result.output = argv[++index] ?? "";
    else if (arg === "--data-kit-dev-name") result.dataKitDevName = argv[++index];
    else if (arg === "--component-type")
      result.componentType = argv[++index] ?? result.componentType;
    else if (arg === "--profile-model") result.profileModel = argv[++index];
    else if (arg === "--profile-filter") result.profileFilter = argv[++index];
    else if (arg === "--profile-fields") result.profileFields = argv[++index];
  }
  return result;
}
function exec(
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options?.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("close", (code) => resolve({ stdout, stderr, code }));
    child.on("error", (error) => resolve({ stdout, stderr: String(error), code: 1 }));
  });
}
