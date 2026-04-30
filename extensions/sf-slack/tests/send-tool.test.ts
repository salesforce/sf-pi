/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for slack_send — the one high-blast-radius write surface.
 *
 * What's covered:
 *   - preflightSend(): token-type gate, scope gate, happy path
 *   - scope-probe gating: slack_send gated off when chat:write is not granted
 *   - Source-level guards: mention pattern, confirm-dialog path, headless
 *     refusal wiring, audit append, dry-run env var
 *
 * Why source-level guards: exercising the full tool through pi's runtime
 * needs a real ExtensionContext with TUI mocks. The precedent in this repo
 * (see registration-gate.test.ts) is to source-check the critical invariants.
 * That gives a fast, deterministic signal that future refactors didn't
 * silently drop the safety rails.
 */
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { _resetGrantedScopes, slackApi } from "../lib/api.ts";
import { preflightSend } from "../lib/send-tool.ts";
import { computeGatedTools } from "../lib/scope-probe.ts";

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

const sendSource = readFileSync(
  path.resolve(fileURLToPath(import.meta.url), "../../lib/send-tool.ts"),
  "utf-8",
);
const indexSource = readFileSync(
  path.resolve(fileURLToPath(import.meta.url), "../../index.ts"),
  "utf-8",
);

describe("preflightSend", () => {
  beforeEach(() => {
    _resetGrantedScopes();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetGrantedScopes();
  });

  it("passes when a user token has chat:write granted", async () => {
    mockFetchWithScopes("chat:write, users:read");
    await slackApi("auth.test", "xoxp-test", {});
    expect(preflightSend("xoxp-test")).toBeNull();
  });

  it("passes when a user token has only chat:write.public granted", async () => {
    // Some workspaces grant the narrower scope instead of the general one.
    mockFetchWithScopes("chat:write.public, users:read");
    await slackApi("auth.test", "xoxp-test", {});
    expect(preflightSend("xoxp-test")).toBeNull();
  });

  it("rejects bot tokens with a user-token hint", () => {
    const failure = preflightSend("xoxb-bot-token");
    expect(failure).not.toBeNull();
    expect(failure!.details.reason).toBe("wrong_token_type");
    expect(failure!.content[0].text).toMatch(/user token \(xoxp-\)/);
    expect(failure!.content[0].text).toMatch(/bot token/);
  });

  it("rejects app-level tokens the same way", () => {
    const failure = preflightSend("xoxa-app-token");
    expect(failure).not.toBeNull();
    expect(failure!.details.reason).toBe("wrong_token_type");
  });

  it("rejects user tokens missing chat:write", async () => {
    mockFetchWithScopes("users:read, canvases:read");
    await slackApi("auth.test", "xoxp-test", {});
    const failure = preflightSend("xoxp-test");
    expect(failure).not.toBeNull();
    expect(failure!.details.reason).toBe("missing_scope");
    expect(failure!.content[0].text).toMatch(/chat:write/);
    expect(failure!.content[0].text).toMatch(/re-consent/i);
  });

  describe("action-aware gating", () => {
    it("blocks action=dm when im:write is missing, with a targeted message", async () => {
      // Matches the live session repro: chat:write granted, im:write not.
      mockFetchWithScopes("chat:write, users:read, canvases:read");
      await slackApi("auth.test", "xoxp-test", {});
      const failure = preflightSend("xoxp-test", "dm");
      expect(failure).not.toBeNull();
      expect(failure!.details.action).toBe("dm");
      expect(failure!.details.reason).toBe("missing_scope");
      // Error must name im:write specifically — the point of this gate is
      // to stop Slack's noisy `needed: channels:write,groups:write,...`
      // response from leaking through.
      expect(failure!.content[0].text).toMatch(/im:write/);
      expect(failure!.content[0].text).not.toMatch(/channels:write/);
    });

    it("allows action=dm when im:write is granted", async () => {
      mockFetchWithScopes("chat:write, im:write, users:read");
      await slackApi("auth.test", "xoxp-test", {});
      expect(preflightSend("xoxp-test", "dm")).toBeNull();
    });

    it("allows action=channel without im:write", async () => {
      // Posting to a regular channel only needs chat:write, not im:write —
      // verify the DM gate doesn't leak into non-DM actions.
      mockFetchWithScopes("chat:write, users:read");
      await slackApi("auth.test", "xoxp-test", {});
      expect(preflightSend("xoxp-test", "channel")).toBeNull();
      expect(preflightSend("xoxp-test", "thread")).toBeNull();
    });

    it("still rejects bot tokens for action=dm", async () => {
      const failure = preflightSend("xoxb-bot", "dm");
      expect(failure).not.toBeNull();
      // Token-type check runs before the scope check, so the reason reflects
      // the root cause instead of a misleading missing_scope.
      expect(failure!.details.reason).toBe("wrong_token_type");
    });
  });
});

describe("scope-probe gating for slack_send", () => {
  it("gates slack_send when neither chat:write nor chat:write.public is granted", () => {
    const granted = new Set(["users:read", "search:read.public", "channels:read"]);
    const gated = computeGatedTools(granted, ["slack_send", "slack_user"]);
    expect(gated).toContain("slack_send");
  });

  it("does not gate slack_send when chat:write is granted", () => {
    const granted = new Set(["chat:write", "users:read"]);
    const gated = computeGatedTools(granted, ["slack_send", "slack_user"]);
    expect(gated).not.toContain("slack_send");
  });

  it("does not gate slack_send when only chat:write.public is granted", () => {
    const granted = new Set(["chat:write.public", "users:read"]);
    const gated = computeGatedTools(granted, ["slack_send", "slack_user"]);
    expect(gated).not.toContain("slack_send");
  });
});

describe("slack_send source-level safety invariants", () => {
  it("never imports chat.postMessage directly with a form body", () => {
    // Canvas writes use slackApiJson. Force the same for chat.postMessage so
    // `text` preserves newlines and unicode correctly. Nobody should sneak in
    // a `slackApi("chat.postMessage", ...)` (form-encoded) call site.
    expect(sendSource).not.toMatch(/slackApi\s*<[^>]*>\s*\(\s*"chat\.postMessage"/);
    expect(sendSource).toMatch(/chatPostMessage\s*\(/);
  });

  it("refuses in headless mode unless SLACK_ALLOW_HEADLESS_SEND is set", () => {
    // The exact env var name is part of the contract \u2014 changing it would
    // silently break anyone's CI opt-in. Guard the literal.
    expect(sendSource).toContain("SLACK_ALLOW_HEADLESS_SEND");
    expect(sendSource).toMatch(/ENV_ALLOW_HEADLESS_SEND/);
    expect(sendSource).toMatch(/headless_refused/);
  });

  it("detects every broadcast-scoped mention token in the text and re-confirms", () => {
    // We rely on a pattern covering both the raw `@...` prefix and Slack's
    // serialized `<!channel>`/`<!here>`/`<!everyone>`/`<!subteam>` tokens
    // that appear when the user pastes already-formatted mrkdwn. The
    // <!subteam check is new in this PR — live repro showed a user-group
    // ping bypassed the warning previously.
    expect(sendSource).toMatch(/MENTION_PATTERN/);
    expect(sendSource).toMatch(/<!channel/);
    expect(sendSource).toMatch(/<!here/);
    expect(sendSource).toMatch(/<!everyone/);
    expect(sendSource).toMatch(/<!subteam/);
    expect(sendSource).toMatch(/@channel/);
    expect(sendSource).toMatch(/@here/);
    expect(sendSource).toMatch(/@everyone/);
    // There must be a second confirm call specifically for mentions.
    const confirmCount = (sendSource.match(/ctx\.ui\.confirm\s*\(/g) || []).length;
    expect(confirmCount).toBeGreaterThanOrEqual(2);
  });

  it("MENTION_PATTERN matches user-group pings at runtime", async () => {
    // Runtime check — re-import the module's pattern via a tiny consumer.
    // We can't export the regex itself without polluting the API surface,
    // so we pattern-extract it from source and evaluate it here.
    const match = sendSource.match(/const MENTION_PATTERN\s*=\s*(\/[^;]+\/\w*);/);
    expect(match).not.toBeNull();

    const pattern = eval(match![1]) as RegExp;
    expect(pattern.test("hello <!subteam^S123ABCDEFG|@some-group> world")).toBe(true);
    expect(pattern.test("hello <!channel>")).toBe(true);
    expect(pattern.test("hello <@U02EK4AHJMU>")).toBe(false);
    expect(pattern.test("hello @channelish")).toBe(false);
  });

  it("always appends an audit entry (via pi.appendEntry) \u2014 success and dry-run", () => {
    expect(sendSource).toMatch(/pi\.appendEntry<SlackSendAuditEntry>/);
    expect(sendSource).toMatch(/SEND_ENTRY_TYPE/);
    // Both the dry-run branch and the real-send branch must call the helper.
    const appendCalls = (sendSource.match(/appendAuditEntry\s*\(/g) || []).length;
    expect(appendCalls).toBeGreaterThanOrEqual(2);
  });

  it("honors the dry-run env var before hitting chat.postMessage", () => {
    expect(sendSource).toMatch(/SLACK_SEND_DRY_RUN/);
    // The dry-run branch must return *before* the real chatPostMessage call.
    const dryRunIdx = sendSource.indexOf("ENV_SEND_DRY_RUN");
    const postMessageIdx = sendSource.indexOf("chatPostMessage(auth.token");
    expect(dryRunIdx).toBeGreaterThan(0);
    expect(postMessageIdx).toBeGreaterThan(dryRunIdx);
  });

  it('never adds any "Sent from pi via Slack API"-style signature', () => {
    // This is the exact kind of hack a future \"helpful\" refactor might
    // reintroduce. Block the literal substrings.
    expect(sendSource).not.toMatch(/Sent from pi/i);
    expect(sendSource).not.toMatch(/via Slack API/i);
    expect(sendSource).not.toMatch(/\\n---\\n_Sent by/i);
  });

  it("honors the confirm-dialog timeout and ctx.signal", () => {
    // Dialog must be cancellable both programmatically (signal) and by idle
    // timeout so a wandered-off agent can't leave a send hanging forever.
    expect(sendSource).toMatch(/CONFIRM_TIMEOUT_SECONDS/);
    expect(sendSource).toMatch(/signal,\s*timeout:\s*CONFIRM_TIMEOUT_SECONDS/);
  });

  it("delegates fuzzy recipient confirmation to the HITL helper", () => {
    // The old code had inline pickCandidateChannel / pickCandidateUser
    // helpers and an AUTO_SELECT_THRESHOLD constant. The new code routes
    // every channel + user resolution through requireConfirmedChannel /
    // requireConfirmedUser, which is where the select-or-type dialog lives.
    expect(sendSource).toMatch(/requireConfirmedChannel\s*\(/);
    expect(sendSource).toMatch(/requireConfirmedUser\s*\(/);
    // The inline helpers (and their local threshold) are gone — belt-and-
    // braces check so nobody silently reintroduces them.
    expect(sendSource).not.toMatch(/function pickCandidateChannel/);
    expect(sendSource).not.toMatch(/function pickCandidateUser/);
  });
});

describe("/sf-slack sent command", () => {
  it("is wired into the command's argument completions and handler", () => {
    expect(indexSource).toMatch(/subs\s*=\s*\[[^\]]*"sent"/);
    expect(indexSource).toContain('if (sub === "sent")');
    expect(indexSource).toContain("collectSendHistory");
    expect(indexSource).toContain("SEND_ENTRY_TYPE");
  });
});

describe("routeRecipient — channel label resolution", () => {
  // Live repro (v0.14.1): `slack_send action=channel to=C09MFCX4A2H`
  // rendered a bare ID instead of `#jag-fde-ai-sharelab`. Fix shipped a
  // raw-ID async fallback in routeRecipient. The HITL-helper migration
  // moved that concern up one layer: requireConfirmedChannel always
  // goes through the fuzzy/ID resolvers in resolve.ts which hit
  // conversations.info for raw IDs, so a cold cache no longer produces
  // a bare-ID confirm dialog.

  it("no longer short-circuits on isSlackChannelId for channel sends", () => {
    // The old routeRecipient had an `if (isSlackChannelId(ref))` fast
    // path that skipped verification. That path is gone; raw IDs flow
    // through requireConfirmedChannel like every other ref.
    expect(sendSource).not.toMatch(/if \(isSlackChannelId\(ref\)\)/);
    // The channel route path calls the HITL helper regardless of ref shape.
    expect(sendSource).toMatch(/requireConfirmedChannel\(ctx, token, ref/);
  });
});
