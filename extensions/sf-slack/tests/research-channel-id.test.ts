/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior Proof for exact-ID research without metadata confirmation. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChannelCache, setDetectedTeamId } from "../lib/api.ts";
import { registerResearchTool } from "../lib/research-tool.ts";

const CHANNEL_ID = "C01ABCEXAMPLE";

function captureResearchTool() {
  let execute: (...args: never[]) => Promise<unknown>;
  registerResearchTool({
    registerTool(definition: { execute: typeof execute }) {
      execute = definition.execute;
    },
  } as never);
  return (...args: unknown[]) => execute(...(args as never[]));
}

async function runResearch(
  channelRef: string,
  options: {
    hasUI?: boolean;
    searchError?: string;
    assistantError?: string;
    strategy?: string;
    withMatch?: boolean;
  } = {},
) {
  const queries: string[] = [];
  const endpoints: string[] = [];
  const select = vi.fn(async () => undefined);
  const input = vi.fn(async () => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const url = typeof request === "string" || request instanceof URL ? request : request.url;
      const endpoint = new URL(url).pathname.split("/").at(-1)!;
      endpoints.push(endpoint);
      const body = String(init?.body ?? "");
      if (endpoint === "assistant.search.context" || endpoint === "search.messages") {
        const params =
          endpoint === "assistant.search.context"
            ? JSON.parse(body)
            : Object.fromEntries(new URLSearchParams(body));
        if (params.query.includes(CHANNEL_ID)) {
          expect(params.query).toContain(
            endpoint === "assistant.search.context" ? `in:<#${CHANNEL_ID}>` : `in:${CHANNEL_ID}`,
          );
        }
        queries.push(params.query.replace(`in:<#${CHANNEL_ID}>`, `in:${CHANNEL_ID}`));
        const error =
          options.searchError ||
          (endpoint === "assistant.search.context" ? options.assistantError : undefined);
        const matches = options.withMatch
          ? [
              {
                channel_id: CHANNEL_ID,
                channel_name: "example-channel",
                ts: "1700000000.100001",
                text: "Example release checklist",
              },
            ]
          : [];
        const payload = error
          ? { ok: false, error }
          : { ok: true, results: { messages: matches }, messages: { matches } };
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: "team_access_not_granted" }), {
        status: 200,
      });
    }),
  );
  const result = (await captureResearchTool()(
    "research-test",
    {
      query: '"release checklist" guide',
      channel_ref: channelRef,
      max_queries: 6,
      strategy: options.strategy ?? "strict_then_broaden",
    },
    undefined,
    undefined,
    {
      cwd: "/tmp/sf-slack-research-test",
      hasUI: options.hasUI ?? true,
      modelRegistry: { getApiKeyForProvider: vi.fn(async () => "xoxp-test") },
      ui: { select, input },
    },
  )) as { content: Array<{ text: string }>; details: { ok: boolean; reason?: string } };
  return { result, queries, endpoints, select, input };
}

describe("slack_research exact channel IDs", () => {
  beforeEach(() => {
    getChannelCache().clear();
    setDetectedTeamId(undefined);
    vi.stubEnv("SLACK_TEAM_ID", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    getChannelCache().clear();
    setDetectedTeamId(undefined);
  });

  it.each([true, false])("runs exact-ID research without a dialog (hasUI=%s)", async (hasUI) => {
    const observed = await runResearch(` ${CHANNEL_ID} `, { hasUI });
    expect(observed.result.details.ok).toBe(true);
    expect(observed.select).not.toHaveBeenCalled();
    expect(observed.input).not.toHaveBeenCalled();
    expect(observed.endpoints).not.toContain("conversations.info");
    expect(observed.endpoints).not.toContain("conversations.list");
    expect(observed.queries.length).toBeGreaterThan(1);
    for (const query of observed.queries) {
      expect(query).toContain(`in:${CHANNEL_ID}`);
      expect(query).not.toContain(`in:#${CHANNEL_ID}`);
    }
  });

  it.each([undefined, "feature_not_enabled"])(
    "returns scoped matches through either search endpoint (%s)",
    async (assistantError) => {
      const observed = await runResearch(CHANNEL_ID, { assistantError, withMatch: true });
      expect(observed.result.details.ok).toBe(true);
      expect(observed.result.content[0].text).toContain("Example release checklist");
      expect(observed.select).not.toHaveBeenCalled();
      if (assistantError) expect(observed.endpoints).toContain("search.messages");
      expect(observed.queries.every((query) => query.includes(`in:${CHANNEL_ID}`))).toBe(true);
    },
  );

  it("does not depend on cache warming or remembered approval", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      getChannelCache().clear();
      const observed = await runResearch(CHANNEL_ID);
      expect(observed.result.details.ok).toBe(true);
      expect(observed.select).not.toHaveBeenCalled();
      expect(getChannelCache().has(CHANNEL_ID)).toBe(false);
    }
  });

  it("keeps the channel restriction with the broad strategy", async () => {
    const observed = await runResearch(CHANNEL_ID, { strategy: "broad" });
    expect(observed.result.details.ok).toBe(true);
    expect(observed.queries.length).toBeGreaterThan(1);
    expect(observed.queries.every((query) => query.includes(`in:${CHANNEL_ID}`))).toBe(true);
  });

  it("returns search denial without dropping the channel restriction", async () => {
    const observed = await runResearch(CHANNEL_ID, { searchError: "channel_not_found" });
    expect(observed.result.details.ok).toBe(false);
    expect(observed.result.details.reason).toBe("channel_not_found");
    expect(observed.select).not.toHaveBeenCalled();
    expect(observed.endpoints).toContain("search.messages");
    expect(observed.queries.every((query) => query.includes(`in:${CHANNEL_ID}`))).toBe(true);
  });

  it("still asks for clarification for an unresolved name and never runs an unscoped search", async () => {
    const observed = await runResearch("unknown-channel", {
      searchError: "team_access_not_granted",
    });
    expect(observed.result.details.ok).toBe(false);
    expect(observed.result.details.reason).toBe("cancelled");
    expect(observed.select).toHaveBeenCalledOnce();
    expect(observed.result.content[0].text).toContain("I did not run a broad workspace search");
  });
});
