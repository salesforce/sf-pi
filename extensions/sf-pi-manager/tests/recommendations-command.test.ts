/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for `/sf-pi recommended` argument parsing and the first-run nudge
 * decision.
 *
 * Covers: parseRecommendedArgs, computeRecommendationsNudge
 *
 * The nudge rule is small but deserves explicit tests because it's the
 * contract that "installed once, left alone" relies on.
 */
import { describe, it, expect } from "vitest";
import type { RecommendationsManifest } from "../../../catalog/types.ts";
import { computeRecommendationsNudge, parseRecommendedArgs } from "../lib/recommendations.ts";
import type { RecommendationsState } from "../../../lib/common/catalog-state/recommendations-state.ts";

// -------------------------------------------------------------------------------------------------
// parseRecommendedArgs
// -------------------------------------------------------------------------------------------------

describe("parseRecommendedArgs", () => {
  it("defaults to overlay with global scope for empty input", () => {
    const r = parseRecommendedArgs("");
    expect(r.subcommand).toBe("overlay");
    expect(r.scope).toBe("global");
  });

  it("routes install with target", () => {
    const r = parseRecommendedArgs("install my-item");
    expect(r.subcommand).toBe("install");
    expect(r.target).toBe("my-item");
    expect(r.scope).toBe("global");
  });

  it("respects trailing project scope", () => {
    const r = parseRecommendedArgs("install my-item project");
    expect(r.subcommand).toBe("install");
    expect(r.target).toBe("my-item");
    expect(r.scope).toBe("project");
  });

  it("accepts 'rm' as remove alias", () => {
    const r = parseRecommendedArgs("rm my-item");
    expect(r.subcommand).toBe("remove");
    expect(r.target).toBe("my-item");
  });

  it("routes status", () => {
    const r = parseRecommendedArgs("status");
    expect(r.subcommand).toBe("status");
  });

  it("ignores 'global' / 'project' as a target", () => {
    const r = parseRecommendedArgs("install project");
    expect(r.subcommand).toBe("install");
    expect(r.target).toBeUndefined();
    expect(r.scope).toBe("project");
  });
});

// -------------------------------------------------------------------------------------------------
// computeRecommendationsNudge
// -------------------------------------------------------------------------------------------------

function makeManifest(overrides: Partial<RecommendationsManifest> = {}): RecommendationsManifest {
  return {
    schemaVersion: 1,
    revision: "r1",
    bundles: [
      { id: "default", name: "Default", description: "", defaultOnFirstRun: true, items: ["a"] },
    ],
    items: {
      a: {
        id: "a",
        name: "A",
        description: "",
        source: "git:example.com/a",
        homepage: "https://example.com/a",
        license: "MIT",
        rationale: "r",
      },
    },
    ...overrides,
  };
}

function makeState(overrides: Partial<RecommendationsState> = {}): RecommendationsState {
  return { acknowledgedRevision: "", decisions: {}, ...overrides };
}

describe("computeRecommendationsNudge", () => {
  it("shows when there is a pending default-bundle item and no ack", () => {
    const nudge = computeRecommendationsNudge(makeManifest(), makeState(), {});
    expect(nudge.show).toBe(true);
    expect(nudge.pendingCount).toBe(1);
  });

  it("hides once the user acknowledged the current revision", () => {
    const nudge = computeRecommendationsNudge(
      makeManifest(),
      makeState({ acknowledgedRevision: "r1" }),
      {},
    );
    expect(nudge.show).toBe(false);
  });

  it("re-arms when the manifest revision changes", () => {
    const manifest = makeManifest({ revision: "r2" });
    const state = makeState({ acknowledgedRevision: "r1" });
    const nudge = computeRecommendationsNudge(manifest, state, {});
    expect(nudge.show).toBe(true);
  });

  it("hides when every default item is already installed or declined", () => {
    const state = makeState({ decisions: { a: "installed" } });
    expect(computeRecommendationsNudge(makeManifest(), state, {}).show).toBe(false);

    const state2 = makeState({ decisions: { a: "declined" } });
    expect(computeRecommendationsNudge(makeManifest(), state2, {}).show).toBe(false);
  });

  it("respects SF_PI_RECOMMENDATIONS=off", () => {
    const nudge = computeRecommendationsNudge(makeManifest(), makeState(), {
      SF_PI_RECOMMENDATIONS: "off",
    });
    expect(nudge.show).toBe(false);
  });

  it("hides when the manifest has no revision", () => {
    const nudge = computeRecommendationsNudge(makeManifest({ revision: "" }), makeState(), {});
    expect(nudge.show).toBe(false);
  });

  it("hides when no bundle is flagged defaultOnFirstRun", () => {
    const manifest = makeManifest({
      bundles: [
        { id: "power", name: "Power", description: "", defaultOnFirstRun: false, items: ["a"] },
      ],
    });
    const nudge = computeRecommendationsNudge(manifest, makeState(), {});
    expect(nudge.show).toBe(false);
  });
});
