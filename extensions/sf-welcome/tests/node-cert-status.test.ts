/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the welcome-screen Node CA certificate status helper. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeCaProbeState } from "../../sf-llm-gateway-internal/lib/ca-probe-state.ts";
import { writeCaBundleFixerState } from "../../sf-llm-gateway-internal/lib/ca-bundle-fixer-state.ts";
import {
  detectNodeCertStatus,
  extractNodeExtraCaCertsValues,
  readCachedNodeCertStatus,
  writeCachedNodeCertStatus,
} from "../lib/node-cert-status.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
const PEM = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBszCCAVmgAwIBAgIUTESTONLYCERTIFICATE000000000000000wCgYIKoZIzj0E",
  "-----END CERTIFICATE-----",
  "",
].join("\n");

let tmpDir: string;
let homeDir: string;
let prevAgent: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  homeDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-node-cert-home-"));
  tmpDir = path.join(homeDir, ".pi", "agent");
  mkdirSync(tmpDir, { recursive: true });
  prevAgent = process.env[PI_AGENT_ENV];
  prevHome = process.env.HOME;
  process.env[PI_AGENT_ENV] = tmpDir;
  process.env.HOME = homeDir;
});

afterEach(() => {
  if (prevAgent === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgent;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  try {
    rmSync(homeDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function writePem(relative: string): string {
  const filePath = path.join(homeDir, relative);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, PEM);
  return filePath;
}

describe("extractNodeExtraCaCertsValues", () => {
  it("parses quoted, unquoted, and exported assignments", () => {
    expect(
      extractNodeExtraCaCertsValues(
        [
          'export NODE_EXTRA_CA_CERTS="~/.certs/root.pem"',
          "NODE_EXTRA_CA_CERTS=/tmp/ca.pem # comment",
          "  NODE_EXTRA_CA_CERTS='~/other.pem'",
        ].join("\n"),
      ),
    ).toEqual(["~/.certs/root.pem", "/tmp/ca.pem", "~/other.pem"]);
  });
});

describe("detectNodeCertStatus", () => {
  it("reports verified when NODE_EXTRA_CA_CERTS is valid and a cached doctor probe passed", () => {
    const pemPath = writePem("certs/verified.pem");
    const probePath = path.join(tmpDir, "probe.json");
    writeCaProbeState(
      {
        at: new Date().toISOString(),
        lastFailureClass: null,
        hasNodeExtraCaCerts: true,
        platform: "darwin",
      },
      probePath,
    );

    expect(
      detectNodeCertStatus(homeDir, {
        home: homeDir,
        probeStatePathOverride: probePath,
        candidatePaths: [],
        env: { NODE_EXTRA_CA_CERTS: pemPath },
      }),
    ).toMatchObject({ kind: "verified", source: "probe", path: pemPath, loading: false });
  });

  it("reports installed when NODE_EXTRA_CA_CERTS points at a PEM file", () => {
    const pemPath = writePem("certs/root.pem");
    const status = detectNodeCertStatus(homeDir, {
      home: homeDir,
      candidatePaths: [],
      env: { NODE_EXTRA_CA_CERTS: pemPath },
    });

    expect(status).toMatchObject({ kind: "installed", source: "env", path: pemPath });
  });

  it("reports invalid when NODE_EXTRA_CA_CERTS points at a non-PEM file", () => {
    const badPath = path.join(homeDir, "bad.pem");
    writeFileSync(badPath, "not a certificate");

    const status = detectNodeCertStatus(homeDir, {
      home: homeDir,
      candidatePaths: [],
      env: { NODE_EXTRA_CA_CERTS: badPath },
    });

    expect(status.kind).toBe("invalid");
    expect(status.source).toBe("env");
    expect(status.reason).toContain("BEGIN CERTIFICATE");
  });

  it("reports installed from the saved fixer state when the current env is empty", () => {
    const pemPath = writePem("certs/fixed.pem");
    const fixerPath = path.join(tmpDir, "fixer.json");
    writeCaBundleFixerState(
      {
        appliedAt: new Date().toISOString(),
        bundlePath: pemPath,
        plistPath: path.join(homeDir, "Library", "LaunchAgents", "node.plist"),
        source: "adopt",
      },
      fixerPath,
    );

    expect(
      detectNodeCertStatus(homeDir, {
        home: homeDir,
        fixerStatePathOverride: fixerPath,
        candidatePaths: [],
        env: {},
      }),
    ).toMatchObject({ kind: "installed", source: "fixer", path: pemPath });
  });

  it("reports installed from shell startup files", () => {
    const pemPath = writePem("certs/shell.pem");
    writeFileSync(path.join(homeDir, ".zshenv"), `export NODE_EXTRA_CA_CERTS="${pemPath}"\n`);

    expect(
      detectNodeCertStatus(homeDir, { home: homeDir, candidatePaths: [], env: {} }),
    ).toMatchObject({ kind: "installed", source: "shell", path: pemPath });
  });

  it("reports found when a valid candidate exists but is not wired", () => {
    const pemPath = writePem("certs/candidate.pem");
    expect(
      detectNodeCertStatus(homeDir, { home: homeDir, candidatePaths: [pemPath], env: {} }),
    ).toMatchObject({ kind: "found", source: "candidate", path: pemPath });
  });

  it("reports not-configured when no env, saved fix, shell export, or candidate exists", () => {
    expect(detectNodeCertStatus(homeDir, { home: homeDir, candidatePaths: [], env: {} })).toEqual({
      kind: "not-configured",
      loading: false,
    });
  });
});

describe("Node cert status cache", () => {
  it("round-trips a display-ready status through the shared state store", () => {
    writeCachedNodeCertStatus({
      kind: "installed",
      source: "env",
      path: "/tmp/root.pem",
      loading: false,
    });

    expect(readCachedNodeCertStatus()).toEqual({
      kind: "installed",
      source: "env",
      path: "/tmp/root.pem",
      reason: undefined,
      loading: false,
    });
  });
});
