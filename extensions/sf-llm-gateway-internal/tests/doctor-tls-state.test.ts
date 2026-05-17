/* SPDX-License-Identifier: Apache-2.0 */
/**
 * End-to-end test that a TLS failure during gateway doctor:
 *   1. Surfaces a macOS-specific recommendation pointing at /sf-llm-gateway fix-ca-bundle
 *   2. Surfaces the Heads-up about the LaunchAgent + ~/.zshenv pair
 *   3. Persists a `gatewayCaProbe` snapshot that the welcome splash can read
 *
 * The original Slack-thread bug fingerprint was an undici "fetch failed"
 * thrown during the first call \u2014 these tests replay that fingerprint via
 * a fetch stub and assert on the user-visible outcomes.
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pi's getAgentDir() honors PI_CODING_AGENT_DIR — same env var the privacy
// tests use to redirect the canonical agent dir into a per-test tmpdir.
const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let originalPlatform: PropertyDescriptor | undefined;
let originalNodeExtraCaCerts: string | undefined;
let originalFetch: typeof globalThis.fetch | undefined;
let prevAgentDir: string | undefined;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value,
    configurable: true,
  });
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-doctor-tls-"));
  prevAgentDir = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;

  originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  originalNodeExtraCaCerts = process.env.NODE_EXTRA_CA_CERTS;
  delete process.env.NODE_EXTRA_CA_CERTS;
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, "platform", originalPlatform);
  }
  if (originalNodeExtraCaCerts === undefined) {
    delete process.env.NODE_EXTRA_CA_CERTS;
  } else {
    process.env.NODE_EXTRA_CA_CERTS = originalNodeExtraCaCerts;
  }
  if (originalFetch !== undefined) {
    globalThis.fetch = originalFetch;
  }
  if (prevAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgentDir;
  vi.resetModules();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("fetchGatewayDoctorReport TLS persistence", () => {
  it("emits the macOS hint and persists a tls snapshot when fetch throws TLS errors", async () => {
    setPlatform("darwin");

    // Stub global fetch to throw the canonical undici TLS error. Both probe
    // helpers (`runGatewayCheck` via fetchWithTimeout) share the same
    // global fetch, so one stub covers all three doctor checks.
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;

    // Configure a saved gateway URL + key so the doctor produces real
    // checks. We write directly to disk rather than going through the
    // setup wizard so the test is hermetic.
    const { writeGatewaySavedConfig, globalGatewayConfigPath } = await import("../lib/config.ts");
    writeGatewaySavedConfig(globalGatewayConfigPath(), {
      enabled: true,
      baseUrl: "https://gateway.example.com",
      apiKey: "test-key",
    });

    const { fetchGatewayDoctorReport } = await import("../lib/doctor.ts");
    const report = await fetchGatewayDoctorReport(tmpDir);

    expect(report.failureClass).toBe("tls");
    expect(report.checks.every((check) => check.failureClass === "tls")).toBe(true);

    // Recommendation surface: must call out the fix-ca-bundle action by
    // name and the LaunchAgent + .zshenv pair.
    const recommendations = report.recommendations.join("\n");
    expect(recommendations).toContain("/sf-llm-gateway fix-ca-bundle");
    expect(recommendations).toContain("LaunchAgent");
    expect(recommendations).toContain("~/.zshenv");

    // Persisted snapshot lives under <agentDir>/sf-pi/sf-llm-gateway-internal/ca-probe.json
    // by way of `lib/common/state-store.ts` canonical layout. We pinned
    // the agentDir to tmpDir via PI_CODING_AGENT_DIR above.
    const probePath = path.join(tmpDir, "sf-pi", "sf-llm-gateway-internal", "ca-probe.json");
    expect(existsSync(probePath)).toBe(true);
    const envelope = JSON.parse(readFileSync(probePath, "utf8")) as {
      schemaVersion: number;
      state: {
        lastFailureClass: string;
        hasNodeExtraCaCerts: boolean;
        platform: string;
        at: string;
      };
    };
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.state.lastFailureClass).toBe("tls");
    expect(envelope.state.hasNodeExtraCaCerts).toBe(false);
    expect(envelope.state.platform).toBe("darwin");
    expect(envelope.state.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does not emit the macOS hint on linux even with a TLS failure", async () => {
    setPlatform("linux");
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;

    const { writeGatewaySavedConfig, globalGatewayConfigPath } = await import("../lib/config.ts");
    writeGatewaySavedConfig(globalGatewayConfigPath(), {
      enabled: true,
      baseUrl: "https://gateway.example.com",
      apiKey: "test-key",
    });

    const { fetchGatewayDoctorReport } = await import("../lib/doctor.ts");
    const report = await fetchGatewayDoctorReport(tmpDir);

    expect(report.failureClass).toBe("tls");
    const recommendations = report.recommendations.join("\n");
    expect(recommendations).not.toContain("fix-ca-bundle");
    expect(recommendations).not.toContain("macOS Node");
  });

  it("does not emit the macOS hint when NODE_EXTRA_CA_CERTS is already set", async () => {
    setPlatform("darwin");
    process.env.NODE_EXTRA_CA_CERTS = "/tmp/already-set.pem";
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;

    const { writeGatewaySavedConfig, globalGatewayConfigPath } = await import("../lib/config.ts");
    writeGatewaySavedConfig(globalGatewayConfigPath(), {
      enabled: true,
      baseUrl: "https://gateway.example.com",
      apiKey: "test-key",
    });

    const { fetchGatewayDoctorReport } = await import("../lib/doctor.ts");
    const report = await fetchGatewayDoctorReport(tmpDir);

    const recommendations = report.recommendations.join("\n");
    expect(recommendations).not.toContain("fix-ca-bundle");
  });

  it("appends a configured helpUrl as the trailing 'More info' line", async () => {
    setPlatform("darwin");
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;

    const { writeGatewaySavedConfig, globalGatewayConfigPath } = await import("../lib/config.ts");
    writeGatewaySavedConfig(globalGatewayConfigPath(), {
      enabled: true,
      baseUrl: "https://gateway.example.com",
      apiKey: "test-key",
      helpUrl: "https://example.invalid/internal-help",
    });

    const { fetchGatewayDoctorReport } = await import("../lib/doctor.ts");
    const report = await fetchGatewayDoctorReport(tmpDir);

    expect(report.recommendations.at(-1)).toBe("More info: https://example.invalid/internal-help");
  });
});
