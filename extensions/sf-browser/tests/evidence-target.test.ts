/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for targeted automatic Browser Evidence preparation. */
import { describe, expect, it } from "vitest";
import { defaultCheckpointEvidenceTarget, findDetailsTabRef } from "../lib/evidence-target.ts";

describe("evidence target policy", () => {
  it("defaults record checkpoints to Details-tab evidence", () => {
    expect(defaultCheckpointEvidenceTarget("record-view")).toBe("record-details");
    expect(defaultCheckpointEvidenceTarget("save-result")).toBe("record-details");
  });

  it("keeps navigation checkpoints on the current viewport", () => {
    expect(defaultCheckpointEvidenceTarget("navigation-ready")).toBe("current");
    expect(defaultCheckpointEvidenceTarget("app-ready")).toBe("current");
    expect(defaultCheckpointEvidenceTarget(undefined)).toBe("current");
  });

  it("finds an unselected Details tab ref", () => {
    const snapshot = `- tab "Related" [selected, ref=e40]\n- tab "Details" [ref=e41]`;

    expect(findDetailsTabRef(snapshot)).toBe("@e41");
  });

  it("does not click Details when it is already selected or missing", () => {
    expect(findDetailsTabRef('- tab "Details" [selected, ref=e41]')).toBeUndefined();
    expect(findDetailsTabRef('- tab "Related" [selected, ref=e40]')).toBeUndefined();
  });
});
