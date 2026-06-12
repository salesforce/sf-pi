/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for visible Browser Evidence command output helpers. */
import { describe, expect, it } from "vitest";
import { splitEvidenceContent } from "../lib/evidence-panel.ts";

describe("evidence panel helpers", () => {
  it("splits text and first image content for visible evidence output", () => {
    const result = splitEvidenceContent([
      { type: "text", text: "Captured Browser Evidence #1." },
      { type: "image", data: "abc123", mimeType: "image/jpeg" },
      { type: "text", text: "Path: /tmp/evidence.png" },
    ]);

    expect(result.text).toBe("Captured Browser Evidence #1.\nPath: /tmp/evidence.png");
    expect(result.image).toEqual({ type: "image", data: "abc123", mimeType: "image/jpeg" });
  });

  it("returns trimmed text without an image when evidence is artifact-only", () => {
    const result = splitEvidenceContent([{ type: "text", text: "  Path: /tmp/evidence.png  " }]);

    expect(result.text).toBe("Path: /tmp/evidence.png");
    expect(result.image).toBeUndefined();
  });
});
