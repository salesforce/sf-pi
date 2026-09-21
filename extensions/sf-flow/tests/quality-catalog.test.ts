/* SPDX-License-Identifier: Apache-2.0 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FLOW_QUALITY_RULES,
  LIGHTNING_FLOW_SCANNER_RULE_IDS,
  qualityRulesForProfile,
} from "../lib/quality/catalog.ts";
import { qualityRules } from "../lib/operations.ts";
import { QUALITY_EVALUATORS } from "../lib/quality/rules.ts";

const expectedUpstreamIds = [
  "action-call-in-loop",
  "cognitive-complexity",
  "dml-in-loop",
  "duplicate-dml",
  "excessive-cyclomatic-complexity",
  "get-record-all-fields",
  "hardcoded-id",
  "hardcoded-secret",
  "hardcoded-url",
  "inactive-flow",
  "invalid-api-version",
  "invalid-naming-convention",
  "missing-auto-layout",
  "missing-fault-path",
  "missing-flow-description",
  "missing-metadata-description",
  "missing-null-handler",
  "missing-record-trigger-filter",
  "missing-start-reference",
  "process-builder-usage",
  "record-id-as-string",
  "recursive-record-update",
  "same-record-field-updates",
  "soql-in-loop",
  "transform-instead-of-loop",
  "unclear-api-naming",
  "unsafe-running-context",
  "unreachable-element",
  "unspecified-trigger-order",
  "unused-variable",
].sort();

describe("SF Flow quality catalog", () => {
  it("accounts for all 30 published Lightning Flow Scanner rule ids", () => {
    expect([...LIGHTNING_FLOW_SCANNER_RULE_IDS].sort()).toEqual(expectedUpstreamIds);
    const inspired = FLOW_QUALITY_RULES.filter((rule) => rule.provenance.lightning_flow_scanner);
    expect(inspired).toHaveLength(30);
    expect(inspired.filter((rule) => rule.implementation === "implemented")).toHaveLength(30);
    expect(inspired.filter((rule) => rule.implementation === "planned")).toHaveLength(0);
  });

  it("uses fresh SF Pi messages and explicit upstream provenance", () => {
    for (const rule of FLOW_QUALITY_RULES.filter(
      (candidate) => candidate.provenance.lightning_flow_scanner,
    )) {
      expect(rule.provenance.lightning_flow_scanner).toMatchObject({
        version: "6.19.4",
        rule_id: rule.id,
      });
      expect(rule.message.length).toBeGreaterThan(20);
      expect(rule.message).not.toBe(rule.label);
    }
  });

  it("backs every implemented quality-engine catalog entry with an evaluator", () => {
    const evaluatorIds = new Set(Object.keys(QUALITY_EVALUATORS));
    for (const rule of FLOW_QUALITY_RULES.filter(
      (candidate) => candidate.implementation === "implemented" && candidate.engine === "quality",
    )) {
      expect(evaluatorIds.has(rule.id), rule.id).toBe(true);
    }
  });

  it("keeps review and audit-only rules out of the generation hot path", () => {
    const ids = new Set(qualityRulesForProfile("generation").map((rule) => rule.id));
    expect(ids.has("hardcoded-id")).toBe(true);
    expect(ids.has("invalid-naming-convention")).toBe(false);
    expect(ids.has("inactive-flow")).toBe(false);
    expect(ids.has("cognitive-complexity")).toBe(false);
  });

  it("exposes credits and implementation status through quality.rules", () => {
    const result = qualityRules({
      action: "quality.rules",
      quality_profile: "generation",
    });

    expect(result.details).toMatchObject({
      ok: true,
      acknowledgement: {
        project: "Lightning Flow Scanner",
        license: "MIT",
        implementation: "independent SF Pi white-room reimplementation",
      },
    });
    expect(result.details.implemented).toBe(34);
    expect(result.details.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "conflicting-create-output-storage", engine: "core" }),
        expect.objectContaining({ id: "invalid-async-path-configuration", engine: "core" }),
        expect.objectContaining({ id: "missing-async-path-entry-guard", engine: "core" }),
        expect.objectContaining({ id: "invalid-start-filter-logic", engine: "core" }),
        expect.objectContaining({ id: "invalid-record-filter", engine: "core" }),
      ]),
    );
  });

  it("prohibits upstream production imports", () => {
    const libRoot = path.resolve(import.meta.dirname, "../lib");
    const productionFiles = walk(libRoot).filter((file) => file.endsWith(".ts"));
    const offenders = productionFiles.filter((file) =>
      readFileSync(file, "utf8").includes("@flow-scanner/"),
    );
    expect(offenders).toEqual([]);
  });
});

function walk(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
