/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { classifyD360Request, normalizeMethod } from "../lib/safety.ts";

describe("sf-data360 safety classifier", () => {
  it("allows reads", () => {
    const decision = classifyD360Request("GET", "/ssot/data-model-objects", "production");
    expect(decision.level).toBe("read");
    expect(decision.requiresConfirmation).toBe(false);
  });

  it("allows known query/search/validation POST paths", () => {
    expect(
      classifyD360Request("POST", "/connect/search/metadata/results", "production")
        .requiresConfirmation,
    ).toBe(false);
    expect(
      classifyD360Request("POST", "/ssot/query-sql?limit=10", "production").requiresConfirmation,
    ).toBe(false);
    expect(
      classifyD360Request("POST", "/ssot/calculated-insights/actions/validate", "production")
        .requiresConfirmation,
    ).toBe(false);
  });

  it("allows Swagger read-like POST paths", () => {
    const safePostPaths = [
      "/ssot/connections/abc/database-schemas",
      "/ssot/connections/abc/databases",
      "/ssot/connections/abc/objects",
      "/ssot/connections/abc/objects/Account/fields",
      "/ssot/connections/abc/objects/Account/preview",
      "/ssot/connections/abc/actions/test",
      "/ssot/connections/abc/schema/actions/test",
      "/ssot/segments/MySegment/actions/count",
      "/ssot/machine-learning/predict",
      "/ssot/machine-learning/alerts",
      "/ssot/machine-learning/query-setup-fields",
      "/ssot/machine-learning/query-data-profile",
      "/ssot/machine-learning/query-outcome",
      "/ssot/machine-learning/query-row-count",
    ];

    for (const path of safePostPaths) {
      expect(classifyD360Request("POST", path, "production")).toMatchObject({
        requiresConfirmation: false,
      });
    }
  });

  it("confirms destructive and action paths", () => {
    expect(classifyD360Request("DELETE", "/ssot/segments/123", "sandbox")).toMatchObject({
      level: "delete",
      requiresConfirmation: true,
    });
    expect(
      classifyD360Request("POST", "/ssot/segments/123/actions/publish", "sandbox"),
    ).toMatchObject({ level: "publish", requiresConfirmation: true });
    expect(classifyD360Request("POST", "/ssot/data-streams/123/run", "sandbox")).toMatchObject({
      level: "run",
      requiresConfirmation: true,
    });
    expect(
      classifyD360Request("POST", "/ssot/data-graphs/Graph/actions/refresh", "sandbox"),
    ).toMatchObject({ level: "run", requiresConfirmation: true });
    expect(
      classifyD360Request("POST", "/ssot/segments/Segment/actions/deactivate", "sandbox"),
    ).toMatchObject({ level: "update", requiresConfirmation: true });
    expect(
      classifyD360Request("POST", "/ssot/data-transforms/Transform/actions/cancel", "sandbox"),
    ).toMatchObject({ level: "run", requiresConfirmation: true });
    expect(classifyD360Request("POST", "/ssot/data-kits/KitName", "sandbox")).toMatchObject({
      level: "deploy",
      requiresConfirmation: true,
    });
    expect(
      classifyD360Request("POST", "/ssot/data-action-targets/Target/signing-key", "sandbox"),
    ).toMatchObject({ level: "update", requiresConfirmation: true });
  });

  it("confirms unclassified writes only for production-like orgs", () => {
    expect(classifyD360Request("POST", "/ssot/data-model-objects", "sandbox")).toMatchObject({
      level: "create",
      requiresConfirmation: false,
    });
    expect(classifyD360Request("POST", "/ssot/data-model-objects", "unknown")).toMatchObject({
      level: "create",
      requiresConfirmation: true,
    });
    expect(classifyD360Request("PATCH", "/ssot/data-model-objects/X", "production")).toMatchObject({
      level: "update",
      requiresConfirmation: true,
    });
  });

  it("normalizes methods", () => {
    expect(normalizeMethod("get")).toBe("GET");
    expect(() => normalizeMethod("TRACE")).toThrow("Unsupported Data 360 method");
  });
});
