/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for sf-slack auth module.
 *
 * Tests token precedence helpers and display helpers.
 */
import { describe, it, expect } from "vitest";
import { maskToken, formatExpiry, resolveTokenCandidates } from "../lib/auth.ts";

describe("auth", () => {
  describe("resolveTokenCandidates", () => {
    it("prefers Pi auth over environment variable", () => {
      expect(
        resolveTokenCandidates({
          piAuthToken: "xoxp-pi-token",
          envToken: "xoxp-env-token",
        }),
      ).toEqual({ source: "pi-auth", token: "xoxp-pi-token" });
    });

    it("falls back to env when pi-auth is empty", () => {
      expect(
        resolveTokenCandidates({
          envToken: "xoxp-env-token",
        }),
      ).toEqual({ source: "env", token: "xoxp-env-token" });
    });

    it("returns null when no candidate is configured", () => {
      expect(resolveTokenCandidates({})).toBeNull();
    });
  });

  describe("maskToken", () => {
    it("masks short tokens completely", () => {
      expect(maskToken("abc")).toBe("***");
      expect(maskToken("short-token!")).toBe("***");
    });

    it("masks long tokens showing prefix and suffix", () => {
      const result = maskToken("xoxp-1234567890-abcdefghijklmn");
      expect(result).toMatch(/^xoxp-1.*n$/);
      expect(result).toContain("…");
      expect(result.length).toBeLessThan("xoxp-1234567890-abcdefghijklmn".length);
    });
  });

  describe("formatExpiry", () => {
    it("returns EXPIRED for past timestamps", () => {
      expect(formatExpiry(Date.now() - 1000)).toBe("EXPIRED");
    });

    it("returns minutes for near-future", () => {
      const result = formatExpiry(Date.now() + 30 * 60 * 1000);
      expect(result).toMatch(/minute/);
    });

    it("returns hours for hours away", () => {
      const result = formatExpiry(Date.now() + 5 * 60 * 60 * 1000);
      expect(result).toMatch(/hour/);
    });

    it("returns days for days away", () => {
      const result = formatExpiry(Date.now() + 10 * 24 * 60 * 60 * 1000);
      expect(result).toMatch(/day/);
    });

    it("returns years for long-lived tokens", () => {
      const result = formatExpiry(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000);
      expect(result).toMatch(/year/);
    });

    it("returns unknown for zero", () => {
      expect(formatExpiry(0)).toBe("unknown");
    });
  });
});
