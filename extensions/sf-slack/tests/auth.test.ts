/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for sf-slack auth module.
 *
 * Tests local auth-file parsing, precedence helpers, and display helpers.
 * System-backed sources such as Keychain are intentionally not exercised here.
 */
import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { maskToken, formatExpiry, readPiAuthToken, resolveTokenCandidates } from "../lib/auth.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("auth", () => {
  describe("readPiAuthToken", () => {
    it("reads the sf-slack token from pi auth storage", () => {
      const homeDir = makeTempDir("sf-slack-auth-");
      const authPath = path.join(homeDir, ".pi", "agent", "auth.json");
      mkdirSync(path.dirname(authPath), { recursive: true });
      writeFileSync(
        authPath,
        `${JSON.stringify(
          {
            "sf-slack": {
              access: "xoxp-test-token",
              refresh: "manual-token",
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      expect(readPiAuthToken(authPath)).toBe("xoxp-test-token");
    });

    it("returns null when the sf-slack provider entry is missing", () => {
      const homeDir = makeTempDir("sf-slack-auth-");
      const authPath = path.join(homeDir, ".pi", "agent", "auth.json");
      mkdirSync(path.dirname(authPath), { recursive: true });
      writeFileSync(
        authPath,
        `${JSON.stringify(
          {
            other: {
              access: "xoxp-other-token",
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      expect(readPiAuthToken(authPath)).toBeNull();
    });
  });

  describe("resolveTokenCandidates", () => {
    it("prefers Pi auth over Keychain and environment variables", () => {
      expect(
        resolveTokenCandidates({
          piAuthToken: "xoxp-pi-token",
          keychainToken: "xoxp-keychain-token",
          envToken: "xoxp-env-token",
        }),
      ).toEqual({ source: "pi-auth", token: "xoxp-pi-token" });
    });

    it("falls back to Keychain, then env", () => {
      expect(
        resolveTokenCandidates({
          keychainToken: "xoxp-keychain-token",
          envToken: "xoxp-env-token",
        }),
      ).toEqual({ source: "keychain", token: "xoxp-keychain-token" });

      expect(
        resolveTokenCandidates({
          envToken: "xoxp-env-token",
        }),
      ).toEqual({ source: "env", token: "xoxp-env-token" });
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
