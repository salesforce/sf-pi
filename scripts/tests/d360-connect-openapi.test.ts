/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  buildConnectOpenApiParity,
  buildPromotedConnectOperations,
  normalizeConnectOpenApi,
  parseConnectOpenApi,
  validateConnectLiveResult,
} from "../lib/d360-connect-openapi.mjs";

const source = `
openapi: 3.0.0
info:
  title: Salesforce Data 360 Connect REST API
  version: "68.0"
servers:
  - url: https://example.my.salesforce.com/services/data/v{version}
paths:
  /ssot/data-spaces:
    get:
      operationId: listDataSpaces
      parameters:
        - name: limit
          in: query
          required: false
          schema:
            type: integer
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DataSpaceCollection"
  /ssot/data-model-objects/{name}:
    parameters:
      - name: name
        in: path
        required: true
        schema:
          type: string
    patch:
      operationId: updateDataModelObject
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/DataModelObjectInput"
      responses:
        "200":
          description: OK
components:
  schemas:
    DataSpaceCollection:
      type: object
      properties:
        dataSpaces:
          type: array
          items:
            type: object
    DataModelObjectInput:
      type: object
      required: [label]
      properties:
        label:
          type: string
`;

describe("Data 360 Connect OpenAPI contract", () => {
  it("rejects HTML instead of accepting a documentation error page as YAML", () => {
    expect(() => parseConnectOpenApi("<!DOCTYPE html><title>404</title>")).toThrow(
      /OpenAPI document/i,
    );
  });

  it("normalizes Connect operations, shared path params, bodies, responses, and schema hashes", () => {
    const document = parseConnectOpenApi(source);
    const snapshot = normalizeConnectOpenApi(document, {
      sourceUrl:
        "https://developer.salesforce.com/static/datacloud/connectapi/spec/cdp-connect-api-Swagger.yaml",
      sha256: "example-sha",
    });

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      source: {
        openapi: "3.0.0",
        title: "Salesforce Data 360 Connect REST API",
        apiVersion: "68.0",
        sha256: "example-sha",
      },
      summary: { paths: 2, operations: 2, componentSchemas: 2 },
    });
    expect(snapshot.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "GET /ssot/data-spaces",
          method: "GET",
          parameters: [expect.objectContaining({ name: "limit", in: "query", required: false })],
          responses: [
            expect.objectContaining({
              status: "200",
              content: [
                expect.objectContaining({
                  mediaType: "application/json",
                  schema: expect.objectContaining({
                    ref: "#/components/schemas/DataSpaceCollection",
                    hash: expect.stringMatching(/^[a-f0-9]{64}$/),
                  }),
                }),
              ],
            }),
          ],
        }),
        expect.objectContaining({
          key: "PATCH /ssot/data-model-objects/{}",
          path: "/ssot/data-model-objects/{name}",
          parameters: [expect.objectContaining({ name: "name", in: "path", required: true })],
          requestBody: expect.objectContaining({
            required: true,
            content: [
              expect.objectContaining({
                schema: expect.objectContaining({
                  ref: "#/components/schemas/DataModelObjectInput",
                }),
              }),
            ],
          }),
        }),
      ]),
    );
    expect(snapshot.schemas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "DataModelObjectInput",
          hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          required: ["label"],
        }),
      ]),
    );
  });

  it("validates live SDK method, path, and status evidence against the Connect contract", () => {
    const snapshot = normalizeConnectOpenApi(parseConnectOpenApi(source), {
      sourceUrl: "https://example.invalid/connect.yaml",
      sha256: "example-sha",
    });
    const action = {
      action: "prepare.dataspace.list",
      namespace: "prepare",
      safety: "read",
      requiredParams: [],
      optionalParams: ["limit"],
      endpoint: { method: "GET", path: "/ssot/data-spaces" },
    };

    expect(
      validateConnectLiveResult(snapshot, action, {
        status: 200,
        request: {
          method: "GET",
          path: "/services/data/v68.0/ssot/data-spaces?limit=1",
        },
        response: { dataSpaces: [] },
      }),
    ).toMatchObject({
      status: "conformant",
      fail: false,
      checks: {
        method: true,
        path: true,
        responseStatus: true,
        requestBody: "not_declared",
        responseBody: "pass",
      },
      operationKey: "GET /ssot/data-spaces",
    });
    expect(
      validateConnectLiveResult(snapshot, action, {
        status: 418,
        request: { method: "GET", path: "/services/data/v68.0/ssot/data-spaces" },
      }),
    ).toMatchObject({ status: "response_drift", fail: true });
    expect(
      validateConnectLiveResult(snapshot, action, {
        status: 200,
        request: { method: "GET", path: "/services/data/v68.0/ssot/segments" },
        response: { dataSpaces: [] },
      }),
    ).toMatchObject({ status: "request_drift", fail: true });

    const updateAction = {
      action: "harmonize.dmo.update",
      namespace: "harmonize",
      safety: "confirmed",
      requiredParams: ["dmoName", "body"],
      optionalParams: [],
      endpoint: { method: "PATCH", path: "/ssot/data-model-objects/{dmoName}" },
    };
    expect(
      validateConnectLiveResult(snapshot, updateAction, {
        status: 200,
        request: {
          method: "PATCH",
          path: "/services/data/v68.0/ssot/data-model-objects/Example__dlm",
          body: {},
        },
      }),
    ).toMatchObject({
      status: "request_body_drift",
      fail: true,
      checks: { requestBody: "fail" },
      requestBodyErrors: ["$.label is required"],
    });
    const responseDrift = {
      status: 200,
      request: { method: "GET", path: "/services/data/v68.0/ssot/data-spaces" },
      response: [],
    };
    expect(validateConnectLiveResult(snapshot, action, responseDrift)).toMatchObject({
      status: "response_body_drift",
      fail: true,
      checks: { responseBody: "fail" },
    });
    expect(
      validateConnectLiveResult(snapshot, action, responseDrift, {
        responseSchemaOverrides: { "200": { type: "array" } },
        evidence: "Bounded live response uses an array envelope.",
      }),
    ).toMatchObject({
      status: "conformant_with_override",
      fail: false,
      checks: { responseBody: "pass_override" },
      overrideEvidence: "Bounded live response uses an array envelope.",
    });
    expect(
      validateConnectLiveResult(
        snapshot,
        action,
        {
          status: 201,
          request: { method: "GET", path: "/services/data/v68.0/ssot/data-spaces" },
          response: { dataSpaces: [] },
        },
        {
          responseStatusAliases: { "201": "200" },
          evidence: "The live service returns 201 for this successful operation.",
        },
      ),
    ).toMatchObject({
      status: "conformant_with_override",
      fail: false,
      checks: { responseStatus: true },
      responseStatusOverride: { observed: "201", declared: "200" },
    });
  });

  it("compares the OpenAPI surface with SDK actions by method and normalized path", () => {
    const snapshot = normalizeConnectOpenApi(parseConnectOpenApi(source), {
      sourceUrl: "https://example.invalid/connect.yaml",
      sha256: "example-sha",
    });
    const report = buildConnectOpenApiParity(snapshot, [
      {
        action: "prepare.dataspace.list",
        namespace: "prepare",
        safety: "read",
        requiredParams: [],
        optionalParams: ["limit"],
        endpoint: { method: "GET", path: "/ssot/data-spaces" },
      },
      {
        action: "prepare.dataspace.first",
        namespace: "prepare",
        safety: "read",
        requiredParams: [],
        optionalParams: [],
        endpoint: { method: "GET", path: "/ssot/data-spaces?limit=1" },
      },
      {
        action: "harmonize.dmo.update",
        namespace: "harmonize",
        safety: "confirmed",
        requiredParams: ["dmoName", "body"],
        optionalParams: [],
        endpoint: { method: "PATCH", path: "/ssot/data-model-objects/{dmoName}" },
      },
      {
        action: "prepare.stream.list",
        namespace: "prepare",
        safety: "read",
        requiredParams: [],
        optionalParams: [],
        endpoint: { method: "GET", path: "/ssot/data-streams" },
      },
    ]);

    expect(report.summary).toMatchObject({
      openApiOperations: 2,
      matchedOpenApiOperations: 2,
      openApiOnlyOperations: 0,
      sdkEndpointActions: 4,
      matchedSdkActions: 3,
      sdkOnlyActions: 1,
      openApiOperationsWithSdkPathOverlap: 0,
      sdkActionsWithOpenApiPathOverlap: 0,
    });
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "GET /ssot/data-spaces",
          status: "matched",
          actions: [
            expect.objectContaining({
              action: "prepare.dataspace.first",
              parameterStatus: "adjusted",
            }),
            expect.objectContaining({
              action: "prepare.dataspace.list",
              parameterStatus: "exact",
            }),
          ],
        }),
        expect.objectContaining({
          key: "PATCH /ssot/data-model-objects/{}",
          status: "matched",
          actions: [
            expect.objectContaining({
              action: "harmonize.dmo.update",
              parameterStatus: "exact",
            }),
          ],
        }),
      ]),
    );
    expect(report.sdkOnly).toEqual([
      expect.objectContaining({ action: "prepare.stream.list", status: "sdk_only" }),
    ]);
  });

  it("treats different methods on one path as distinct missing operations, not mismatches", () => {
    const snapshot = normalizeConnectOpenApi(parseConnectOpenApi(source), {
      sourceUrl: "https://example.invalid/connect.yaml",
      sha256: "example-sha",
    });
    const report = buildConnectOpenApiParity(snapshot, [
      {
        action: "prepare.dataspace.create",
        namespace: "prepare",
        safety: "confirmed",
        requiredParams: ["body"],
        optionalParams: [],
        endpoint: { method: "POST", path: "/ssot/data-spaces" },
      },
    ]);

    expect(report.entries.find((entry) => entry.key === "GET /ssot/data-spaces")).toMatchObject({
      status: "openapi_only",
      sdkMethodsAtPath: ["POST"],
    });
    expect(report.sdkOnly).toEqual([
      expect.objectContaining({
        action: "prepare.dataspace.create",
        status: "sdk_only",
        openApiMethods: ["GET"],
      }),
    ]);
    expect(report.summary).toMatchObject({
      openApiOperationsWithSdkPathOverlap: 1,
      sdkActionsWithOpenApiPathOverlap: 1,
      methodMismatches: 0,
    });
  });

  it("builds reviewed SDK operations from promoted OpenAPI keys", () => {
    const snapshot = normalizeConnectOpenApi(parseConnectOpenApi(source), {
      sourceUrl: "https://example.invalid/connect.yaml",
      sha256: "example-sha",
    });
    expect(
      buildPromotedConnectOperations(snapshot, {
        waves: [{ id: "wave1", keys: ["GET /ssot/data-spaces"] }],
        promotions: [
          {
            key: "GET /ssot/data-spaces",
            name: "connect_openapi_dataspace_list",
            family: "Metadata",
            wave: "wave1",
            namespace: "prepare",
            phase: "prepare",
            action: "dataspace.openapi_list",
            safety: "read",
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        name: "connect_openapi_dataspace_list",
        family: "Metadata",
        method: "GET",
        path: "/ssot/data-spaces",
        origin: "connect_openapi",
        requiredParams: [],
        optionalParams: ["limit"],
        parameterSchemas: { limit: { type: "integer" } },
        promotion: {
          wave: "wave1",
          namespace: "prepare",
          phase: "prepare",
          action: "dataspace.openapi_list",
        },
      }),
    ]);
  });

  it("tracks promoted and remaining operations across ordered waves", () => {
    const snapshot = normalizeConnectOpenApi(parseConnectOpenApi(source), {
      sourceUrl: "https://example.invalid/connect.yaml",
      sha256: "example-sha",
    });
    const report = buildConnectOpenApiParity(
      snapshot,
      [
        {
          action: "prepare.dataspace.list",
          namespace: "prepare",
          safety: "read",
          requiredParams: [],
          optionalParams: ["limit"],
          endpoint: { method: "GET", path: "/ssot/data-spaces" },
        },
      ],
      {},
      {
        waves: [
          {
            id: "wave1",
            label: "First wave",
            keys: ["GET /ssot/data-spaces"],
          },
          { id: "wave2", label: "Remaining updates", methods: ["PATCH"] },
        ],
        promotions: [{ key: "GET /ssot/data-spaces" }],
      },
    );

    expect(report.promotionWaves).toEqual([
      { id: "wave1", label: "First wave", total: 1, promoted: 1, remaining: 0 },
      { id: "wave2", label: "Remaining updates", total: 1, promoted: 0, remaining: 1 },
    ]);
  });

  it("rejects stale overrides that no longer name an endpoint action", () => {
    const snapshot = normalizeConnectOpenApi(parseConnectOpenApi(source), {
      sourceUrl: "https://example.invalid/connect.yaml",
      sha256: "example-sha",
    });
    expect(() =>
      buildConnectOpenApiParity(snapshot, [], {
        actions: { "prepare.missing": { evidence: "stale" } },
      }),
    ).toThrow(/unknown endpoint action 'prepare\.missing'/);
  });

  it("classifies a safer SDK-required optional parameter separately from drift", () => {
    const snapshot = normalizeConnectOpenApi(parseConnectOpenApi(source), {
      sourceUrl: "https://example.invalid/connect.yaml",
      sha256: "example-sha",
    });
    const report = buildConnectOpenApiParity(snapshot, [
      {
        action: "prepare.dataspace.list_strict",
        namespace: "prepare",
        safety: "read",
        requiredParams: ["limit"],
        optionalParams: [],
        endpoint: { method: "GET", path: "/ssot/data-spaces" },
      },
    ]);

    expect(report.entries[0]?.actions[0]).toMatchObject({
      parameterStatus: "sdk_stricter",
      sdkStricter: ["limit: spec optional, SDK required"],
    });
    expect(report.summary).toMatchObject({
      sdkStricterParameterActions: 1,
      parameterDriftActions: 0,
    });
  });
});
