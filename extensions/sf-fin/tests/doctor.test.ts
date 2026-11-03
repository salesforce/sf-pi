/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FinCredentialResult } from "../lib/auth.ts";
import type { CliRunResult } from "../lib/cli-runner.ts";
import { buildCachedChecks, parseIdentity, runDoctor, type DoctorDeps } from "../lib/doctor.ts";

const SENTINEL = "fin-sentinel-token-0000";
const ctx = { signal: undefined } as unknown as ExtensionContext;
const connected: FinCredentialResult = {
  ok: true,
  credential: { token: SENTINEL, source: "pi-auth", region: "us" },
};
const ME = JSON.stringify({
  type: "admin",
  name: "Example Admin",
  email: "admin@example.test",
  app: { id_code: "abc123de", name: "Example Workspace", region: "US" },
});
let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(path.join(tmpdir(), "sf-fin-doctor-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("INTERCOM_TOKEN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

function cli(exitCode: number, stdout = "", stderr = ""): CliRunResult {
  return { exitCode, stdout, stderr, timedOut: false, truncated: false };
}

/** Fake host: `which`, `intercom --version`, `npm root -g`. */
function fakeExec(opts: { installed?: boolean; version?: string; npmGlobal?: boolean } = {}) {
  const installed = opts.installed ?? true;
  const version = opts.version ?? "0.14.1";
  return vi.fn(async (command: string, args: string[]) => {
    if (command === "which") {
      return installed
        ? { code: 0, stdout: "/opt/example/bin/intercom\n", stderr: "" }
        : { code: 1, stdout: "", stderr: "" };
    }
    if (command === "intercom") {
      return installed
        ? { code: 0, stdout: `${version}\n`, stderr: "" }
        : { code: 127, stdout: "", stderr: "" };
    }
    if (command === "npm" && args[0] === "root") {
      return {
        code: 0,
        stdout: opts.npmGlobal === false ? "/elsewhere\n" : "/opt/example/lib/node_modules\n",
        stderr: "",
      };
    }
    return { code: 1, stdout: "", stderr: "unexpected" };
  });
}

function deps(
  overrides: Partial<DoctorDeps> & {
    meResponse?: CliRunResult;
    exec?: ReturnType<typeof fakeExec>;
  } = {},
): DoctorDeps & { run: ReturnType<typeof vi.fn> } {
  return {
    resolveCredential: overrides.resolveCredential ?? (async () => connected),
    run: vi.fn(async () => overrides.meResponse ?? cli(0, ME)),
    exec: overrides.exec ?? fakeExec(),
    fetchRegistry:
      overrides.fetchRegistry ?? (async () => ({ latest: "0.14.1", latestNodeEngine: ">=20.6.0" })),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    nodeVersion: overrides.nodeVersion ?? "22.0.0",
    userCliConfigExists: overrides.userCliConfigExists ?? (() => false),
  };
}

describe("runDoctor (live)", () => {
  it("runs the six checks and records non-secret identity", async () => {
    const d = deps();
    const report = await runDoctor(ctx, d);

    expect(report.outcome).toBe("ok");
    expect(report.checks.map((check) => check.id)).toEqual([
      "fin.node",
      "fin.cli",
      "fin.cli-version",
      "fin.credential",
      "fin.workspace",
      "fin.user-cli-config",
    ]);
    // Only `me --json` receives the credential; no `fin …` SDK command is run.
    expect(d.run.mock.calls.map(([args]) => args)).toEqual([["me", "--json"]]);
    expect(report.snapshot.identity).toMatchObject({ appId: "abc123de", region: "us" });
    expect(report.snapshot.latestVersion).toBe("0.14.1");
    expect(JSON.stringify(report)).not.toContain(SENTINEL);
  });

  it("adds the CLI's --verbose flag only when tracing is armed", async () => {
    const d = deps();
    await runDoctor(ctx, d, { verbose: true });
    expect(d.run.mock.calls[0]?.[0]).toEqual(["me", "--json", "--verbose"]);
  });

  it("stops before any credentialed call when the CLI is missing and points to install", async () => {
    const d = deps({ exec: fakeExec({ installed: false }) });
    const report = await runDoctor(ctx, d);
    expect(report.outcome).toBe("cli_missing");
    expect(report.message).toContain("/sf-fin install");
    expect(d.run).not.toHaveBeenCalled();
  });

  it("reports an available update as a warning, not a failure", async () => {
    const d = deps({ fetchRegistry: async () => ({ latest: "0.15.0" }) });
    const report = await runDoctor(ctx, d);
    expect(report.outcome).toBe("ok");
    expect(report.checks.find((c) => c.id === "fin.cli-version")).toMatchObject({
      severity: "warn",
      fix: "/sf-fin install",
    });
  });

  it("refuses versions below the supported minimum", async () => {
    const report = await runDoctor(ctx, deps({ exec: fakeExec({ version: "0.9.0" }) }));
    expect(report.outcome).toBe("cli_outdated");
  });

  it("flags an old Node runtime", async () => {
    const report = await runDoctor(ctx, deps({ nodeVersion: "18.19.0" }));
    expect(report.checks.find((c) => c.id === "fin.node")?.severity).toBe("error");
  });

  it("classifies a rejected token and adds pattern advice", async () => {
    const stderr = [
      "< 401",
      '< Body: {"errors":[{"code":"token_not_found"}]}',
      JSON.stringify({
        error: { code: "auth_error", message: "Authentication expired or invalid" },
      }),
    ].join("\n");
    const report = await runDoctor(ctx, deps({ meResponse: cli(2, "", stderr) }));
    expect(report.outcome).toBe("auth_expired");
    expect(report.message).toContain("/login sf-fin");
    expect(report.message).toContain("different region");
    expect(report.snapshot.lastCliError).toEqual({
      code: "auth_error",
      message: "Authentication expired or invalid",
    });
    expect(report.snapshot.lastDiagnosis).toBe("region");
  });

  it("reports not_connected without calling me", async () => {
    const d = deps({
      resolveCredential: async () => ({ ok: false, message: "SF Fin is not connected." }),
    });
    const report = await runDoctor(ctx, d);
    expect(report.outcome).toBe("not_connected");
    expect(d.run).not.toHaveBeenCalled();
  });
});

describe("buildCachedChecks (/sf-pi doctor)", () => {
  it("uses only cached state and suggests the next command", () => {
    const checks = buildCachedChecks({ lastOutcome: "cli_missing", lastCheckedAt: "t" }, true);
    expect(checks.map((c) => c.id)).toEqual([
      "fin.cli",
      "fin.credential",
      "fin.workspace",
      "fin.user-cli-config",
    ]);
    expect(checks[0]).toMatchObject({ severity: "warn", fix: "/sf-fin install" });
    expect(checks[1]).toMatchObject({ severity: "warn", fix: "/login sf-fin" });
  });
});

describe("parseIdentity", () => {
  it("keeps only allowlisted non-secret fields", () => {
    const identity = parseIdentity(
      JSON.stringify({
        name: "A",
        email: "a@example.test",
        token: "x",
        app: { id_code: "id1", secret: "y" },
      }),
    );
    expect(identity).toEqual({ appId: "id1", adminName: "A", adminEmail: "a@example.test" });
  });

  it("rejects non-JSON and empty identities", () => {
    expect(parseIdentity("not json")).toBeUndefined();
    expect(parseIdentity("{}")).toBeUndefined();
  });
});
