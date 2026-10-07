/* SPDX-License-Identifier: Apache-2.0 */
/** Pure normalization and parity helpers for the Data 360 Connect OpenAPI contract. */
import { createHash } from "node:crypto";

import YAML from "yaml";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

export function parseConnectOpenApi(source) {
  if (typeof source !== "string" || !source.trim()) {
    throw new Error("Connect OpenAPI document is empty.");
  }
  if (/^\s*<(?:!doctype|html)\b/i.test(source)) {
    throw new Error("Connect OpenAPI document is HTML, not YAML or JSON.");
  }
  let document;
  try {
    document = YAML.parse(source);
  } catch (error) {
    throw new Error(
      `Unable to parse Connect OpenAPI document: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!isRecord(document) || typeof document.openapi !== "string" || !isRecord(document.paths)) {
    throw new Error("Connect OpenAPI document must contain openapi and paths fields.");
  }
  if (!document.openapi.startsWith("3.")) {
    throw new Error(
      `Unsupported Connect OpenAPI version '${document.openapi}'. Expected OpenAPI 3.x.`,
    );
  }
  return document;
}

export function normalizeConnectOpenApi(document, source) {
  const paths = isRecord(document.paths) ? document.paths : {};
  const operations = [];
  for (const pathName of Object.keys(paths).sort()) {
    const pathItem = isRecord(paths[pathName]) ? paths[pathName] : {};
    const sharedParameters = arrayValue(pathItem.parameters);
    for (const methodName of Object.keys(pathItem).sort()) {
      if (!HTTP_METHODS.has(methodName.toLowerCase())) continue;
      const operation = isRecord(pathItem[methodName]) ? pathItem[methodName] : {};
      const method = methodName.toUpperCase();
      const parameters = mergeParameters(
        document,
        sharedParameters,
        arrayValue(operation.parameters),
      );
      operations.push(
        stripUndefined({
          key: `${method} ${normalizePath(pathName)}`,
          method,
          path: pathName,
          normalizedPath: normalizePath(pathName),
          operationId: stringValue(operation.operationId),
          summary: stringValue(operation.summary),
          tags: stringArray(operation.tags),
          deprecated: operation.deprecated === true ? true : undefined,
          parameters,
          requestBody: normalizeRequestBody(document, operation.requestBody),
          responses: normalizeResponses(document, operation.responses),
        }),
      );
    }
  }
  operations.sort((left, right) => left.key.localeCompare(right.key));

  const components = isRecord(document.components) ? document.components : {};
  const componentSchemas = isRecord(components.schemas) ? components.schemas : {};
  const info = isRecord(document.info) ? document.info : {};
  const schemas = Object.keys(componentSchemas)
    .sort()
    .map((name) => {
      const schema = componentSchemas[name];
      const resolved = resolveNode(document, schema);
      const required = stringArray(resolved?.required);
      const properties = isRecord(resolved?.properties)
        ? Object.keys(resolved.properties).sort()
        : [];
      return stripUndefined({
        name,
        hash: hashValue(resolved),
        type: stringValue(resolved?.type),
        format: stringValue(resolved?.format),
        required: required.length ? required : undefined,
        properties: properties.length ? properties : undefined,
        validation: normalizeValidationSchema(schema),
      });
    });

  const byMethod = {};
  for (const operation of operations)
    byMethod[operation.method] = (byMethod[operation.method] ?? 0) + 1;
  return {
    schemaVersion: 1,
    source: {
      url: source.sourceUrl,
      sha256: source.sha256,
      openapi: document.openapi,
      title: stringValue(info.title),
      apiVersion: stringValue(info.version),
    },
    summary: {
      paths: Object.keys(paths).length,
      operations: operations.length,
      componentSchemas: schemas.length,
      byMethod: sortRecord(byMethod),
    },
    servers: arrayValue(document.servers)
      .map((server) => stringValue(isRecord(server) ? server.url : undefined))
      .filter(Boolean),
    operations,
    schemas,
  };
}

export function validateConnectLiveResult(snapshot, action, result, overrideValue = {}) {
  const override = isRecord(overrideValue) ? overrideValue : {};
  if (!isRecord(action?.endpoint)) {
    return {
      status: "not_applicable",
      fail: false,
      summary: "Action is not backed by a Connect API endpoint.",
    };
  }
  const endpoint = {
    method: String(action.endpoint.method ?? "").toUpperCase(),
    path: String(action.endpoint.path ?? ""),
  };
  const operationKey = endpointKey(endpoint);
  const operation = snapshot.operations.find((candidate) => candidate.key === operationKey);
  if (!operation) {
    const openApiMethods = snapshot.operations
      .filter((candidate) => candidate.normalizedPath === normalizePath(endpoint.path))
      .map((candidate) => candidate.method);
    return {
      status: "contract_gap",
      fail: false,
      operationKey,
      openApiMethods: [...new Set(openApiMethods)].sort(),
      summary: "SDK endpoint is not declared with this method in the Connect OpenAPI contract.",
    };
  }
  const request = isRecord(result?.request) ? result.request : {};
  const observedMethod = stringValue(request.method)?.toUpperCase();
  const observedPath = requestPath(request);
  const observedStatus =
    typeof result?.status === "number" && Number.isFinite(result.status)
      ? String(result.status)
      : undefined;
  if (!observedMethod || !observedPath || !observedStatus) {
    return {
      status: "not_observed",
      fail: false,
      operationKey,
      summary: "Live result did not include complete request and HTTP status evidence.",
    };
  }
  const methodMatches = observedMethod === operation.method;
  const pathMatches = pathMatchesTemplate(observedPath, operation.path);
  const responseStatusAliases = isRecord(override.responseStatusAliases)
    ? override.responseStatusAliases
    : {};
  const declaredStatus = stringValue(responseStatusAliases[observedStatus]) ?? observedStatus;
  const responseStatusOverrideApplied = declaredStatus !== observedStatus;
  const response = operation.responses.find(
    (candidate) => candidate.status === declaredStatus || candidate.status === "default",
  );
  const responseStatusMatches = Boolean(response);
  const requestBody = validateDeclaredBody(
    operation.requestBody?.content,
    request.body,
    operation.requestBody?.required === true,
    "request",
    snapshot,
  );
  const responseSchemaOverrides = isRecord(override.responseSchemaOverrides)
    ? override.responseSchemaOverrides
    : {};
  const responseSchemaOverride =
    responseSchemaOverrides[observedStatus] ?? responseSchemaOverrides[declaredStatus];
  const declaredResponseBody = validateDeclaredBody(
    responseSchemaOverride
      ? [
          {
            mediaType: "application/json",
            schema: { validation: responseSchemaOverride },
          },
        ]
      : response?.content,
    result?.response,
    false,
    "response",
    snapshot,
  );
  const responseBody = applyValidationExceptions(
    declaredResponseBody,
    stringArray(override.responseValidationExceptions),
  );
  const responseOverrideApplied =
    Boolean(responseSchemaOverride) ||
    responseStatusOverrideApplied ||
    responseBody.exceptions.length > 0;
  const status =
    !methodMatches || !pathMatches
      ? "request_drift"
      : !responseStatusMatches
        ? "response_drift"
        : requestBody.status === "fail"
          ? "request_body_drift"
          : responseBody.status === "fail"
            ? "response_body_drift"
            : responseOverrideApplied
              ? "conformant_with_override"
              : "conformant";
  return {
    status,
    fail: ["request_drift", "response_drift", "request_body_drift", "response_body_drift"].includes(
      status,
    ),
    operationKey,
    observed: { method: observedMethod, path: observedPath, status: observedStatus },
    checks: {
      method: methodMatches,
      path: pathMatches,
      responseStatus: responseStatusMatches,
      requestBody: requestBody.status,
      responseBody:
        responseOverrideApplied && responseBody.status === "pass"
          ? "pass_override"
          : responseBody.status,
    },
    requestBodyErrors: requestBody.errors,
    responseBodyErrors: responseBody.errors,
    responseBodyExceptions: responseBody.exceptions,
    responseSchemas: (response?.content ?? []).map((entry) => entry.schema).filter(Boolean),
    responseStatusOverride: responseStatusOverrideApplied
      ? { observed: observedStatus, declared: declaredStatus }
      : undefined,
    overrideEvidence: responseOverrideApplied ? stringValue(override.evidence) : undefined,
    summary: contractValidationSummary(status, observedStatus),
  };
}

function applyValidationExceptions(validation, exceptions) {
  if (validation.status !== "fail" || !exceptions.length) {
    return { ...validation, exceptions: [] };
  }
  const allowed = new Set(exceptions);
  const errors = [];
  const accepted = [];
  for (const error of validation.errors) {
    if (allowed.has(normalizeValidationError(error))) accepted.push(error);
    else errors.push(error);
  }
  return {
    status: errors.length ? "fail" : "pass",
    errors,
    exceptions: accepted,
  };
}

function normalizeValidationError(error) {
  return String(error).replace(/\[\d+\]/g, "[*]");
}

function validateDeclaredBody(content, value, required, mode, snapshot) {
  const representations = arrayValue(content);
  const representation =
    representations.find((entry) => entry.mediaType === "application/json") ??
    representations.find((entry) => String(entry.mediaType ?? "").endsWith("+json")) ??
    representations[0];
  if (!representation?.schema) return { status: "not_declared", errors: [] };
  if (value === undefined) {
    return required
      ? { status: "fail", errors: ["$ is required"] }
      : { status: "not_observed", errors: [] };
  }
  const schemas = new Map(snapshot.schemas.map((entry) => [entry.name, entry.validation]));
  const errors = validateSchemaValue(representation.schema, value, mode, schemas, "$", 0);
  return { status: errors.length ? "fail" : "pass", errors };
}

function validateSchemaValue(descriptor, value, mode, schemas, path, depth, seenRefs = new Set()) {
  if (depth > 32) return [`${path} exceeded schema validation depth`];
  let schema = descriptor?.validation ?? descriptor;
  if (!isRecord(schema)) return [];
  let activeRefs = seenRefs;
  if (schema.ref) {
    if (seenRefs.has(schema.ref)) return [];
    const referenced = schemas.get(schemaNameFromRef(schema.ref));
    if (!referenced) return [`${path} references unavailable schema ${schema.ref}`];
    activeRefs = new Set(seenRefs);
    activeRefs.add(schema.ref);
    schema = referenced;
  }
  if (value === null) return schema.nullable ? [] : [`${path} must not be null`];
  const errors = [];
  for (const variant of arrayValue(schema.allOf)) {
    errors.push(...validateSchemaValue(variant, value, mode, schemas, path, depth + 1, activeRefs));
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const variants = arrayValue(schema[keyword]);
    if (
      variants.length &&
      !variants.some(
        (variant) =>
          validateSchemaValue(variant, value, mode, schemas, path, depth + 1, activeRefs).length ===
          0,
      )
    ) {
      errors.push(`${path} must match at least one ${keyword} schema`);
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) {
    errors.push(`${path} must be one of the declared enum values`);
  }
  const type = schema.type ?? (isRecord(schema.properties) ? "object" : undefined);
  if (type === "object") {
    if (!isRecord(value)) return [...errors, `${path} must be an object`];
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const name of stringArray(schema.required)) {
      const propertySchema = properties[name];
      if (mode === "request" && propertySchema?.readOnly) continue;
      if (mode === "response" && propertySchema?.writeOnly) continue;
      if (!(name in value)) errors.push(`${path}.${name} is required`);
    }
    for (const [name, propertyValue] of Object.entries(value)) {
      const propertySchema = properties[name];
      if (propertySchema) {
        errors.push(
          ...validateSchemaValue(
            propertySchema,
            propertyValue,
            mode,
            schemas,
            `${path}.${name}`,
            depth + 1,
            activeRefs,
          ),
        );
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${name} is not declared`);
      } else if (isRecord(schema.additionalProperties)) {
        errors.push(
          ...validateSchemaValue(
            schema.additionalProperties,
            propertyValue,
            mode,
            schemas,
            `${path}.${name}`,
            depth + 1,
            activeRefs,
          ),
        );
      }
    }
    return errors;
  }
  if (type === "array") {
    if (!Array.isArray(value)) return [...errors, `${path} must be an array`];
    if (schema.items) {
      value.forEach((entry, index) => {
        errors.push(
          ...validateSchemaValue(
            schema.items,
            entry,
            mode,
            schemas,
            `${path}[${index}]`,
            depth + 1,
            activeRefs,
          ),
        );
      });
    }
    return errors;
  }
  if (type === "string" && typeof value !== "string") errors.push(`${path} must be a string`);
  if (type === "boolean" && typeof value !== "boolean") errors.push(`${path} must be a boolean`);
  if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    errors.push(`${path} must be a number`);
  }
  if (type === "integer" && (typeof value !== "number" || !Number.isInteger(value))) {
    errors.push(`${path} must be an integer`);
  }
  return errors;
}

function schemaNameFromRef(ref) {
  const encoded = String(ref).split("/").at(-1) ?? "";
  return encoded.replaceAll("~1", "/").replaceAll("~0", "~");
}

function contractValidationSummary(status, observedStatus) {
  switch (status) {
    case "conformant":
      return "Live Connect request and response conform to the declared OpenAPI shape.";
    case "conformant_with_override":
      return "Live Connect response conforms to a reviewed platform-shape override.";
    case "request_drift":
      return "Live Connect request method or path differs from OpenAPI.";
    case "response_drift":
      return `Live Connect response status ${observedStatus} is not declared in OpenAPI.`;
    case "request_body_drift":
      return "Live Connect request body differs from the declared OpenAPI schema.";
    case "response_body_drift":
      return "Live Connect response body differs from the declared OpenAPI schema.";
    default:
      return "Live Connect contract validation did not complete.";
  }
}

export function buildPromotedConnectOperations(snapshot, config) {
  const promotions = arrayValue(config?.promotions);
  const waves = arrayValue(config?.waves);
  const waveIds = new Set(waves.map((wave) => wave.id));
  const operationByKey = new Map(
    snapshot.operations.map((operation) => [operation.key, operation]),
  );
  const seenKeys = new Set();
  const seenNames = new Set();
  return promotions.map((promotion) => {
    const key = requiredConfigString(promotion?.key, "promotion key");
    const name = requiredConfigString(promotion?.name, `promotion name for ${key}`);
    if (seenKeys.has(key)) throw new Error(`Duplicate Connect OpenAPI promotion key '${key}'.`);
    if (seenNames.has(name)) throw new Error(`Duplicate Connect OpenAPI promotion name '${name}'.`);
    seenKeys.add(key);
    seenNames.add(name);
    const operation = operationByKey.get(key);
    if (!operation)
      throw new Error(`Connect OpenAPI promotion references unknown operation '${key}'.`);
    const wave = requiredConfigString(promotion.wave, `promotion wave for ${key}`);
    if (!waveIds.has(wave))
      throw new Error(`Connect OpenAPI promotion uses unknown wave '${wave}'.`);
    const assignedWave = promotionWaveFor(operation, waves);
    if (assignedWave !== wave) {
      throw new Error(
        `Connect OpenAPI promotion ${key} declares wave '${wave}' but rules assign '${assignedWave}'.`,
      );
    }
    const supportedParameters = operation.parameters.filter((parameter) =>
      ["path", "query", "header"].includes(parameter.in),
    );
    const requiredParams = supportedParameters
      .filter((parameter) => parameter.required)
      .map((parameter) => parameter.name);
    const optionalParams = supportedParameters
      .filter((parameter) => !parameter.required)
      .map((parameter) => parameter.name);
    const parameterSchemas = Object.fromEntries(
      supportedParameters.map((parameter) => [
        parameter.name,
        promotionParameterSchema(parameter.schema),
      ]),
    );
    const headerParams = supportedParameters
      .filter((parameter) => parameter.in === "header")
      .map((parameter) => parameter.name);
    if (operation.requestBody) {
      (operation.requestBody.required ? requiredParams : optionalParams).push("body");
      const bodySchema = operation.requestBody.content?.find(
        (entry) => entry.mediaType === "application/json",
      )?.schema;
      parameterSchemas.body = promotionParameterSchema(bodySchema, "object");
    }
    return stripUndefined({
      name,
      family: requiredConfigString(promotion.family, `promotion family for ${key}`),
      description: promotion.description ?? operation.summary ?? `Data 360 Connect ${key}`,
      method: operation.method,
      path: operation.path,
      origin: "connect_openapi",
      safety: requiredConfigString(promotion.safety, `promotion safety for ${key}`),
      requiredParams: [...new Set(requiredParams)],
      optionalParams: [...new Set(optionalParams)],
      parameterSchemas,
      ...(headerParams.length ? { headerParams } : {}),
      ...(promotion.tips ? { tips: promotion.tips } : {}),
      promotion: {
        wave,
        namespace: requiredConfigString(promotion.namespace, `promotion namespace for ${key}`),
        phase: requiredConfigString(promotion.phase, `promotion phase for ${key}`),
        action: requiredConfigString(promotion.action, `promotion action for ${key}`),
      },
    });
  });
}

function promotionParameterSchema(schema, fallbackType = "string") {
  return stripUndefined({
    type: schema?.type ?? fallbackType,
    format: schema?.format,
    ...(Array.isArray(schema?.validation?.enum) ? { enum: schema.validation.enum } : {}),
  });
}

function requiredConfigString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${label}.`);
  return value.trim();
}

export function buildConnectOpenApiParity(snapshot, actions, overrides = {}, promotionConfig = {}) {
  const actionOverrides = isRecord(overrides.actions) ? overrides.actions : {};
  const promotionKeys = new Set(
    arrayValue(promotionConfig.promotions).map((promotion) => promotion.key),
  );
  const waves = arrayValue(promotionConfig.waves);
  const endpointActions = actions
    .filter((action) => isRecord(action?.endpoint))
    .map((action) => ({
      ...action,
      endpoint: {
        method: String(action.endpoint.method ?? "").toUpperCase(),
        path: String(action.endpoint.path ?? ""),
      },
    }))
    .filter((action) => action.endpoint.method && action.endpoint.path.startsWith("/"))
    .sort((left, right) => String(left.action).localeCompare(String(right.action)));

  const endpointActionNames = new Set(endpointActions.map((action) => action.action));
  for (const actionName of Object.keys(actionOverrides)) {
    if (!endpointActionNames.has(actionName)) {
      throw new Error(
        `Connect OpenAPI override references unknown endpoint action '${actionName}'.`,
      );
    }
  }
  const actionByKey = groupBy(endpointActions, (action) => endpointKey(action.endpoint));
  const actionByPath = groupBy(endpointActions, (action) => normalizePath(action.endpoint.path));
  const operationByKey = new Map(
    snapshot.operations.map((operation) => [operation.key, operation]),
  );
  const operationByPath = groupBy(snapshot.operations, (operation) => operation.normalizedPath);

  const entries = snapshot.operations.map((operation) => {
    const exact = actionByKey.get(operation.key) ?? [];
    if (exact.length) {
      return {
        key: operation.key,
        method: operation.method,
        path: operation.path,
        operationId: operation.operationId,
        status: "matched",
        ...(promotionKeys.has(operation.key)
          ? { promotionWave: promotionWaveFor(operation, waves) }
          : {}),
        actions: exact.map((action) =>
          compareActionParameters(operation, action, actionOverrides[action.action]),
        ),
      };
    }
    const methodCandidates = actionByPath.get(operation.normalizedPath) ?? [];
    return {
      key: operation.key,
      method: operation.method,
      path: operation.path,
      operationId: operation.operationId,
      status: "openapi_only",
      promotionWave: promotionWaveFor(operation, waves),
      sdkMethodsAtPath: [
        ...new Set(methodCandidates.map((action) => action.endpoint.method)),
      ].sort(),
      actions: methodCandidates.map(summarizeEndpointAction),
    };
  });

  const sdkOnly = endpointActions
    .filter((action) => !operationByKey.has(endpointKey(action.endpoint)))
    .map((action) => {
      const pathMatches = operationByPath.get(normalizePath(action.endpoint.path)) ?? [];
      return {
        ...summarizeEndpointAction(action),
        status: "sdk_only",
        openApiMethods: [...new Set(pathMatches.map((operation) => operation.method))].sort(),
      };
    });

  const matchedEntries = entries.filter((entry) => entry.status === "matched");
  const matchedSdkActions = matchedEntries.reduce((sum, entry) => sum + entry.actions.length, 0);
  const openApiOnlyFamilies = classifyOpenApiOnlyFamilies(entries, snapshot.operations);
  const promotionWaves = summarizePromotionWaves(entries, waves);
  return {
    schemaVersion: 1,
    source: snapshot.source,
    summary: {
      openApiOperations: entries.length,
      matchedOpenApiOperations: matchedEntries.length,
      openApiOnlyOperations: entries.filter((entry) => entry.status === "openapi_only").length,
      sdkEndpointActions: endpointActions.length,
      matchedSdkActions,
      sdkOnlyActions: sdkOnly.length,
      methodMismatches: 0,
      openApiOperationsWithSdkPathOverlap: entries.filter(
        (entry) => entry.status === "openapi_only" && entry.sdkMethodsAtPath.length,
      ).length,
      sdkActionsWithOpenApiPathOverlap: sdkOnly.filter((entry) => entry.openApiMethods.length)
        .length,
      exactParameterActions: matchedEntries
        .flatMap((entry) => entry.actions)
        .filter((action) => action.parameterStatus === "exact").length,
      adjustedParameterActions: matchedEntries
        .flatMap((entry) => entry.actions)
        .filter((action) => action.parameterStatus === "adjusted").length,
      sdkStricterParameterActions: matchedEntries
        .flatMap((entry) => entry.actions)
        .filter((action) => action.parameterStatus === "sdk_stricter").length,
      parameterDriftActions: matchedEntries
        .flatMap((entry) => entry.actions)
        .filter((action) => action.parameterStatus === "drift").length,
    },
    promotionWaves,
    openApiOnlyFamilies,
    entries,
    sdkOnly,
  };
}

function promotionWaveFor(operation, waves) {
  const family = operation.tags?.[0] ?? "Untagged";
  for (const wave of waves) {
    if (Array.isArray(wave.keys) && !wave.keys.includes(operation.key)) continue;
    if (Array.isArray(wave.methods) && !wave.methods.includes(operation.method)) continue;
    if (Array.isArray(wave.families) && !wave.families.includes(family)) continue;
    return wave.id;
  }
  return "unassigned";
}

function summarizePromotionWaves(entries, waves) {
  const result = waves.map((wave) => {
    const assigned = entries.filter((entry) => entry.promotionWave === wave.id);
    return {
      id: wave.id,
      label: wave.label,
      total: assigned.length,
      promoted: assigned.filter((entry) => entry.status === "matched").length,
      remaining: assigned.filter((entry) => entry.status === "openapi_only").length,
    };
  });
  const unassigned = entries.filter(
    (entry) => entry.status === "openapi_only" && entry.promotionWave === "unassigned",
  );
  if (unassigned.length) {
    result.push({
      id: "unassigned",
      label: "Unassigned OpenAPI operations",
      total: unassigned.length,
      promoted: 0,
      remaining: unassigned.length,
    });
  }
  return result;
}

function classifyOpenApiOnlyFamilies(entries, operations) {
  const operationByKey = new Map(operations.map((operation) => [operation.key, operation]));
  const families = new Map();
  for (const entry of entries.filter((candidate) => candidate.status === "openapi_only")) {
    const operation = operationByKey.get(entry.key);
    const family = operation?.tags?.[0] ?? "Untagged";
    const current = families.get(family) ?? {
      family,
      total: 0,
      methods: { GET: 0, POST: 0, PATCH: 0, PUT: 0, DELETE: 0 },
      promotionCandidates: { read: 0, actionOrCreate: 0, update: 0, destructive: 0 },
    };
    current.total += 1;
    current.methods[entry.method] = (current.methods[entry.method] ?? 0) + 1;
    if (entry.method === "GET") current.promotionCandidates.read += 1;
    else if (entry.method === "DELETE") current.promotionCandidates.destructive += 1;
    else if (entry.method === "PATCH" || entry.method === "PUT") {
      current.promotionCandidates.update += 1;
    } else {
      current.promotionCandidates.actionOrCreate += 1;
    }
    families.set(family, current);
  }
  return [...families.values()].sort(
    (left, right) => right.total - left.total || left.family.localeCompare(right.family),
  );
}

function mergeParameters(document, shared, operation) {
  const merged = new Map();
  for (const parameter of [...shared, ...operation]) {
    const resolved = resolveNode(document, parameter);
    if (!isRecord(resolved)) continue;
    const name = stringValue(resolved.name);
    const location = stringValue(resolved.in);
    if (!name || !location) continue;
    merged.set(`${location}:${name}`, {
      name,
      in: location,
      required: resolved.required === true,
      schema: schemaDescriptor(document, resolved.schema),
    });
  }
  return [...merged.values()].sort(
    (left, right) => left.in.localeCompare(right.in) || left.name.localeCompare(right.name),
  );
}

function normalizeRequestBody(document, value) {
  if (!value) return undefined;
  const resolved = resolveNode(document, value);
  if (!isRecord(resolved)) return undefined;
  return {
    required: resolved.required === true,
    content: normalizeContent(document, resolved.content),
  };
}

function normalizeResponses(document, value) {
  if (!isRecord(value)) return [];
  return Object.keys(value)
    .sort(responseStatusSort)
    .map((status) => {
      const resolved = resolveNode(document, value[status]);
      return {
        status,
        content: normalizeContent(document, resolved?.content),
      };
    });
}

function normalizeContent(document, value) {
  if (!isRecord(value)) return [];
  return Object.keys(value)
    .sort()
    .map((mediaType) => {
      const media = isRecord(value[mediaType]) ? value[mediaType] : {};
      return {
        mediaType,
        schema: schemaDescriptor(document, media.schema),
      };
    });
}

function schemaDescriptor(document, value) {
  if (!isRecord(value)) return undefined;
  const resolved = resolveNode(document, value);
  const required = stringArray(resolved?.required);
  const properties = isRecord(resolved?.properties) ? Object.keys(resolved.properties).sort() : [];
  return stripUndefined({
    ref: stringValue(value.$ref),
    hash: hashValue(resolved),
    type: stringValue(resolved?.type),
    format: stringValue(resolved?.format),
    nullable: resolved?.nullable === true ? true : undefined,
    required: required.length ? required : undefined,
    properties: properties.length ? properties : undefined,
    validation: normalizeValidationSchema(value),
  });
}

function normalizeValidationSchema(value) {
  if (!isRecord(value)) return undefined;
  const propertyNames = isRecord(value.properties) ? Object.keys(value.properties).sort() : [];
  const properties = propertyNames.length
    ? Object.fromEntries(
        propertyNames.map((name) => [name, normalizeValidationSchema(value.properties[name])]),
      )
    : undefined;
  const normalizeVariants = (variants) =>
    arrayValue(variants).map(normalizeValidationSchema).filter(Boolean);
  const allOf = normalizeVariants(value.allOf);
  const anyOf = normalizeVariants(value.anyOf);
  const oneOf = normalizeVariants(value.oneOf);
  const additionalProperties = isRecord(value.additionalProperties)
    ? normalizeValidationSchema(value.additionalProperties)
    : typeof value.additionalProperties === "boolean"
      ? value.additionalProperties
      : undefined;
  return stripUndefined({
    ref: stringValue(value.$ref),
    type: stringValue(value.type),
    format: stringValue(value.format),
    nullable: value.nullable === true ? true : undefined,
    readOnly: value.readOnly === true ? true : undefined,
    writeOnly: value.writeOnly === true ? true : undefined,
    enum: Array.isArray(value.enum) && value.enum.length ? value.enum : undefined,
    required: stringArray(value.required).length ? stringArray(value.required) : undefined,
    properties,
    items: normalizeValidationSchema(value.items),
    allOf: allOf.length ? allOf : undefined,
    anyOf: anyOf.length ? anyOf : undefined,
    oneOf: oneOf.length ? oneOf : undefined,
    additionalProperties,
  });
}

function compareActionParameters(operation, action, overrideValue) {
  const override = isRecord(overrideValue) ? overrideValue : {};
  const specParameters = operation.parameters.filter((parameter) =>
    ["path", "query", "header"].includes(parameter.in),
  );
  const pathNameMap = pathParameterMap(action.endpoint.path, operation.path);
  const parameterAliases = isRecord(override.parameterAliases) ? override.parameterAliases : {};
  const actionToSpecAlias = new Map(
    Object.entries(parameterAliases).map(([specName, actionName]) => [actionName, specName]),
  );
  const normalizeActionName = (name) =>
    pathNameMap.get(name) ?? actionToSpecAlias.get(name) ?? name;
  const actionRequired = new Set((action.requiredParams ?? []).map(normalizeActionName));
  const actionOptional = new Set((action.optionalParams ?? []).map(normalizeActionName));
  const conditionalParams = new Set((action.requiredAnyOf ?? []).flat().map(normalizeActionName));
  const fixedQueryParams = fixedQueryParamNames(action.endpoint.path);
  const adapterSatisfied = new Set(stringArray(override.satisfiedByAdapter));
  const defaultedParams = new Set(
    isRecord(override.defaultedParams) ? Object.keys(override.defaultedParams) : [],
  );
  const relaxedRequired = new Set(stringArray(override.allowSpecRequiredAsOptional));
  const actionProvided = new Set([
    ...actionRequired,
    ...actionOptional,
    ...conditionalParams,
    ...fixedQueryParams,
    ...adapterSatisfied,
    ...defaultedParams,
    ...relaxedRequired,
  ]);
  const specNames = new Set(specParameters.map((parameter) => parameter.name));
  if (operation.requestBody) specNames.add("body");

  const specRequired = new Set(
    specParameters.filter((parameter) => parameter.required).map((parameter) => parameter.name),
  );
  if (operation.requestBody?.required) specRequired.add("body");
  const specOptional = new Set([...specNames].filter((name) => !specRequired.has(name)));
  const missingRequired = [...specRequired].filter((name) => !actionProvided.has(name));
  const missingOptional = [...specOptional].filter((name) => !actionProvided.has(name));
  const requirednessDrift = [...specRequired]
    .filter(
      (name) =>
        actionOptional.has(name) &&
        !actionRequired.has(name) &&
        !conditionalParams.has(name) &&
        !fixedQueryParams.includes(name) &&
        !adapterSatisfied.has(name) &&
        !defaultedParams.has(name) &&
        !relaxedRequired.has(name),
    )
    .map((name) => `${name}: spec required, SDK optional`);
  const sdkStricter = [...specOptional]
    .filter((name) => actionRequired.has(name) && !actionOptional.has(name))
    .map((name) => `${name}: spec optional, SDK required`);
  const actionExtensions = [
    ...new Set([...actionRequired, ...actionOptional, ...conditionalParams]),
  ]
    .filter((name) => !specNames.has(name))
    .sort();
  const adjusted =
    missingOptional.length ||
    actionExtensions.length ||
    fixedQueryParams.length ||
    conditionalParams.size ||
    adapterSatisfied.size ||
    defaultedParams.size ||
    relaxedRequired.size ||
    Object.keys(parameterAliases).length;
  const parameterStatus =
    missingRequired.length || requirednessDrift.length
      ? "drift"
      : sdkStricter.length
        ? "sdk_stricter"
        : adjusted
          ? "adjusted"
          : "exact";
  return {
    ...summarizeEndpointAction(action),
    parameterStatus,
    missingRequired: missingRequired.sort(),
    missingOptional: missingOptional.sort(),
    requirednessDrift: requirednessDrift.sort(),
    sdkStricter: sdkStricter.sort(),
    actionExtensions,
    fixedQueryParams,
    conditionalParams: [...conditionalParams].sort(),
    adapterSatisfied: [...adapterSatisfied].sort(),
    defaultedParams: [...defaultedParams].sort(),
    relaxedRequired: [...relaxedRequired].sort(),
    parameterAliases,
    overrideEvidence: stringValue(override.evidence),
  };
}

function summarizeEndpointAction(action) {
  return {
    action: action.action,
    namespace: action.namespace,
    safety: action.safety,
    method: action.endpoint.method,
    path: action.endpoint.path,
  };
}

function pathParameterMap(actionPath, specPath) {
  const actionNames = pathParameters(actionPath);
  const specNames = pathParameters(specPath);
  const result = new Map();
  if (actionNames.length !== specNames.length) return result;
  actionNames.forEach((name, index) => result.set(name, specNames[index]));
  return result;
}

function resolveNode(document, value) {
  if (!isRecord(value) || typeof value.$ref !== "string") return value;
  if (!value.$ref.startsWith("#/"))
    throw new Error(`Unsupported external OpenAPI ref '${value.$ref}'.`);
  let current = document;
  for (const encoded of value.$ref.slice(2).split("/")) {
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(current) || !(key in current)) {
      throw new Error(`Unresolved OpenAPI ref '${value.$ref}'.`);
    }
    current = current[key];
  }
  return current;
}

function endpointKey(endpoint) {
  return `${String(endpoint.method).toUpperCase()} ${normalizePath(endpoint.path)}`;
}

function requestPath(request) {
  const value = stringValue(request.path) ?? stringValue(request.url);
  if (!value) return undefined;
  let pathname;
  try {
    pathname = new URL(value, "https://example.invalid").pathname;
  } catch {
    pathname = value.split("?", 1)[0];
  }
  return pathname.replace(/^\/services\/data\/v\d+(?:\.\d+)?/, "") || "/";
}

function pathMatchesTemplate(observedPath, template) {
  const parts = pathOnly(template)
    .split(/\{[^}]+\}/g)
    .map(escapeRegex);
  const pattern = `^${parts.join("[^/]+")}/?$`;
  return new RegExp(pattern).test(observedPath);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePath(value) {
  return pathOnly(value).replaceAll(/\{[^}]+\}/g, "{}");
}

function pathParameters(value) {
  return [...pathOnly(value).matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

function pathOnly(value) {
  return String(value ?? "").split(/[?#]/, 1)[0];
}

function fixedQueryParamNames(value) {
  const query = String(value ?? "")
    .split("?", 2)[1]
    ?.split("#", 1)[0];
  return query ? [...new Set(new URLSearchParams(query).keys())].sort() : [];
}

function hashValue(value) {
  return createHash("sha256")
    .update(JSON.stringify(sortValue(value)))
    .digest("hex");
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

function groupBy(values, keyFor) {
  const result = new Map();
  for (const value of values) {
    const key = keyFor(value);
    const entries = result.get(key) ?? [];
    entries.push(value);
    result.set(key, entries);
  }
  return result;
}

function responseStatusSort(left, right) {
  if (left === "default") return 1;
  if (right === "default") return -1;
  return left.localeCompare(right, undefined, { numeric: true });
}

function sortRecord(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value) {
  return Array.isArray(value)
    ? value
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim())
    : [];
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
