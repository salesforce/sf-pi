/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for automatic Browser Evidence Display Policy decisions. */
import { describe, expect, it } from "vitest";
import {
  checkpointEvidenceLabel,
  evidenceLabelForMutationBefore,
  shouldCaptureMutationBefore,
} from "../lib/evidence-policy.ts";

describe("evidence policy", () => {
  it("captures mutation-before evidence for explicit mutation intent", () => {
    expect(shouldCaptureMutationBefore({ mutation: true })).toBe(true);
    expect(shouldCaptureMutationBefore({ mutation: false, reason: "save settings" })).toBe(false);
  });

  it("infers mutation-before evidence from common committing action words", () => {
    expect(shouldCaptureMutationBefore({ reason: "Save the setup page" })).toBe(true);
    expect(shouldCaptureMutationBefore({ reason: "deploy My Domain" })).toBe(true);
    expect(shouldCaptureMutationBefore({ reason: "open details" })).toBe(false);
  });

  it("labels mutation-before evidence by action and target", () => {
    expect(evidenceLabelForMutationBefore("click", "@e42")).toBe("before-mutation-click-@e42");
  });

  it("captures automatic checkpoint evidence for meaningful Lightning waits", () => {
    expect(checkpointEvidenceLabel({ lightning: "navigation-ready" })).toBe(
      "checkpoint-navigation-ready",
    );
    expect(checkpointEvidenceLabel({ lightning: "record-view" })).toBe("checkpoint-record-view");
    expect(checkpointEvidenceLabel({ lightning: "save-result" })).toBe(
      "after-mutation-save-result",
    );
  });

  it("keeps noisy waits artifact-free unless explicitly requested", () => {
    expect(checkpointEvidenceLabel({ lightning: "app-ready" })).toBeUndefined();
    expect(
      checkpointEvidenceLabel({ checkpointEvidence: false, lightning: "save-result" }),
    ).toBeUndefined();
    expect(checkpointEvidenceLabel({ checkpointEvidence: true, lightning: "modal-open" })).toBe(
      "checkpoint-modal-open",
    );
  });
});
