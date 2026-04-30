/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for slack_canvas per-action write preflight (P3).
 *
 * We gate canvas create/edit before hitting the network so we can return a
 * precise, actionable error (\"use a user token\" / \"re-consent with
 * canvases:write\") instead of relaying Slack's raw bot_scopes_not_found or
 * missing_scope.
 */
import { afterEach, beforeAll, beforeEach, describe, it, expect } from "vitest";
import { preflightCanvasWrite } from "../lib/canvas-tool.ts";
import { _resetGrantedScopes, slackApi } from "../lib/api.ts";

const originalFetch = globalThis.fetch;

function mockFetchWithScopes(scopesHeader: string): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-oauth-scopes": scopesHeader,
      },
    })) as unknown as typeof fetch;
}

describe("preflightCanvasWrite", () => {
  beforeEach(() => {
    _resetGrantedScopes();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetGrantedScopes();
  });

  it("returns null when a user token has canvases:write", async () => {
    mockFetchWithScopes("canvases:read, canvases:write");
    await slackApi("auth.test", "xoxp-test", {});

    expect(preflightCanvasWrite("user")).toBeNull();
  });

  it("rejects bot tokens with a user-token hint", () => {
    // Bot tokens get rejected regardless of the granted-scope state because
    // Slack itself returns bot_scopes_not_found on canvases.* for bot tokens.
    const gate = preflightCanvasWrite("bot");
    expect(gate).not.toBeNull();
    expect(gate!.reason).toBe("wrong_token_type");
    expect(gate!.message).toMatch(/user token \(xoxp-\)/);
    expect(gate!.message).toMatch(/bot_scopes_not_found/);
  });

  it("rejects app-level tokens the same way", () => {
    const gate = preflightCanvasWrite("app");
    expect(gate).not.toBeNull();
    expect(gate!.reason).toBe("wrong_token_type");
  });

  it("rejects user tokens missing canvases:write", async () => {
    mockFetchWithScopes("canvases:read, users:read");
    await slackApi("auth.test", "xoxp-test", {});

    const gate = preflightCanvasWrite("user");
    expect(gate).not.toBeNull();
    expect(gate!.reason).toBe("missing_scope");
    expect(gate!.message).toMatch(/canvases:write/);
    expect(gate!.message).toMatch(/\/login sf-slack/);
  });

  it("does not block unknown token types when the scope is unknown", () => {
    // Unknown token + unknown scopes \u2192 let Slack be authoritative. We don't
    // want to false-positive block a user whose token prefix we failed to
    // recognize but who would otherwise succeed.
    _resetGrantedScopes();
    expect(preflightCanvasWrite("unknown")).toBeNull();
  });
});

// ─── Source-level guards for the canvas `read` fallback error decoder ─────────
// Live repro: user supplied a non-existent canvas ID, files.info failed with
// missing_scope on a files:read-less token, the fallback lookup also failed
// but with file_not_found, not missing_scope. Previously the code assumed
// the fallback failed for the same reason and told the user canvases:read
// was missing, which was false. The fix distinguishes the two.
describe("slack_canvas read — fallback error decoding", () => {
  let canvasSource = "";
  beforeAll(async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const urlmod = await import("node:url");
    canvasSource = fs.readFileSync(
      path.resolve(urlmod.fileURLToPath(import.meta.url), "../../lib/canvas-tool.ts"),
      "utf-8",
    );
  });

  it("handles file_not_found on the fallback as canvas_not_found", () => {
    expect(canvasSource).toMatch(/canvas_not_found/);
    // The decoder must distinguish the fallback error from the primary
    // error — do not reuse the primary error's reason string blindly.
    expect(canvasSource).toMatch(/fallbackErr/);
  });

  it('reserves the "both scopes missing" copy for a true double-missing_scope', () => {
    // The old code triggered the "both scopes missing" copy on any fallback
    // failure. Lock in that the new code only does so on
    // fallbackErr === "missing_scope".
    expect(canvasSource).toMatch(/fallbackErr === "missing_scope"/);
  });

  it("does not claim canvases:read is missing when it isn't", () => {
    // Regression guard: the literal from the misleading error copy should
    // appear at most once (inside the true double-missing_scope branch).
    const occurrences = canvasSource.match(/lacks both files:read and canvases:read/g) || [];
    expect(occurrences.length).toBeLessThanOrEqual(1);
  });
});
