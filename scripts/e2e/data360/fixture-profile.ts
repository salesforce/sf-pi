/* SPDX-License-Identifier: Apache-2.0 */
/** Public-safe fixture-profile builder for recursive sf_data360 live reads. */

export interface Data360FixtureProfile {
  defaults?: Record<string, unknown>;
  actions?: Record<string, Record<string, unknown>>;
}

export interface Data360DiscoveredAssets {
  dataspace?: Record<string, unknown>;
  dlo?: Record<string, unknown>;
  dmo?: Record<string, unknown>;
  sourceFields?: unknown[];
  targetFields?: unknown[];
  stream?: Record<string, unknown>;
  transform?: Record<string, unknown>;
  identityResolution?: Record<string, unknown>;
  calculatedInsight?: Record<string, unknown>;
  segment?: Record<string, unknown>;
  activationTarget?: Record<string, unknown>;
  activation?: Record<string, unknown>;
  dataActionTarget?: Record<string, unknown>;
  dataAction?: Record<string, unknown>;
  connection?: Record<string, unknown>;
  profileModel?: Record<string, unknown>;
  profileFilter?: string;
  profileFields?: string;
  session?: Record<string, unknown>;
  interaction?: Record<string, unknown>;
  mapping?: Record<string, unknown>;
  searchIndex?: Record<string, unknown>;
  retriever?: Record<string, unknown>;
  retrieverConfiguration?: Record<string, unknown>;
  semanticModel?: Record<string, unknown>;
  semanticDataObject?: Record<string, unknown>;
  semanticMetric?: Record<string, unknown>;
  semanticRelationship?: Record<string, unknown>;
  semanticCalculatedDimension?: Record<string, unknown>;
  semanticCalculatedMeasure?: Record<string, unknown>;
  configuredModel?: Record<string, unknown>;
  configuredModelHistory?: Record<string, unknown>;
  modelArtifact?: Record<string, unknown>;
  modelSetup?: Record<string, unknown>;
  predictionJobDefinition?: Record<string, unknown>;
  queryId?: string;
  dataKitDevName?: string;
  dataKitComponentType?: string;
  csvPath?: string;
  manifestPath?: string;
}

export function buildData360FixtureProfile(assets: Data360DiscoveredAssets): Data360FixtureProfile {
  const actions: Record<string, Record<string, unknown>> = {};
  const set = (action: string, params: Record<string, unknown>): void => {
    if (Object.values(params).every(hasValue)) actions[action] = params;
  };
  const retrieverName = qualifiedName(assets.retriever);
  const configuredModelName = qualifiedName(assets.configuredModel);
  const artifactName = qualifiedName(assets.modelArtifact);
  const modelApiName = stringValue(assets.semanticModel, "apiName", "name", "id");
  const dataObjectName = stringValue(assets.semanticDataObject, "apiName", "name", "id");

  set("prepare.dataspace.get", { dataSpaceName: stringValue(assets.dataspace, "name") });
  set("prepare.dataspace_member.list", { dataSpaceName: stringValue(assets.dataspace, "name") });
  set("prepare.dlo.get", { dloName: stringValue(assets.dlo, "name") });
  set("harmonize.dmo.get", { dmoName: stringValue(assets.dmo, "name") });
  set("harmonize.dmo.relationship.list", {
    dataModelObjectName: stringValue(assets.dmo, "name"),
  });
  set("activate.activation.metadata.channel_preference.list", {
    channel: "Email",
    dataModelObjectApiName: stringValue(assets.dmo, "name"),
  });
  set("activate.activation.metadata.data_source.list", {
    dataModelObjectApiName: stringValue(assets.dmo, "name"),
  });
  set("activate.activation.metadata.streaming_eligibility.get", {
    dataModelObjectApiName: stringValue(assets.dmo, "name"),
  });
  set("harmonize.dmo_mapping.list", {
    dmoDeveloperName: stringValue(assets.dmo, "name"),
  });
  set("harmonize.dmo_mapping.get", {
    mappingName: stringValue(assets.mapping, "developerName", "name"),
  });
  set("harmonize.event_date_recommend", { fields: assets.sourceFields });
  set("harmonize.preview_field_matches", {
    sourceFields: assets.sourceFields,
    targetFields: assets.targetFields,
  });
  set("harmonize.smart_mapping.suggest", {
    sourceDloName: stringValue(assets.dlo, "name"),
    sourceFields: assets.sourceFields,
    targetDmoName: stringValue(assets.dmo, "name"),
    targetFields: assets.targetFields,
  });
  set("harmonize.standard_mapping.preview", {
    sourceObjectName: stringValue(assets.dlo, "name"),
  });
  set("prepare.stream.get", {
    dataStreamId: stringValue(assets.stream, "recordId", "id", "name"),
  });
  set("prepare.transform.get", {
    transformId: stringValue(assets.transform, "name", "id"),
  });
  set("prepare.transform.run_history.list", {
    dataTransformNameOrId: stringValue(assets.transform, "name", "id"),
  });
  set("prepare.transform.status.refresh", {
    dataTransformNameOrId: stringValue(assets.transform, "name", "id"),
  });
  set("prepare.transform_schedule.get", {
    transformId: stringValue(assets.transform, "name", "id"),
  });
  set("harmonize.ir.get", {
    identityResolutionId: stringValue(assets.identityResolution, "id", "name"),
  });
  const ciName = stringValue(assets.calculatedInsight, "apiName", "name");
  for (const action of [
    "segment.ci.get",
    "segment.ci.run.status",
    "query.insight.metadata_get",
    "query.insights.query",
  ]) {
    set(action, { ciName });
  }
  set("segment.get", { segmentId: stringValue(assets.segment, "id", "apiName", "name") });
  set("segment.members.list", {
    segmentApiName: stringValue(assets.segment, "apiName", "name", "id"),
  });
  set("segment.count", {
    segmentApiName: stringValue(assets.segment, "apiName", "name", "id"),
    body: { preferApproxCount: true },
  });
  set("activate.activation_target.get", {
    activationTargetId: stringValue(assets.activationTarget, "id", "name"),
  });
  set("activate.activation.get", { activationId: stringValue(assets.activation, "id", "name") });
  set("activate.activation.data.list", {
    activationId: stringValue(assets.activation, "id", "name"),
    "X-Chatter-Entity-Encoding": "false",
  });
  set("activate.activation.history.list", {
    activationId: stringValue(assets.activation, "id", "name"),
  });
  set("activate.data_action_target.get", {
    dataActionTargetId: stringValue(assets.dataActionTarget, "id", "apiName"),
  });
  set("activate.data_action.get", {
    dataActionId: stringValue(assets.dataAction, "id", "developerName"),
  });
  set("connect.connection.list", { connectorType: "SalesforceDotCom" });
  set("connect.connection.get", {
    connectionId: stringValue(assets.connection, "id"),
    connectorType: "SalesforceDotCom",
  });
  set("connect.connector.metadata", { connectorName: "SalesforceDotCom" });
  set("query.metadata.query", { entityName: stringValue(assets.dmo, "name") });
  set("query.profile.metadata_model", {
    dataModelName: stringValue(assets.profileModel, "name"),
  });
  set("query.profile.query", {
    dataModelName: stringValue(assets.profileModel, "name"),
    filters: assets.profileFilter,
    fields: assets.profileFields,
    limit: 5,
  });
  set("query.sql.verify_rows", { dloName: stringValue(assets.dlo, "name") });
  set("observe.stdm.session_timeline", {
    session_id: stringValue(assets.session, "session_id", "id"),
    limit: 20,
  });
  set("observe.stdm.session_otel", {
    session_id: stringValue(assets.session, "session_id", "id"),
  });
  set("observe.trace.join_interaction_trace", {
    interaction_id: stringValue(assets.interaction, "interaction_id", "id"),
  });
  set("observe.trace.trace_tree", {
    trace_id: stringValue(assets.interaction, "trace_id", "traceId"),
  });
  for (const action of ["query.sql.status", "query.sql.metadata"]) {
    set(action, { queryId: assets.queryId });
  }
  set("query.sql.rows", { queryId: assets.queryId, limit: 5 });
  set("query.sql.chunk", { queryId: assets.queryId, chunkId: "0" });
  set("semantic.search_index.get", {
    searchIndexApiNameOrId: stringValue(assets.searchIndex, "id", "developerName"),
  });
  set("semantic.search_index.process_history", {
    searchIndexApiNameOrId: stringValue(assets.searchIndex, "id", "developerName"),
  });
  set("semantic.retriever.get", { retrieverId: retrieverName });
  set("semantic.retriever.config.list", { retrieverIdOrName: retrieverName });
  set("semantic.retriever.config.get", {
    retrieverIdOrName: retrieverName,
    configurationIdOrName: stringValue(assets.retrieverConfiguration, "name", "id"),
  });
  for (const action of [
    "semantic.semantic_model.get",
    "semantic.semantic_model.dependencies",
    "semantic.semantic_model.validate",
    "semantic.semantic_model.data_object.list",
    "semantic.semantic_model.metric.list",
    "semantic.semantic_model.relationship.list",
    "semantic.semantic_model.calculated_dimension.list",
    "semantic.semantic_model.calculated_measure.list",
  ]) {
    set(action, { modelApiNameOrId: modelApiName });
  }
  for (const action of [
    "semantic.semantic_model.data_object.get",
    "semantic.semantic_model.dimension.list",
    "semantic.semantic_model.measurement.list",
  ]) {
    set(action, { modelApiNameOrId: modelApiName, dataObjectNameOrId: dataObjectName });
  }
  set("semantic.semantic_model.metric.get", {
    modelApiNameOrId: modelApiName,
    metricNameOrId: stringValue(assets.semanticMetric, "apiName", "name", "id"),
  });
  set("semantic.semantic_model.relationship.get", {
    modelApiNameOrId: modelApiName,
    relationshipId: stringValue(assets.semanticRelationship, "id", "name"),
  });
  set("semantic.semantic_model.calculated_dimension.get", {
    modelApiNameOrId: modelApiName,
    calculatedDimensionId: stringValue(assets.semanticCalculatedDimension, "id", "name"),
  });
  set("semantic.semantic_model.calculated_measure.get", {
    modelApiNameOrId: modelApiName,
    calculatedMeasureId: stringValue(assets.semanticCalculatedMeasure, "id", "name"),
  });
  set("semantic.ml.configured_model.get", { idOrName: configuredModelName });
  set("semantic.ml.configured_model.history.list", { idOrName: configuredModelName });
  set("semantic.ml.configured_model.history.get", {
    idOrName: configuredModelName,
    historyId: stringValue(assets.configuredModelHistory, "id", "version"),
  });
  set("semantic.ml.model_artifact.get", { idOrName: artifactName });
  set("semantic.ml.model_setup.get", {
    idOrName: stringValue(assets.modelSetup, "id", "name"),
  });
  set("semantic.ml.prediction_job_def.get", {
    idOrName: stringValue(assets.predictionJobDefinition, "id", "name"),
  });
  set("prepare.datakit_components", {
    componentType: assets.dataKitComponentType,
    dataKitDevName: assets.dataKitDevName,
    limit: 10,
    offset: 0,
  });
  set("prepare.datakit.manifest", { dataKitDevName: assets.dataKitDevName });
  set("prepare.csv_schema.infer", {
    csvPath: assets.csvPath,
    schemaName: "PiCoverageSchema",
    primaryKey: "Id",
    recordModifiedField: "CreatedDate",
  });
  set("orchestrate.ingest_csv.plan", {
    sourceName: "PiCoverageSource",
    schemaObjectName: "PiCoverageSchema",
    streamName: "PiCoverageStream",
    csvPath: assets.csvPath,
    connectionId: stringValue(assets.connection, "id"),
  });
  set("orchestrate.manifest.validate", { manifestPath: assets.manifestPath });
  set("orchestrate.manifest.plan", { manifestPath: assets.manifestPath });
  set("orchestrate.cleanup.discover_owned", {
    prefixes: ["PiData360SweepDlo_", "PiData360SweepDmo_"],
    maxResults: 20,
  });
  set("query.sql.run", {
    sql: 'SELECT COUNT(*) AS row_count FROM "ssot__AiAgentSession__dlm"',
    queryRowLimit: 2,
    transport: "connect",
  });

  return {
    defaults: { dataspace: "default", limit: 5, since: "30d" },
    actions,
  };
}

function qualifiedName(value: Record<string, unknown> | undefined): string | undefined {
  const name = stringValue(value, "name", "id");
  const namespace = stringValue(value, "namespace");
  return name && namespace ? `${namespace}__${name}` : name;
}

function stringValue(
  value: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return undefined;
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}
