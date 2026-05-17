/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unit tests for the splash-facing CA-probe state helpers.
 *
 * These cover the gate function the welcome splash uses synchronously on
 * the boot path. The doctor-side persistence is exercised in
 * doctor-tls-state.test.ts via a temporary state file so the on-disk
 * envelope shape stays honest.
 */
import { describe, expect, it } from "vitest";
import { shouldShowCaBundleNudge } from "../lib/ca-probe-state.ts";

describe("shouldShowCaBundleNudge", () => {
  // Snapshot factory so each case names exactly the field that differs.
  const snap = (over: Partial<Parameters<typeof shouldShowCaBundleNudge>[0]>) => ({
    at: "2026-05-17T10:00:00.000Z",
    lastFailureClass: "tls" as const,
    hasNodeExtraCaCerts: false,
    platform: "darwin",
    ...over,
  });

  it("renders the nudge in the canonical macOS-tls-no-bundle state", () => {
    expect(shouldShowCaBundleNudge(snap({}))).toBe(true);
  });

  it("hides when the doctor has never run (`at` is empty)", () => {
    expect(shouldShowCaBundleNudge(snap({ at: "" }))).toBe(false);
  });

  it("hides on linux/windows even when TLS is the failure class", () => {
    expect(shouldShowCaBundleNudge(snap({ platform: "linux" }))).toBe(false);
    expect(shouldShowCaBundleNudge(snap({ platform: "win32" }))).toBe(false);
  });

  it("hides when the user has already wired NODE_EXTRA_CA_CERTS", () => {
    expect(shouldShowCaBundleNudge(snap({ hasNodeExtraCaCerts: true }))).toBe(false);
  });

  it("hides for non-tls failure classes (auth/redirect/other)", () => {
    expect(shouldShowCaBundleNudge(snap({ lastFailureClass: "auth" }))).toBe(false);
    expect(shouldShowCaBundleNudge(snap({ lastFailureClass: "redirect" }))).toBe(false);
    expect(shouldShowCaBundleNudge(snap({ lastFailureClass: "other" }))).toBe(false);
  });

  it("hides when the doctor passed (failureClass null)", () => {
    expect(shouldShowCaBundleNudge(snap({ lastFailureClass: null }))).toBe(false);
  });
});
