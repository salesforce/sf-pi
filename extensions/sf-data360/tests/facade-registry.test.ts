/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  D360_EXAMPLES,
  D360_FAMILIES,
  D360_OPERATIONS,
  D360_RUNBOOKS,
  findOperation,
  findRunbook,
  searchRegistry,
} from "../lib/facade/registry.ts";

describe("d360 facade registry", () => {
  it("keeps operation and runbook names unique", () => {
    const operationNames = D360_OPERATIONS.map((operation) => operation.name);
    const runbookNames = D360_RUNBOOKS.map((runbook) => runbook.name);

    expect(new Set(operationNames).size).toBe(operationNames.length);
    expect(new Set(runbookNames).size).toBe(runbookNames.length);
  });

  it("finds Agentforce observability by intent", () => {
    const results = searchRegistry("agent trace errors");

    expect(results[0]?.family).toBe("Agent Observability");
    expect(results[0]?.runbooks).toContain("agent_observability.platform_error_traces");
  });

  it("finds expanded read-only domain families by intent", () => {
    expect(searchRegistry("data stream connector ingestion")[0]).toMatchObject({
      family: "Ingestion",
      operations: expect.arrayContaining(["d360_data_streams_list", "d360_connectors_list"]),
    });
    expect(searchRegistry("identity resolution rulesets")[0]).toMatchObject({
      family: "Identity Resolution",
      operations: expect.arrayContaining(["d360_identity_resolutions_list"]),
    });
    expect(searchRegistry("semantic retriever search index")[0]).toMatchObject({
      family: "Semantic Retrieval",
      operations: expect.arrayContaining(["d360_semantic_models_list", "d360_retrievers_list"]),
    });
    expect(searchRegistry("datakit bundle deploy")[0]).toMatchObject({
      family: "DataKit",
      operations: expect.arrayContaining(["d360_datakits_list"]),
    });
  });

  it("returns operation and runbook examples that point at registered names", () => {
    for (const example of Object.values(D360_EXAMPLES) as Array<Record<string, unknown>>) {
      const operation = typeof example.operation === "string" ? example.operation : undefined;
      const runbook = typeof example.runbook === "string" ? example.runbook : undefined;
      if (operation) expect(findOperation(operation)).toBeTruthy();
      if (runbook) expect(findRunbook(runbook)).toBeTruthy();
      expect(operation || runbook).toBeTruthy();
    }
  });

  it("validates registry integrity", () => {
    const families = new Set(D360_FAMILIES.map((family) => family.name));

    for (const operation of D360_OPERATIONS) {
      expect(families.has(operation.family), `${operation.name} has unknown family`).toBe(true);
      expect(["read", "safe_post", "confirmed", "destructive"]).toContain(operation.safety);
      expect(operation.path).toMatch(/^\//);
      for (const pathParam of operation.path.matchAll(/\{([^}]+)\}/g)) {
        expect(
          operation.requiredParams ?? [],
          `${operation.name} missing path param declaration`,
        ).toContain(pathParam[1]);
      }
    }

    for (const runbook of D360_RUNBOOKS) {
      expect(families.has(runbook.family), `${runbook.name} has unknown family`).toBe(true);
    }
  });
});
