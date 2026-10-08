/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import type { SfSoqlSessionState, SObjectDescribe } from "../lib/types.ts";
import { inspectQuery, inspectionHasErrors } from "../lib/validator.ts";

const OBJECT_COUNT = 20;
const ROUNDS = 5;

function cacheHarness(): {
  session: SalesforceSession;
  requestMock: ReturnType<typeof vi.fn>;
} {
  const target = Object.freeze({
    targetOrg: "ExampleOrg",
    alias: "ExampleOrg",
    username: "user@example.invalid",
    instanceUrl: "https://example.sandbox.my.salesforce.com",
    orgType: "sandbox" as const,
    apiVersion: "67.0",
    maxApiVersion: "67.0",
    versionSource: "org-latest" as const,
  });
  const describes = new Map<string, SObjectDescribe>();
  for (let index = 0; index < OBJECT_COUNT; index++) {
    const name = `Synthetic_${index}__c`;
    describes.set(name, {
      name,
      queryable: true,
      fields: [
        { name: "Id", type: "id", filterable: true, sortable: true },
        { name: "Value__c", type: "string", filterable: true, sortable: true },
      ],
      childRelationships: [],
    });
  }
  const requestMock = vi.fn(async (input: { path: string }) => {
    let status = 200;
    let body: unknown;
    if (input.path === "/sobjects") {
      body = { sobjects: [...describes.keys()].map((name) => ({ name, queryable: true })) };
    } else if (input.path === "/tooling/sobjects") {
      body = { sobjects: [] };
    } else {
      const match = /^\/sobjects\/([^/]+)\/describe$/.exec(input.path);
      const objectDescribe = match ? describes.get(decodeURIComponent(match[1])) : undefined;
      if (objectDescribe) body = objectDescribe;
      else {
        status = 404;
        body = [{ errorCode: "NOT_FOUND", message: "Synthetic schema not found." }];
      }
    }
    return {
      status,
      body,
      path: `/services/data/v67.0${input.path}`,
      target,
      warnings: [],
    };
  });
  const session: SalesforceSession = {
    target,
    connection: {} as SalesforceSession["connection"],
    identity: vi.fn(),
    path: vi.fn((resource: string) => `/services/data/v67.0${resource}`),
    request: requestMock as SalesforceSession["request"],
    continueRequest: vi.fn() as SalesforceSession["continueRequest"],
    query: vi.fn() as SalesforceSession["query"],
  };
  return { session, requestMock };
}

describe("SF SOQL schema cache", () => {
  it("keeps metadata calls proportional to unique objects across a long session", async () => {
    const { session, requestMock } = cacheHarness();
    const state: SfSoqlSessionState = {};
    let inspections = 0;

    for (let round = 0; round < ROUNDS; round++) {
      for (let index = 0; index < OBJECT_COUNT; index++) {
        const inspection = await inspectQuery(
          session,
          {
            action: "query.validate",
            target_org: "ExampleOrg",
            query: `SELECT Id, Value__c FROM Synthetic_${index}__c LIMIT 1`,
          },
          state,
        );
        expect(inspectionHasErrors(inspection)).toBe(false);
        inspections++;
      }
    }

    const paths = requestMock.mock.calls.map(([input]) => (input as { path: string }).path);
    const catalogCalls = paths.filter(
      (path) => path === "/sobjects" || path === "/tooling/sobjects",
    );
    const describeCalls = paths.filter((path) => path.endsWith("/describe"));
    expect({
      inspections,
      catalogCalls: catalogCalls.length,
      describeCalls: describeCalls.length,
    }).toEqual({
      inspections: OBJECT_COUNT * ROUNDS,
      catalogCalls: 2,
      describeCalls: OBJECT_COUNT,
    });
  });
});
