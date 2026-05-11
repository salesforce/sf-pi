/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pin every scheme we observed in real-world recipes to either a
 * resolver or an explicit allow-list of unverifiable schemes. The
 * intent: a refactor that drops a resolver should fail this test
 * loudly rather than silently regressing pre-flight coverage.
 */

import { describe, expect, it } from "vitest";
import { listResolvers, registeredSchemes } from "../../lib/preflight/registry.ts";

// Every scheme we observed in the salesforce/agentscript corpus +
// trailheadapps/agent-script-recipes — counted with grep, sorted by
// occurrence. See docs/PREFLIGHT_DESIGN.md for the survey.
const KNOWN_SCHEMES_FROM_CORPUS = [
  "flow",
  "apex",
  "standardInvocableAction",
  "agentforce",
  "externalService",
  "model",
  "ext",
  "mcp",
  "llm",
  "generatePromptResponse",
  "apexRest",
  "integrationProcedureAction",
  "quickAction",
  "retriever",
  "slack",
  "serviceCatalog",
  "createCatalogItemRequest",
  "cdpMlPrediction",
  "byon",
  "placeholder",
  "mcpTool",
  "namedQuery",
  "expressionSet",
  "executeIntegrationProcedure",
  "externalConnector",
  "custom",
  "type",
  "schema",
  "http",
  "https",
] as const;

// Schemes the registry intentionally doesn't pre-flight today — either
// they're test stubs, industry-specific (Data Cloud, OmniStudio), or
// would require licensed feature checks. Every scheme in this list MUST
// be missing from the registry; if a resolver gets added, drop the
// scheme from this list.
const KNOWN_UNVERIFIABLE = new Set([
  "model", // foundation model — not queryable as a single SF row today
  "ext", // test stub
  "llm", // test stub
  "integrationProcedureAction",
  "retriever",
  "serviceCatalog",
  "createCatalogItemRequest",
  "cdpMlPrediction",
  "namedQuery",
  "expressionSet",
  "executeIntegrationProcedure",
  "externalConnector",
  "custom",
  "type",
  "schema",
]);

describe("preflight registry", () => {
  it("registers exactly one resolver per declared scheme (no conflicts)", () => {
    const seen = new Set<string>();
    for (const r of listResolvers()) {
      for (const s of r.schemes) {
        expect(seen.has(s), `scheme '${s}' registered twice`).toBe(false);
        seen.add(s);
      }
    }
  });

  it("every registered resolver carries a metadataLabel", () => {
    for (const r of listResolvers()) {
      expect(r.metadataLabel.length, `${r.schemes.join(",")} missing label`).toBeGreaterThan(0);
    }
  });

  it("every corpus scheme is either resolved or in KNOWN_UNVERIFIABLE", () => {
    const registered = new Set(registeredSchemes());
    const orphans: string[] = [];
    for (const scheme of KNOWN_SCHEMES_FROM_CORPUS) {
      if (registered.has(scheme)) continue;
      if (KNOWN_UNVERIFIABLE.has(scheme)) continue;
      orphans.push(scheme);
    }
    expect(
      orphans,
      `These schemes have no resolver and aren't in KNOWN_UNVERIFIABLE: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("KNOWN_UNVERIFIABLE entries do not have a registered resolver", () => {
    const registered = new Set(registeredSchemes());
    const conflicts: string[] = [];
    for (const scheme of KNOWN_UNVERIFIABLE) {
      if (registered.has(scheme)) conflicts.push(scheme);
    }
    expect(
      conflicts,
      `These schemes are in KNOWN_UNVERIFIABLE but a resolver was added — drop them from the list: ${conflicts.join(", ")}`,
    ).toEqual([]);
  });

  it("registers the high-traffic schemes (>50 occurrences in the corpus)", () => {
    const registered = new Set(registeredSchemes());
    const required = ["flow", "apex", "standardInvocableAction", "agentforce", "externalService"];
    for (const s of required) {
      expect(registered.has(s), `scheme '${s}' must be registered`).toBe(true);
    }
  });
});
