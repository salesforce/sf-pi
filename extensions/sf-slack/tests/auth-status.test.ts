/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for buildAuthStatus() (P4 granted-vs-requested rendering).
 *
 * Covers:
 *   - Granted scopes block shows what Slack returned, not what we asked for
 *   - "Requested but not granted" warning fires on drift
 *   - Token-type tag is rendered
 *   - Unknown-granted path renders the "no capture yet" hint
 */
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildAuthStatus } from "../lib/format.ts";
import { _resetGrantedScopes, slackApi, getGrantedScopes } from "../lib/api.ts";

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
const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

function mockFetchWithScopes(scopesHeader: string | null): void {
  globalThis.fetch = (async () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (scopesHeader !== null) headers["x-oauth-scopes"] = scopesHeader;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }) as unknown as typeof fetch;
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
    globalThis.fetch = originalFetch;
    _resetGrantedScopes();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders token type and granted-vs-requested diff when scopes drift", async () => {
    process.env.SLACK_USER_TOKEN = "xoxp-test-12345678";
    // Narrow the requested-scope list so the test diff is predictable.
    process.env.SLACK_SCOPES = "users:read,files:read,channels:read";

    mockFetchWithScopes("users:read, canvases:read");
    await slackApi("auth.test", "xoxp-test-12345678", {});
    expect(getGrantedScopes()).not.toBe(null);

    const status = await buildAuthStatus(fakeCtx("xoxp-test-12345678"));

    expect(status).toMatch(/Status: \u2705 Active/);
    expect(status).toMatch(/user token \(xoxp-\)/);
    expect(status).toMatch(/Granted scopes \(from Slack, 2\)/);
    expect(status).toMatch(/canvases:read/);
    // Drift warning on requested-but-not-granted:
    expect(status).toMatch(/Requested but not granted \(2\)/);
    expect(status).toMatch(/files:read/);
    expect(status).toMatch(/channels:read/);
    expect(status).toMatch(/Re-run \/login sf-slack/);
  });

  it("omits the drift warning when every requested scope was granted", async () => {
    process.env.SLACK_USER_TOKEN = "xoxp-test-12345678";
    process.env.SLACK_SCOPES = "users:read,canvases:read";
    mockFetchWithScopes("users:read, canvases:read, identity");
    await slackApi("auth.test", "xoxp-test-12345678", {});

    const status = await buildAuthStatus(fakeCtx("xoxp-test-12345678"));

    expect(status).toMatch(/Granted scopes/);
    expect(status).not.toMatch(/Requested but not granted/);
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
    expect(status).toMatch(/\/sf-slack refresh/);
    // Requested scopes must still be listed so the user sees what we asked for.
    expect(status).toMatch(/Requested scopes/);
  });

  it("shows setup instructions when no auth is configured", async () => {
    delete process.env.SLACK_USER_TOKEN;

    const status = await buildAuthStatus(fakeCtx(undefined));

    expect(status).toMatch(/Not configured/);
    expect(status).toMatch(/\/login sf-slack/);
    // Even the not-configured path still lists requested scopes so the user
    // can see what they'll be asked to consent to.
    expect(status).toMatch(/Requested scopes/);
  });
});
