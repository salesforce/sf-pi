/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const BUSINESS_NAMESPACES = [
  "discover",
  "connect",
  "prepare",
  "harmonize",
  "segment",
  "activate",
  "query",
  "semantic",
  "observe",
  "orchestrate",
  "api",
] as const;

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), "utf8")) as T;
}

describe("SF Data 360 hard cutover contract", () => {
  it("exposes exactly one Pi system tool", () => {
    const manifest = readJson<{ tools: string[] }>("manifest.json");
    expect(manifest.tools).toEqual(["sf_data360"]);
  });

  it("publishes one globally unique action catalog under the business namespaces", () => {
    const actions = readJson<Array<{ action: string; namespace: string }>>("registry/actions.json");
    expect(actions.length).toBeGreaterThan(250);
    expect(new Set(actions.map((action) => action.action)).size).toBe(actions.length);
    expect(new Set(actions.map((action) => action.namespace))).toEqual(
      new Set(BUSINESS_NAMESPACES),
    );
    for (const action of actions) {
      expect(action.action.startsWith(`${action.namespace}.`)).toBe(true);
    }
  });

  it("keeps every public journey reference on the single-tool action surface", () => {
    const actions = readJson<Array<{ action: string }>>("registry/actions.json");
    const journeys = readJson<
      Array<{
        name: string;
        planAction: string;
        runAction: string;
        verification: string[];
        availableActions: Array<{ tool: string; action: string }>;
      }>
    >("registry/journey-catalog.json");
    const actionNames = new Set(actions.map((action) => action.action));

    for (const journey of journeys) {
      expect(actionNames.has(journey.planAction), `${journey.name} planAction`).toBe(true);
      expect(actionNames.has(journey.runAction), `${journey.name} runAction`).toBe(true);
      for (const action of journey.verification) {
        expect(actionNames.has(action), `${journey.name} verification ${action}`).toBe(true);
      }
      for (const reference of journey.availableActions) {
        expect(reference.tool, `${journey.name} ${reference.action}`).toBe("sf_data360");
        expect(actionNames.has(reference.action), `${journey.name} ${reference.action}`).toBe(true);
      }
    }
  });

  it("deletes legacy public tool implementations and card rendering", () => {
    for (const relativePath of [
      "lib/facade-tool.ts",
      "lib/api-tool.ts",
      "lib/metadata-tool.ts",
      "lib/probe-tool.ts",
      "lib/display",
      "lib/v2/tools.ts",
      "registry/v2",
      "references/compatibility",
    ]) {
      expect(existsSync(path.join(ROOT, relativePath)), relativePath).toBe(false);
    }
  });
});
