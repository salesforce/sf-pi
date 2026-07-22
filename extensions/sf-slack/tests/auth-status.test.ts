/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for buildAuthStatus() (P4 granted-vs-requested rendering).
 *
 * Covers:
 *   - Granted scopes block shows what Slack returned, not what we asked for
 *   - Partial grants are explained without implying auth is limited
 *   - Token-type tag is rendered
 *   - Unknown-granted path renders the "no capture yet" hint
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildAuthStatus } from "../lib/format.ts";
import { _resetGrantedScopes, slackApi, getGrantedScopes } from "../lib/api.ts";
// global fetch is stubbed via vi.stubGlobal.

// Minimal ExtensionContext shape needed by buildAuthStatus (it only calls
// ctx.modelRegistry.getApiKeyForProvider as a last-resort fallback).
type AnyCtx = Parameters<typeof buildAuthStatus>[0];
function fakeCtx(token?: string): AnyCtx {
  return {
    modelRegistry: {
      getApiKeyForProvider: async () => token,
    },
  } as unknown as AnyCtx;
}

const ORIGINAL_ENV = { ...process.env };
const tempDirs: string[] = [];

function mockFetchWithScopes(scopesHeader: string | null): void {
  const headers: Record<string, string> = {};
  if (scopesHeader !== null) headers["x-oauth-scopes"] = scopesHeader;
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers }),
  );
}

describe("buildAuthStatus", () => {
  beforeEach(() => {
    _resetGrantedScopes();
    // Redirect the pi-auth store lookup to an empty temp dir so the test
    // environment (whose real ~/.pi/agent/auth.json may contain a Slack
    // token) cannot leak into the "not configured" case.
    const dir = mkdtempSync(path.join(tmpdir(), "sf-slack-authstatus-"));
    tempDirs.push(dir);
    process.env.PI_CODING_AGENT_DIR = dir;
    delete process.env.SLACK_USER_TOKEN;
    delete process.env.SLACK_SCOPES;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    _resetGrantedScopes();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders token type and granted-vs-requested coverage for partial grants", async () => {
    process.env.SLACK_USER_TOKEN = "xoxp-test-12345678";
    // Narrow the requested-scope list so the test diff is predictable.
    process.env.SLACK_SCOPES = "users:read,files:read,channels:read";

    mockFetchWithScopes("users:read, canvases:read");
    await slackApi("auth.test", "xoxp-test-12345678", {});
    expect(getGrantedScopes()).not.toBe(null);

    const status = await buildAuthStatus(fakeCtx("xoxp-test-12345678"));

    expect(status).toMatch(/Status: \u2705 Connected/);
    expect(status).toMatch(/user token \(xoxp-\)/);
    expect(status).not.toMatch(/^Token:/m);
    expect(status).not.toContain("xoxp-test-12345678");
    expect(status).toMatch(/Scope grant: 1 of 3 requested scopes granted by Slack/);
    expect(status).toMatch(/Granted scopes \(from Slack\)/);
    expect(status).toMatch(/canvases:read/);
    expect(status).toMatch(/Additional Slack-returned scopes not requested/);
    expect(status).toMatch(/Capabilities:/);
    expect(status).toMatch(/Canvases: section lookup; metadata degraded without files:read/);
    expect(status).toMatch(/Files: not granted|Files: search available/);
    // Partial grants are shown as neutral workspace/app coverage, not auth failure.
    expect(status).toMatch(/Not included in the current workspace\/app grant \(2\)/);
    expect(status).toMatch(/files:read/);
    expect(status).toMatch(/channels:read/);
    expect(status).toMatch(/No action is needed unless/);
    expect(status).toMatch(/Re-auth will only add scopes/);
  });

  it("omits the partial-grant note when every requested scope was granted", async () => {
    process.env.SLACK_USER_TOKEN = "xoxp-test-12345678";
    process.env.SLACK_SCOPES = "users:read,canvases:read";
    mockFetchWithScopes("users:read, canvases:read, identity");
    await slackApi("auth.test", "xoxp-test-12345678", {});

    const status = await buildAuthStatus(fakeCtx("xoxp-test-12345678"));

    expect(status).toMatch(/Granted scopes/);
    expect(status).toMatch(/Capabilities:/);
    expect(status).not.toMatch(/Not included in the current workspace\/app grant/);
  });

  it("warns about a bot token type", async () => {
    process.env.SLACK_USER_TOKEN = "xoxb-bot-token-123";
    process.env.SLACK_SCOPES = "chat:write";
    mockFetchWithScopes("chat:write");
    await slackApi("auth.test", "xoxb-bot-token-123", {});

    const status = await buildAuthStatus(fakeCtx("xoxb-bot-token-123"));

    expect(status).toMatch(/bot token \(xoxb-\)/);
    expect(status).toMatch(/some actions need a user token/);
  });

  it("falls back to an unknown-scopes hint when no capture has happened", async () => {
    process.env.SLACK_USER_TOKEN = "xoxp-test-12345678";
    _resetGrantedScopes();

    const status = await buildAuthStatus(fakeCtx("xoxp-test-12345678"));

    expect(status).toMatch(/Granted scopes: \(unknown/);
    expect(status).toMatch(/Capabilities:/);
    expect(status).toMatch(/\/sf-slack refresh/);
    // Requested scopes must still be listed so the user sees what we asked for.
    expect(status).toMatch(/Requested scopes/);
  });

  it("shows setup instructions when no auth is configured", async () => {
    delete process.env.SLACK_USER_TOKEN;

    const status = await buildAuthStatus(fakeCtx(undefined));

    expect(status).toMatch(/Not configured/);
    expect(status).toContain("Interactive entry is temporarily disabled");
    expect(status).toContain("SLACK_USER_TOKEN");
    expect(status).not.toContain("/login sf-slack");
    // Even the not-configured path still lists requested scopes so the user
    // can see what they'll be asked to consent to.
    expect(status).toMatch(/Requested scopes/);
  });
});
