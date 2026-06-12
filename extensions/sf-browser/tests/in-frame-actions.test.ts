/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for internal iframe-context action recovery planning. */
import { describe, expect, it } from "vitest";
import { findInFrameRetryPlan } from "../lib/in-frame-actions.ts";

const SNAPSHOT = `- heading "Salesforce login" [level=1, ref=e2]
- button "Top action" [ref=e3]
- Iframe "Classic Setup" [ref=e4] focusable [tabindex]
  - textbox "Domain" [ref=e5]
  - button "Check Availability" [ref=e6]
  - group "Nested"
    - button "Save" [ref=e7]
- button "Footer" [ref=e8]`;

describe("in-frame action planning", () => {
  it("finds the nearest iframe ancestor for a nested target ref", () => {
    expect(findInFrameRetryPlan(SNAPSHOT, "@e6")).toEqual({
      iframeRef: "@e4",
      targetRef: "@e6",
    });
  });

  it("handles deeper nested target refs inside an iframe", () => {
    expect(findInFrameRetryPlan(SNAPSHOT, "e7")).toEqual({
      iframeRef: "@e4",
      targetRef: "@e7",
    });
  });

  it("does not plan frame retry for top-document refs", () => {
    expect(findInFrameRetryPlan(SNAPSHOT, "@e3")).toBeUndefined();
    expect(findInFrameRetryPlan(SNAPSHOT, "@e8")).toBeUndefined();
  });

  it("does not treat the iframe host itself as an in-frame target", () => {
    expect(findInFrameRetryPlan(SNAPSHOT, "@e4")).toBeUndefined();
  });

  it("returns undefined for missing or invalid target refs", () => {
    expect(findInFrameRetryPlan(SNAPSHOT, "@e99")).toBeUndefined();
    expect(findInFrameRetryPlan(SNAPSHOT, undefined)).toBeUndefined();
  });
});
