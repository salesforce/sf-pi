/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { FinCredentialResult } from "../lib/auth.ts";
import type { CliRunResult } from "../lib/cli-runner.ts";
import { parseIdentity, runDoctor, type DoctorDeps } from "../lib/doctor.ts";

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

function cli(exitCode: number, stdout = "", stderr = ""): CliRunResult {
  return { exitCode, stdout, stderr, timedOut: false, truncated: false };
}

function deps(overrides: Partial<DoctorDeps> & { responses?: CliRunResult[] } = {}): DoctorDeps & {
  run: ReturnType<typeof vi.fn>;
} {
  const responses = [...(overrides.responses ?? [cli(0, "0.14.1\n"), cli(0, ME)])];
  return {
    resolveCredential: overrides.resolveCredential ?? (async () => connected),
    run: vi.fn(async () => responses.shift() ?? cli(1)),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("runDoctor", () => {
  it("runs only read-only --version and me, and records non-secret identity", async () => {
    const d = deps();
    const report = await runDoctor(ctx, d);

    expect(d.run.mock.calls.map(([args]) => args)).toEqual([["--version"], ["me", "--json"]]);
    expect(d.run.mock.calls[0]?.[1]).not.toHaveProperty("credential");
    expect(d.run.mock.calls[1]?.[1]).toMatchObject({
      credential: connected.ok && connected.credential,
    });
    expect(report.outcome).toBe("ok");
    expect(report.snapshot).toEqual({
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
      lastOutcome: "ok",
      lastMessage: "Connected to Example Workspace · app id abc123de (US).",
      cliVersion: "0.14.1",
      identity: {
        appId: "abc123de",
        workspaceName: "Example Workspace",
        adminName: "Example Admin",
        adminEmail: "admin@example.test",
        region: "us",
      },
    });
    expect(JSON.stringify(report)).not.toContain(SENTINEL);
  });

  it("stops before any credentialed call when the CLI is missing", async () => {
    const d = deps({
      responses: [
        {
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          truncated: false,
          spawnError: "ENOENT",
        },
      ],
    });
    const report = await runDoctor(ctx, d);
    expect(report.outcome).toBe("cli_missing");
    expect(report.message).toContain("npm install -g @intercom/cli");
    expect(d.run).toHaveBeenCalledTimes(1);
  });

  it("refuses CLI versions below the supported minimum", async () => {
    const d = deps({ responses: [cli(0, "0.9.0\n")] });
    const report = await runDoctor(ctx, d);
    expect(report.outcome).toBe("cli_outdated");
    expect(d.run).toHaveBeenCalledTimes(1);
  });

  it("reports not_connected without calling me", async () => {
    const d = deps({
      responses: [cli(0, "0.14.1\n")],
      resolveCredential: async () => ({ ok: false, message: "SF Fin is not connected." }),
    });
    const report = await runDoctor(ctx, d);
    expect(report.outcome).toBe("not_connected");
    expect(d.run).toHaveBeenCalledTimes(1);
  });

  it("classifies a rejected token as auth_expired with a re-login hint", async () => {
    const stderr = JSON.stringify({
      error: { code: "auth_error", message: "Authentication expired or invalid" },
    });
    const report = await runDoctor(
      ctx,
      deps({ responses: [cli(0, "0.14.1\n"), cli(2, "", stderr)] }),
    );
    expect(report.outcome).toBe("auth_expired");
    expect(report.message).toContain("/login sf-fin");
    expect(report.snapshot.cliVersion).toBe("0.14.1");
    expect(report.snapshot.identity).toBeUndefined();
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
