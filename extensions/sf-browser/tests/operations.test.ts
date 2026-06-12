/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for shared SF Browser operations helpers. */
import { describe, expect, it } from "vitest";
import { formatMissingScreenshotCaptureText } from "../lib/operations.ts";

describe("operations helpers", () => {
  it("formats missing screenshot capture recovery without throwing", () => {
    const text = formatMissingScreenshotCaptureText({
      label: "after-mutation-save-result",
      mode: "thumbnail",
      path: "/tmp/missing.png",
      sessionId: "session-1",
      durationText: "1m 0s",
    });

    expect(text).toContain("Browser Evidence capture incomplete");
    expect(text).toContain("screenshot file was not produced");
    expect(text).toContain("Expected path: /tmp/missing.png");
    expect(text).toContain("restart the browser session");
  });
});
