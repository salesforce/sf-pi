/* SPDX-License-Identifier: Apache-2.0 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrubTrace } from "../lib/cli-runner.ts";
import {
  armVerbose,
  buildDebugBundle,
  createFinDebugStore,
  disarmVerbose,
  takeVerboseRun,
  writeTraceArtifact,
} from "../lib/debug.ts";

const SENTINEL = "fin-sentinel-token-0000";
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sf-fin-debug-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", dir);
  vi.stubEnv("INTERCOM_TOKEN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("verbose arming", () => {
  it("arms one run by default and disarms itself after use", () => {
    const store = createFinDebugStore(path.join(dir, "debug.json"));
    armVerbose(store);
    expect(takeVerboseRun(store)).toBe(true);
    expect(takeVerboseRun(store)).toBe(false);
  });

  it("caps runs at 5 and can be disarmed early", () => {
    const store = createFinDebugStore(path.join(dir, "debug.json"));
    expect(armVerbose(store, 99).verboseRuns).toBe(5);
    disarmVerbose(store);
    expect(takeVerboseRun(store)).toBe(false);
  });
});

describe("trace scrubbing and artifacts", () => {
  const verboseStderr = [
    "> GET https://api.intercom.io/me",
    `> Authorization: Bearer ${SENTINEL}`,
    "> Cookie: session=abc123secret",
    `< 200 OK echo ${SENTINEL}`,
    '< Body: {"app":{"name":"Example"}}',
    "Authorization: Basic ZXhhbXBsZTpzZWNyZXQ=",
    "random Bearer abcdefghijklmnop",
  ].join("\n");

  it("removes the token, credential headers, cookies, and bearer/basic values", () => {
    const scrubbed = scrubTrace(verboseStderr, SENTINEL);
    expect(scrubbed).not.toContain(SENTINEL);
    expect(scrubbed).not.toContain("abc123secret");
    expect(scrubbed).not.toContain("ZXhhbXBsZTpzZWNyZXQ=");
    expect(scrubbed).not.toContain("abcdefghijklmnop");
    expect(scrubbed).toContain("> GET https://api.intercom.io/me");
    expect(scrubbed).toContain("Authorization: [redacted]");
  });

  it("writes an owner-only artifact with no secrets and keeps the newest 10", () => {
    const traceDir = path.join(dir, "traces");
    let last = "";
    for (let i = 0; i < 12; i++) {
      last = writeTraceArtifact(
        { exitCode: 0, stdout: "{}", stderr: verboseStderr, timedOut: false, truncated: false },
        SENTINEL,
        {
          dir: traceDir,
          args: ["me", "--json", "--verbose"],
          now: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
        },
      );
    }
    // Windows has no POSIX mode bits; access follows the profile's inherited ACLs.
    if (process.platform !== "win32") {
      expect(statSync(last).mode & 0o777).toBe(0o600);
      expect(statSync(traceDir).mode & 0o777).toBe(0o700);
    }
    expect(readFileSync(last, "utf8")).not.toContain(SENTINEL);
    expect(readdirSync(traceDir)).toHaveLength(10);
  });
});

describe("debug bundle", () => {
  it("reports env names and credential source without values", () => {
    const configDir = path.join(dir, "cli-config");
    mkdirSync(configDir, { mode: 0o700 });
    writeFileSync(
      path.join(dir, "auth.json"),
      JSON.stringify({ "sf-fin": { type: "api_key", key: SENTINEL } }),
    );
    const bundle = buildDebugBundle({
      snapshot: {
        cliVersion: "0.14.1",
        latestVersion: "0.15.0",
        installSource: "npm-global",
        lastOutcome: "auth_expired",
        lastCliError: { code: "auth_error", message: "Authentication expired or invalid" },
      },
      debug: {},
      env: { INTERCOM_TOKEN: SENTINEL, INTERCOM_REGION: "eu", PATH: "/bin" },
      cliConfigDir: configDir,
      sfPiVersion: "0.0.0-test",
      piVersion: "1.5.0",
    });

    expect(bundle).not.toContain(SENTINEL);
    // The token length must never be reported. Match it as a labelled value, not a bare
    // number, so unrelated numbers (Node versions, timestamps) cannot collide with it.
    expect(bundle).not.toMatch(
      new RegExp(`(length|chars?|characters)\\D{0,3}${SENTINEL.length}\\b`, "i"),
    );
    expect(bundle).not.toMatch(/token[^\n]*\d+\s*(chars?|characters)/i);
    expect(bundle).toContain("INTERCOM_REGION, INTERCOM_TOKEN");
    expect(bundle).not.toMatch(/INTERCOM_REGION=|\beu\b.*INTERCOM/);
    expect(bundle).toContain("- Source: pi-auth");
    expect(bundle).toContain("empty (expected)");
    expect(bundle).toContain("auth_error — Authentication expired or invalid");
  });
});
