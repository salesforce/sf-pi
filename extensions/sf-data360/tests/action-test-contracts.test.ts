/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const actions = JSON.parse(
  readFileSync(path.join(ROOT, "registry/actions.json"), "utf8"),
) as Array<{
  action: string;
  safety: string;
  requiredParams: string[];
  requiredAnyOf?: string[][];
}>;
const contracts = JSON.parse(
  readFileSync(path.join(ROOT, "registry/action-test-contracts.json"), "utf8"),
) as {
  schemaVersion: number;
  actions: Array<{
    action: string;
    safety: string;
    mode: string;
    capability: string;
    fixturePolicy: string;
    requirements: Array<{ name: string; source: string }>;
  }>;
};

describe("sf_data360 recursive action-test contracts", () => {
  it("classifies every public action exactly once", () => {
    expect(contracts.schemaVersion).toBe(1);
    expect(contracts.actions).toHaveLength(actions.length);
    expect(new Set(contracts.actions.map((contract) => contract.action)).size).toBe(actions.length);
    expect(new Set(contracts.actions.map((contract) => contract.action))).toEqual(
      new Set(actions.map((action) => action.action)),
    );
  });

  it("classifies every required parameter source", () => {
    for (const contract of contracts.actions) {
      for (const requirement of contract.requirements) {
        expect(requirement.source, `${contract.action}.${requirement.name}`).not.toBe("unmapped");
      }
    }
  });

  it("requires fixture ownership for every destructive action", () => {
    for (const contract of contracts.actions.filter(
      (contract) => contract.safety === "destructive",
    )) {
      expect(contract.fixturePolicy, contract.action).toBe("owned_only");
      expect(contract.mode, contract.action).toBe("fixture_cleanup");
    }
  });

  it("classifies parameterized local transports as asset-dependent reads", () => {
    expect(
      contracts.actions.find((contract) => contract.action === "query.sql.chunk"),
    ).toMatchObject({ mode: "asset_read", capability: "query_v3" });
    expect(
      contracts.actions.find((contract) => contract.action === "discover.action.list"),
    ).toMatchObject({ mode: "local", capability: "local" });
  });

  it("separates external delivery from ordinary org mutation", () => {
    expect(
      contracts.actions.find((contract) => contract.action === "activate.activation.create"),
    ).toMatchObject({ capability: "external_delivery", fixturePolicy: "external_explicit" });
    expect(
      contracts.actions.find((contract) => contract.action === "prepare.dlo.create"),
    ).toMatchObject({ capability: "core", fixturePolicy: "owned_only" });
  });
});
