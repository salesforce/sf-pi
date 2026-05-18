/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { shouldBlockConfirmedOperation } from "../lib/facade-tool.ts";

describe("d360 facade confirmed-operation guard", () => {
  it("allows read and safe_post operations without explicit acknowledgement", () => {
    expect(shouldBlockConfirmedOperation({}, { safety: "read" })).toBe(false);
    expect(shouldBlockConfirmedOperation({}, { safety: "safe_post" })).toBe(false);
  });

  it("allows confirmed/destructive operations when dry-run resolves the request", () => {
    expect(shouldBlockConfirmedOperation({ dry_run: true }, { safety: "confirmed" })).toBe(false);
    expect(shouldBlockConfirmedOperation({ dry_run: true }, { safety: "destructive" })).toBe(false);
  });

  it("blocks confirmed/destructive operations without explicit acknowledgement", () => {
    expect(shouldBlockConfirmedOperation({}, { safety: "confirmed" })).toBe(true);
    expect(shouldBlockConfirmedOperation({ allow_confirmed: false }, { safety: "confirmed" })).toBe(
      true,
    );
    expect(shouldBlockConfirmedOperation({}, { safety: "destructive" })).toBe(true);
  });

  it("allows confirmed/destructive operations only after explicit acknowledgement", () => {
    expect(shouldBlockConfirmedOperation({ allow_confirmed: true }, { safety: "confirmed" })).toBe(
      false,
    );
    expect(
      shouldBlockConfirmedOperation({ allow_confirmed: true }, { safety: "destructive" }),
    ).toBe(false);
  });
});
