/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the corporate CA bundle fixer's pure helpers.
 *
 * The orchestrator in index.ts is exercised via integration / manual QA
 * because it touches LaunchAgents and ~/.zshenv. Here we cover the
 * building blocks: candidate probing, PEM validation, plist construction,
 * and idempotent ~/.zshenv block management.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyZshenvBlock,
  buildCandidatePaths,
  buildLaunchAgentPlist,
  buildZshenvBlock,
  defaultLaunchAgentPath,
  defaultZshenvPath,
  LAUNCH_AGENT_LABEL,
  probeBundleCandidates,
  removeZshenvBlock,
  SENTINEL_BEGIN,
  SENTINEL_END,
  validatePemBundle,
  writeZshenvBlockSafely,
} from "../lib/ca-bundle-fixer.ts";

// Real self-signed test certificate. Generated once via
//   openssl req -x509 -newkey rsa:2048 -nodes -subj /CN=test -days 36500
// and embedded so the suite doesn't depend on openssl being available
// on the test runner. validatePemBundle's optional openssl x509 check
// must accept this content for the adopt path to be exercised.
const SAMPLE_PEM_BODY = [
  "-----BEGIN CERTIFICATE-----",
  "MIIDATCCAemgAwIBAgIUPz2FMRbJU+d+Mc+WDfHyd7vXkbEwDQYJKoZIhvcNAQEL",
  "BQAwDzENMAsGA1UEAwwEdGVzdDAgFw0yNjA1MTcxNTMyMDNaGA8yMTI2MDQyMzE1",
  "MzIwM1owDzENMAsGA1UEAwwEdGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCC",
  "AQoCggEBALKrZF3OtNbvCh3F+KhOIDlxfoDNzn+kICT/t+25l+FK7tV/6QscJqha",
  "/OkGPYC4G5eT5P5ulQqL5wFirT7TszUdQ3ZXBljU44QfgtBvFm3bA5MD6C76TIVS",
  "O6xIqNPuGm26BbMTJshHgigWLsUzqVjb5KplVJxK2fH0AZ4vDi3HjaxQeadkhYYJ",
  "t9PYyqTw1sw8MSZgQo7qAPKWCx13mewnX39H3J/5piqLuamjhk/LwbrV8HdqX25L",
  "lIydsMyYct9tYFsXt+z2BMA0w3zQ6yLwgpk5IJhwqULPaT8waO2CJzrNyMfQ4xxm",
  "FjQ9wvWxIJ1iMcCtJAlrHI9CwvBESfcCAwEAAaNTMFEwHQYDVR0OBBYEFKG+C8C8",
  "4NMJ/XJumoMHyOBw3FOvMB8GA1UdIwQYMBaAFKG+C8C84NMJ/XJumoMHyOBw3FOv",
  "MA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAIwzxmG8Zonbpy9t",
  "HD3hQIr/Ha+zAAT5kW95PmLyKAWm0CXCEvkTvBStY5xJViIsyuempRGwf/izQorB",
  "cdUyHvs8Ik1gKBRk2+NKUHIoRIDk7rRRkoP0muK3/8cb7UDZu5ktZKdXRM8UGCaV",
  "hkHTuHeNv4ZnOhqRiZ9EGD/X0MK57c8N+yRdUA0X2CbcxZIelT0IV/T6aqTuMlcm",
  "MYWWGz9BXgf6x04mE4OboCKUK89EybCGDo0y0hPXwSpyHp/oLYyF4hZjrcPalONd",
  "YwK+rexE7q4QRgJUuk0NkKcmNYsHD1UfpcgjcGvUBzmKZuZs1JXVJCzTtMMLsW/m",
  "YqneP1s=",
  "-----END CERTIFICATE-----",
  "",
].join("\n");

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-ca-fixer-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildCandidatePaths", () => {
  it("returns an absolute, deduped, ordered list with extras first", () => {
    const out = buildCandidatePaths(
      ["/abs/extra.pem", "rel/extra.pem", "/abs/extra.pem"],
      "/home/test",
    );
    expect(out[0]).toBe("/abs/extra.pem");
    expect(out[1]).toBe("/home/test/rel/extra.pem");
    // Built-in candidates appear after extras.
    expect(out.some((p) => p.endsWith("/.aisuite/conf/npm-sfdc-certs.pem"))).toBe(true);
    // No duplicates.
    expect(new Set(out).size).toBe(out.length);
  });
});

describe("validatePemBundle", () => {
  it("accepts a file with the BEGIN CERTIFICATE header", () => {
    const file = path.join(tmpDir, "valid.pem");
    writeFileSync(file, SAMPLE_PEM_BODY);
    const result = validatePemBundle(file);
    expect(result.ok).toBe(true);
  });

  it("rejects an empty file", () => {
    const file = path.join(tmpDir, "empty.pem");
    writeFileSync(file, "");
    const result = validatePemBundle(file);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("empty");
  });

  it("rejects a non-PEM file with missing header", () => {
    const file = path.join(tmpDir, "bogus.pem");
    writeFileSync(file, "this is not a certificate at all");
    const result = validatePemBundle(file);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("BEGIN CERTIFICATE");
  });
});

describe("probeBundleCandidates", () => {
  it("marks valid PEM files as adoptable and others as invalid", () => {
    const validPath = path.join(tmpDir, "valid.pem");
    writeFileSync(validPath, SAMPLE_PEM_BODY);

    const results = probeBundleCandidates([validPath, "/definitely/missing/path.pem"], tmpDir);
    const valid = results.find((entry) => entry.path === validPath);
    const missing = results.find((entry) => entry.path === "/definitely/missing/path.pem");
    expect(valid?.valid).toBe(true);
    expect(missing?.valid).toBe(false);
    expect(missing?.reason).toContain("not present");
  });
});

describe("buildLaunchAgentPlist", () => {
  it("emits a parseable plist with the expected reverse-DNS label and bundle path", () => {
    const plist = buildLaunchAgentPlist("/Users/test/.aisuite/conf/internal.pem");
    expect(plist).toContain(`<string>${LAUNCH_AGENT_LABEL}</string>`);
    expect(plist).toContain("<string>NODE_EXTRA_CA_CERTS</string>");
    expect(plist).toContain("<string>/Users/test/.aisuite/conf/internal.pem</string>");
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    // Exactly one Label key so the file is unambiguous to launchctl.
    expect(plist.match(/<key>Label<\/key>/g)?.length).toBe(1);
  });

  it("XML-escapes ampersands in the bundle path defensively", () => {
    const plist = buildLaunchAgentPlist("/path/with & ampersand.pem");
    expect(plist).toContain("/path/with &amp; ampersand.pem");
    expect(plist).not.toContain("/path/with & ampersand.pem</string>");
  });
});

describe("default paths", () => {
  it("anchors the LaunchAgent under ~/Library/LaunchAgents with our label", () => {
    expect(defaultLaunchAgentPath("/Users/test")).toBe(
      `/Users/test/Library/LaunchAgents/${LAUNCH_AGENT_LABEL}.plist`,
    );
  });

  it("defaults the .zshenv path to the home dir", () => {
    expect(defaultZshenvPath("/Users/test")).toBe("/Users/test/.zshenv");
  });
});

describe("writeZshenvBlockSafely", () => {
  it("creates and updates a regular .zshenv through a safe file descriptor", () => {
    const zshenvPath = path.join(tmpDir, ".zshenv");
    const result = writeZshenvBlockSafely(zshenvPath, "/tmp/internal.pem");
    expect(result.status).toBe("updated");
    expect(result.changed).toBe(true);
    expect(readFileSync(zshenvPath, "utf8")).toContain(SENTINEL_BEGIN);
  });

  it("skips symlinked .zshenv files instead of writing through them", () => {
    const target = path.join(tmpDir, "target-zshenv");
    const link = path.join(tmpDir, ".zshenv");
    writeFileSync(target, "# user managed elsewhere\n");
    try {
      symlinkSync(target, link);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    const result = writeZshenvBlockSafely(link, "/tmp/internal.pem");
    expect(result.status).toBe("skipped");
    expect(readFileSync(target, "utf8")).toBe("# user managed elsewhere\n");
  });
});

describe("buildZshenvBlock + applyZshenvBlock", () => {
  it("escapes shell metacharacters in the bundle path", () => {
    const block = buildZshenvBlock('/Users/test/with "quote".pem');
    expect(block).toContain('export NODE_EXTRA_CA_CERTS="/Users/test/with \\"quote\\".pem"');
  });

  it("appends the block when no sentinel exists yet", () => {
    const result = applyZshenvBlock("# user prefs\nalias ll='ls -la'\n", "/tmp/internal.pem");
    expect(result.changed).toBe(true);
    expect(result.contents).toContain("# user prefs");
    expect(result.contents).toContain("alias ll='ls -la'");
    expect(result.contents).toContain(SENTINEL_BEGIN);
    expect(result.contents).toContain(SENTINEL_END);
    expect(result.contents.endsWith("\n")).toBe(true);
  });

  it("replaces the existing block in place instead of duplicating", () => {
    // Start with an old block pointing at a stale path.
    const initial = applyZshenvBlock("# header\n", "/old/path.pem").contents;
    expect(initial.match(new RegExp(SENTINEL_BEGIN, "g"))?.length).toBe(1);

    const updated = applyZshenvBlock(initial, "/new/path.pem");
    expect(updated.changed).toBe(true);
    expect(updated.contents).toContain('export NODE_EXTRA_CA_CERTS="/new/path.pem"');
    expect(updated.contents).not.toContain("/old/path.pem");
    // Still exactly one sentinel pair after the replace.
    expect(updated.contents.match(new RegExp(SENTINEL_BEGIN, "g"))?.length).toBe(1);
  });

  it("returns changed=false on a no-op apply", () => {
    const initial = applyZshenvBlock("", "/tmp/internal.pem").contents;
    const repeat = applyZshenvBlock(initial, "/tmp/internal.pem");
    expect(repeat.changed).toBe(false);
    expect(repeat.contents).toBe(initial);
  });

  it("removeZshenvBlock strips the sentinel pair without disturbing user content", () => {
    const initial = applyZshenvBlock("export FOO=bar\n", "/tmp/internal.pem").contents;
    const stripped = removeZshenvBlock(initial);
    expect(stripped.changed).toBe(true);
    expect(stripped.contents).toContain("export FOO=bar");
    expect(stripped.contents).not.toContain(SENTINEL_BEGIN);
    expect(stripped.contents).not.toContain(SENTINEL_END);
  });
});

// Sanity test that the candidate-path layout reaches well-known macOS
// install locations \u2014 tells us at a glance if someone reordered or
// removed a path that downstream users rely on.
describe("default candidate layout", () => {
  it("includes the well-known aisuite, Claude Code, and DevBar paths under the user's home dir", () => {
    mkdirSync(path.join(tmpDir, ".aisuite", "conf"), { recursive: true });
    const out = buildCandidatePaths([], tmpDir);
    expect(out).toContain(path.join(tmpDir, ".aisuite", "conf", "npm-sfdc-certs.pem"));
    expect(out).toContain(path.join(tmpDir, ".aisuite", "conf", "internal.pem"));
    expect(out).toContain(path.join(tmpDir, ".claude", "ca-bundle.pem"));
    expect(out).toContain(path.join(tmpDir, ".devbar", "ca-bundle.pem"));
  });
});
