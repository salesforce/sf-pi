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
import { buildExistingDmSearchQueries, preflightSend } from "../lib/send-tool.ts";
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

// send-tool.ts was split into a registration/audit/confirmation module
// (`send-tool.ts`) and a recipient-routing sibling (`send-tool-recipient.ts`).
// We concatenate both sources so the substring-based safety invariants below
// keep covering the whole slack_send surface area.
const sendSource = [
  readFileSync(path.resolve(fileURLToPath(import.meta.url), "../../lib/send-tool.ts"), "utf-8"),
  readFileSync(
    path.resolve(fileURLToPath(import.meta.url), "../../lib/send-tool-recipient.ts"),
    "utf-8",
  ),
].join("\n");
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

  it("rejects a user token that only has chat:write.public", async () => {
    mockFetchWithScopes("chat:write.public, users:read");
    await slackApi("auth.test", "xoxp-test", {});
    const failure = preflightSend("xoxp-test");
    expect(failure).not.toBeNull();
    expect(failure!.details.reason).toBe("missing_scope");
    expect(failure!.content[0].text).toMatch(/needs chat:write/);
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
    expect(failure!.content[0].text).toMatch(/Re-auth/i);
  });

  describe("action-aware gating", () => {
    it("allows action=dm without im:write so routeDm can try the existing-DM fallback", async () => {
      // chat:write is enough to post to an already-open D... channel. The
      // route layer handles im:write absence by searching for an existing DM
      // before it asks the user to grant more scopes.
      mockFetchWithScopes("chat:write, search:read.im, users:read, canvases:read");
      await slackApi("auth.test", "xoxp-test", {});
      expect(preflightSend("xoxp-test", "dm")).toBeNull();
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

describe("existing-DM fallback query planning", () => {
  it("prefers with:/from: searches and constrains fallback to a small query set", () => {
    const queries = buildExistingDmSearchQueries({
      ref: "Alex Morgan",
      userId: "U012ABCDEF",
      handle: "amorgan",
      displayName: "Alex Morgan",
      realName: "Alex Morgan",
    });

    expect(queries).toEqual(["with:@Alex Morgan", "from:amorgan", '"Alex Morgan"', "U012ABCDEF"]);
  });

  it("deduplicates @handle refs", () => {
    const queries = buildExistingDmSearchQueries({ ref: "@amorgan", handle: "amorgan" });
    expect(queries).toEqual(["from:amorgan"]);
  });
});

describe("scope-probe gating for slack_send", () => {
  it("gates slack_send when chat:write is not granted", () => {
    const granted = new Set(["users:read", "search:read.public", "channels:read"]);
    const gated = computeGatedTools(granted, ["slack_send", "slack_user"]);
    expect(gated).toContain("slack_send");
  });

  it("does not gate slack_send when chat:write is granted", () => {
    const granted = new Set(["chat:write", "users:read"]);
    const gated = computeGatedTools(granted, ["slack_send", "slack_user"]);
    expect(gated).not.toContain("slack_send");
  });

  it("gates slack_send when only chat:write.public is granted", () => {
    const granted = new Set(["chat:write.public", "users:read"]);
    const gated = computeGatedTools(granted, ["slack_send", "slack_user"]);
    expect(gated).toContain("slack_send");
  });

  it("gates slack_send for bot tokens even when chat:write is granted", () => {
    const granted = new Set(["chat:write", "users:read"]);
    const gated = computeGatedTools(granted, ["slack_send", "slack_user"], "bot");
    expect(gated).toContain("slack_send");
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

  it("tries an existing-DM search fallback before telling users to grant im:write", () => {
    expect(sendSource).toMatch(/findExistingDmChannel/);
    expect(sendSource).toMatch(/assistant\.search\.context/);
    expect(sendSource).toMatch(/channel_types:\s*"im"/);
    expect(sendSource).toMatch(/missingDmOpenScopeFailure/);
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
    expect(pattern.test("hello <@U012ABCDEF>")).toBe(false);
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

  it("folds recipient review into the final send confirmation", () => {
    // slack_send should not show the shared recipient-confirm select dialog
    // and then a separate final send dialog. It resolves candidates itself
    // and includes recipient confidence/alternates in the one final confirm.
    expect(sendSource).not.toMatch(/requireConfirmedChannel\s*\(/);
    expect(sendSource).not.toMatch(/requireConfirmedUser\s*\(/);
    expect(sendSource).toMatch(/recipientReview/);
    expect(sendSource).toMatch(/formatRecipientReview/);
    expect(sendSource).toMatch(/Other possible matches/);
    expect(sendSource).not.toMatch(/Cancelled\. What next/);
  });
});

describe("/sf-slack sent command", () => {
  it("is wired into the command's argument completions and handler", () => {
    expect(indexSource).toMatch(/value:\s*"sent"/);
    expect(indexSource).toContain('if (sub === "sent")');
    expect(indexSource).toContain("collectSendHistory");
    expect(indexSource).toContain("SEND_ENTRY_TYPE");
  });
});

describe("routeRecipient — channel label resolution", () => {
  // Live repro (v0.14.1): `slack_send action=channel to=C09MFCX4A2H`
  // rendered a bare ID instead of `#jag-fde-ai-sharelab`. Fix shipped a
  // raw-ID async fallback in routeRecipient. The unified-confirm flow keeps
  // verification in resolveChannel, but still offers an explicit raw-ID path
  // for user-supplied IDs that Slack cannot verify with the available scopes.

  it("routes raw channel IDs through resolve first and only falls back with a warning", () => {
    expect(sendSource).toMatch(/resolveChannel\(token, ref/);
    expect(sendSource).toMatch(/user_unverified/);
    expect(sendSource).toMatch(/could not verify this raw channel\/DM ID/);
  });
});
