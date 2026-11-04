/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFinSdkState, writeFinSdkState } from "../../../lib/common/fin-sdk-state.ts";
import type { FinCredential } from "../lib/auth.ts";
import type { CliRunResult } from "../lib/cli-runner.ts";
import { enableFinSdk, probeFinSdk } from "../lib/sdk-gate.ts";
import {
  downloadResources,
  ensureFinSdkEnabled,
  readManifest,
  summarizeManifest,
  type SdkReadDeps,
} from "../lib/sdk-reads.ts";

const SENTINEL = "fin-sentinel-token-0000";
const credential: FinCredential = { token: SENTINEL, source: "pi-auth", region: "us" };
const MANIFEST = {
  workspace: { name: "Example Workspace", app_id_code: "abc123de" },
  procedures: [{ id: "p1", name: "Refund request", state: "live" }],
  guidance: [],
  data_connectors: [],
};
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sf-fin-sdk-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

/** Fake Fin API: starts not-enabled; POST /fin-sdk/enable flips it. */
function fakeFin(initial: "enabled" | "not_enabled" = "not_enabled", enableStatus = 200) {
  let enabled = initial === "enabled";
  const calls: Array<{ method: string; url: string; auth?: string }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ method: init.method ?? "GET", url, auth: headers.Authorization });
    if (url.endsWith("/fin-sdk/enable") && init.method === "POST") {
      if (enableStatus === 200) enabled = true;
      return new Response(
        JSON.stringify(
          enableStatus === 200 ? {} : { errors: [{ code: "forbidden", message: "Nope" }] },
        ),
        {
          status: enableStatus,
        },
      );
    }
    if (url.endsWith("/fin-sdk/manifest")) {
      return enabled
        ? new Response(JSON.stringify(MANIFEST), { status: 200 })
        : new Response(
            JSON.stringify({
              errors: [
                { code: "fin_sdk_not_enabled", message: "Fin SDK is not enabled for your app." },
              ],
            }),
            { status: 403 },
          );
    }
    return new Response("{}", { status: 404 });
  });
  return { fetch, calls };
}

function cli(stdout = "", exitCode = 0): CliRunResult {
  return { exitCode, stdout, stderr: "", timedOut: false, truncated: false };
}

type RunMock = ReturnType<
  typeof vi.fn<(args: string[], options: unknown) => Promise<CliRunResult>>
>;

function deps(
  fetch: SdkReadDeps["fetch"],
  run: RunMock = vi.fn(async (_args: string[], _options: unknown) => cli(JSON.stringify(MANIFEST))),
): SdkReadDeps & { run: RunMock; exec: ReturnType<typeof vi.fn> } {
  return {
    run,
    exec: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
    fetch,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    appId: "abc123de",
  };
}

describe("Fin SDK gate", () => {
  it("probes without enabling and classifies the gate", async () => {
    const fin = fakeFin("not_enabled");
    await expect(probeFinSdk(credential, { fetch: fin.fetch })).resolves.toMatchObject({
      state: "not_enabled",
      status: 403,
      code: "fin_sdk_not_enabled",
    });
    expect(fin.calls.map((c) => c.method)).toEqual(["GET"]);
    expect(fin.calls[0]?.url).toBe("https://api.intercom.io/fin-sdk/manifest");
  });

  it("enables explicitly, verifies, and sends the token only as a header", async () => {
    const fin = fakeFin("not_enabled");
    const result = await enableFinSdk(credential, { fetch: fin.fetch });
    expect(result).toMatchObject({ ok: true, message: "Fin SDK enabled and verified." });
    expect(
      fin.calls.map((c) => `${c.method} ${c.url.replace("https://api.intercom.io", "")}`),
    ).toEqual(["GET /fin-sdk/manifest", "POST /fin-sdk/enable", "GET /fin-sdk/manifest"]);
    expect(fin.calls.every((c) => c.auth === `Bearer ${SENTINEL}`)).toBe(true);
    expect(fin.calls.every((c) => !c.url.includes(SENTINEL))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  it("does not POST when already enabled, and reports a refused enable", async () => {
    const enabled = fakeFin("enabled");
    await enableFinSdk(credential, { fetch: enabled.fetch });
    expect(enabled.calls.map((c) => c.method)).toEqual(["GET"]);

    const refused = fakeFin("not_enabled", 403);
    const result = await enableFinSdk(credential, { fetch: refused.fetch });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("HTTP 403");
  });

  it("targets the region-specific API host", async () => {
    const fin = fakeFin("enabled");
    await probeFinSdk({ ...credential, region: "eu" }, { fetch: fin.fetch });
    expect(fin.calls[0]?.url).toBe("https://api.eu.intercom.io/fin-sdk/manifest");
  });
});

describe("Fin SDK reads enable by default", () => {
  it("enables before the first CLI call, records state, and then reads the manifest", async () => {
    const fin = fakeFin("not_enabled");
    const d = deps(fin.fetch);
    const result = await readManifest(credential, d);

    expect(result.ok).toBe(true);
    expect(result.enabledNow).toBe(true);
    expect(result.text).toContain("SF Fin enabled and verified it");
    expect(result.text).toContain("Refund request");
    // The explicit enable happened before the CLI ever ran, so the CLI's own
    // auto-enable path could not fire.
    expect(fin.calls.some((c) => c.method === "POST")).toBe(true);
    expect(d.run).toHaveBeenCalledTimes(1);
    expect(d.run.mock.calls[0]?.[0]).toEqual(["fin", "manifest", "--json"]);
    expect(readFinSdkState()).toMatchObject({
      state: "enabled",
      appId: "abc123de",
      enabledBySfFinAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("skips enable on an already-enabled workspace", async () => {
    const fin = fakeFin("enabled");
    const result = await readManifest(credential, deps(fin.fetch));
    expect(result.enabledNow).toBe(false);
    expect(fin.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("never runs the CLI when enabling fails", async () => {
    const fin = fakeFin("not_enabled", 403);
    const d = deps(fin.fetch);
    const result = await readManifest(credential, d);
    expect(result.ok).toBe(false);
    expect(d.run).not.toHaveBeenCalled();
    expect(readFinSdkState().state).toBe("not_enabled");
  });

  it("downloads into an owner-only directory and extracts with unzip", async () => {
    const fin = fakeFin("enabled");
    const out = path.join(dir, "sdk");
    const run = vi.fn(async (args: string[], _options: unknown) => {
      const zip = args[args.indexOf("--output") + 1]!;
      writeFileSync(zip, "zip-bytes");
      return cli("Downloaded 9 bytes");
    });
    const d = deps(fin.fetch, run);
    d.exec.mockImplementation(async (_cmd: string, args: string[]) => {
      const target = args[args.indexOf("-d") + 1]!;
      mkdirSync(path.join(target, "procedures"), { recursive: true });
      writeFileSync(path.join(target, "procedures", "refund.yaml"), "name: Refund request\n");
      return { code: 0, stdout: "", stderr: "" };
    });
    const result = await downloadResources(credential, d, out);
    expect(result.ok).toBe(true);
    expect(run.mock.calls[0]?.[0]).toEqual([
      "fin",
      "download",
      "--output",
      path.join(out, "fin-resources.zip"),
    ]);
    expect(d.exec.mock.calls[0]?.[0]).toBe("unzip");
    expect(result.text).toContain("procedures/refund.yaml");
  });
});

describe("summarizeManifest", () => {
  it("counts sections and keeps only id, name, state", () => {
    const summary = summarizeManifest({
      ...MANIFEST,
      procedures: [{ id: "p1", name: "R", state: "live", body: "secret" }],
    });
    expect(summary.counts).toEqual({ procedures: 1, guidance: 0, data_connectors: 0 });
    expect(summary.items.procedures).toEqual([{ id: "p1", name: "R", state: "live" }]);
  });

  it("records state through the shared store without credentials", () => {
    writeFinSdkState({ state: "enabled", appId: "abc123de" });
    expect(JSON.stringify(readFinSdkState())).not.toContain(SENTINEL);
  });

  it("ensureFinSdkEnabled leaves state unchanged on probe errors", async () => {
    const fetch = vi.fn(async () => new Response("boom", { status: 500 }));
    const result = await ensureFinSdkEnabled(credential, {
      fetch,
      now: () => new Date(),
      appId: "x",
    });
    expect(result.ok).toBe(false);
    expect(readFinSdkState().state).toBe("unknown");
  });
});
