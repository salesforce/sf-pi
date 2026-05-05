/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for model-group provider drift detection + formatting. */
import { describe, expect, it } from "vitest";
import { diffModelGroupProviders, type GatewayModelGroupInfoMap } from "../lib/models.ts";
import { formatModelGroupDriftLines } from "../lib/status.ts";

describe("diffModelGroupProviders", () => {
  it("returns an empty array for identical snapshots", () => {
    const snap: GatewayModelGroupInfoMap = {
      "claude-opus-4-7": { modelGroup: "claude-opus-4-7", providers: ["bedrock"] },
      "gpt-5": { modelGroup: "gpt-5", providers: ["openai"] },
    };
    expect(diffModelGroupProviders(snap, snap)).toEqual([]);
  });

  it("detects providers added to an existing group", () => {
    const prev: GatewayModelGroupInfoMap = {
      "claude-opus-4-7": { modelGroup: "claude-opus-4-7", providers: ["bedrock"] },
    };
    const curr: GatewayModelGroupInfoMap = {
      "claude-opus-4-7": {
        modelGroup: "claude-opus-4-7",
        providers: ["anthropic", "bedrock"],
      },
    };
    const drift = diffModelGroupProviders(prev, curr);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      modelGroup: "claude-opus-4-7",
      previousProviders: ["bedrock"],
      currentProviders: ["anthropic", "bedrock"],
    });
  });

  it("detects groups added and removed", () => {
    const prev: GatewayModelGroupInfoMap = {
      "gpt-5": { modelGroup: "gpt-5", providers: ["openai"] },
    };
    const curr: GatewayModelGroupInfoMap = {
      "claude-opus-4-7": { modelGroup: "claude-opus-4-7", providers: ["bedrock"] },
    };
    const drift = diffModelGroupProviders(prev, curr);
    expect(drift).toHaveLength(2);
    // Sorted alphabetically by model_group.
    expect(drift.map((d) => d.modelGroup)).toEqual(["claude-opus-4-7", "gpt-5"]);
    expect(drift[1].currentProviders).toEqual([]);
  });
});

describe("formatModelGroupDriftLines", () => {
  it("returns an empty array when no drift is present", () => {
    expect(formatModelGroupDriftLines([])).toEqual([]);
  });

  it("renders a header plus one line per drifting group", () => {
    const lines = formatModelGroupDriftLines([
      {
        modelGroup: "claude-opus-4-7",
        previousProviders: ["bedrock"],
        currentProviders: ["anthropic", "bedrock"],
      },
    ]);
    expect(lines[0]).toContain("Model-group provider drift");
    expect(lines[1]).toContain("claude-opus-4-7");
    expect(lines[1]).toContain("[bedrock]");
    expect(lines[1]).toContain("[anthropic, bedrock]");
  });

  it("renders empty arrays as (none) so the line stays readable", () => {
    const lines = formatModelGroupDriftLines([
      {
        modelGroup: "gone-away",
        previousProviders: ["openai"],
        currentProviders: [],
      },
    ]);
    expect(lines[1]).toContain("(none)");
  });
});
