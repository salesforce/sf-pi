/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for Slack runtime status classification and labels. */
import { describe, expect, it } from "vitest";
import { classifySlackStatus, slackStatusLabel } from "../lib/status.ts";

describe("Slack status classification", () => {
  it("marks full granted scopes as ready", () => {
    const kind = classifySlackStatus({
      state: "connected",
      grantedScopeCount: 26,
      requestedScopeCount: 26,
      missingGrantedScopeCount: 0,
    });

    expect(kind).toBe("ready");
    expect(slackStatusLabel(kind)).toBe("✓ Connected");
  });

  it("marks missing scopes as a partial grant while staying connected", () => {
    const kind = classifySlackStatus({
      state: "connected",
      grantedScopeCount: 0,
      requestedScopeCount: 26,
      missingGrantedScopeCount: 26,
    });

    expect(kind).toBe("partial-grant");
    expect(slackStatusLabel(kind)).toBe("✓ Connected");
  });

  it("marks zero granted scopes with no diff as scopes unknown", () => {
    const kind = classifySlackStatus({
      state: "connected",
      grantedScopeCount: 0,
      requestedScopeCount: 26,
      missingGrantedScopeCount: 0,
    });

    expect(kind).toBe("scopes-unknown");
    expect(slackStatusLabel(kind)).toBe("? Scopes unknown");
  });
});
