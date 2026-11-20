/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SF Fin Result Cards: every sf_fin result carries a human card in
 * `details.card` (rendered by renderResult) and a compact, secret-free model
 * packet in `content`.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { buildFinCard, modelPacket, MODEL_PACKET_MAX_CHARS } from "../lib/cards.ts";
import { renderFinResult } from "../lib/render.ts";

const theme = {
  fg: (color: string, text: string) => `[${color}]${text}[/]`,
  bold: (text: string) => `**${text}**`,
  bg: (color: string, text: string) => `{${color}}${text}{/}`,
} as unknown as Theme;

function render(details: Record<string, unknown>, text = "model text", expanded = false) {
  const card = buildFinCard({ text, details, ok: details.ok !== false });
  return renderFinResult(
    { content: [{ type: "text", text }], details: { ...details, card } },
    { expanded, isPartial: false },
    theme,
  )
    .render(120)
    .join("\n");
}

const CHECKS = [
  { id: "package", state: "ok", title: "Fin for Salesforce 0.8.0.1 installed (finai)" },
  {
    id: "audit-fields",
    state: "missing",
    title: "Audit field setting is off",
    fix: "audit_fields_enable",
  },
  { id: "fin-user", state: "ok", title: "Fin user exists" },
  { id: "oauth-connection", state: "missing", title: "Fin is not connected", fix: "connect" },
];

describe("salesforce readiness card", () => {
  const details = {
    action: "salesforce",
    operation: "readiness",
    ok: false,
    phase: "readiness",
    orgType: "developer",
    targetOrg: "ExampleOrg",
    checks: CHECKS,
  };

  it("groups checks, counts what is left, and names the single next operation", () => {
    const card = buildFinCard({ text: "x", details, ok: false });
    expect(card.status).toBe("warning");
    expect(card.chips?.map((c) => c.label)).toEqual(["2 to do", "2 ok"]);
    expect(card.sections?.map((s) => s.title)).toEqual([
      "Package",
      "Org settings",
      "Users and permissions",
      "Connection",
    ]);
    expect(card.next?.[0]).toContain("audit_fields_enable");
    expect(card.scope).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "org", value: "ExampleOrg" })]),
    );
  });

  it("renders as a panel with icons per check", () => {
    const out = render(details, "x", true);
    expect(out).toContain("Fin for Salesforce");
    expect(out).toContain("Audit field setting is off");
    expect(out).toContain("✅");
    expect(out).toContain("⏳");
  });

  it("is a success card with no next fix when everything is ok", () => {
    const card = buildFinCard({
      text: "x",
      details: { ...details, ok: true, checks: CHECKS.map((c) => ({ ...c, state: "ok" })) },
      ok: true,
    });
    expect(card.status).toBe("success");
    expect(card.chips?.map((c) => c.label)).toEqual(["4 ok"]);
  });
});

describe("change plan and result cards", () => {
  it("labels a plan as a review with the Guardrail rule and reversibility", () => {
    const card = buildFinCard({
      text: "Plan: enable Digital Experiences…",
      ok: true,
      details: {
        action: "salesforce",
        operation: "digital_experiences_enable",
        phase: "plan",
        targetOrg: "ExampleOrg",
        oneWay: true,
      },
    });
    expect(card.status).toBe("warning");
    expect(card.title).toContain("Plan");
    expect(card.chips?.map((c) => c.label)).toEqual(
      expect.arrayContaining(["⚠ one-way", "🔒 native-sf-fin-salesforce-setup"]),
    );
    expect(card.next?.[0]).toContain("allow_mutation=true");
  });

  it("shows a verified execute as success and a failed one as blocked", () => {
    const ok = buildFinCard({
      text: "✅ enabled",
      ok: true,
      details: {
        action: "salesforce",
        operation: "audit_fields_enable",
        phase: "execute",
        verified: true,
        targetOrg: "ExampleOrg",
      },
    });
    expect(ok.status).toBe("success");
    expect(ok.title).toContain("Applied");
    const bad = buildFinCard({
      text: "❌ did not verify",
      ok: false,
      details: { action: "salesforce", operation: "audit_fields_enable", phase: "execute" },
    });
    expect(bad.status).toBe("error");
  });
});

describe("procedure and simulation cards", () => {
  it("shows the procedure state badge and drift only when present", () => {
    const card = buildFinCard({
      text: "✅ Uploaded",
      ok: true,
      details: {
        action: "sdk",
        operation: "upload",
        phase: "upload",
        procedureId: "4242",
        savedState: "draft",
        savedVersion: "9",
        verified: true,
      },
    });
    expect(card.chips?.map((c) => c.label)).toEqual(expect.arrayContaining(["draft", "v9"]));
    expect(card.summary).toContain("4242");
  });

  it("tables simulation runs with failures and says which version was tested", () => {
    const card = buildFinCard({
      text: "Simulations: 1/2 passed.",
      ok: false,
      details: {
        action: "sdk",
        operation: "simulate",
        phase: "result",
        procedureId: "4242",
        passed: 1,
        total: 2,
        tested: "draft",
        runs: [
          { runId: "r1", name: "Happy path", status: "passed", passed: true, failures: [] },
          {
            runId: "r2",
            name: "Not found",
            status: "failed",
            passed: false,
            failures: ["outcome failed"],
          },
        ],
      },
    });
    expect(card.status).toBe("error");
    expect(card.chips?.map((c) => c.label)).toEqual(
      expect.arrayContaining(["1/2 passed", "draft tested"]),
    );
    const runs = card.sections?.find((s) => s.title === "Simulations");
    expect(runs?.rows.map((r) => r.icon)).toEqual(["✅", "❌"]);
    expect(runs?.rows[1]?.value).toContain("outcome failed");
  });
});

describe("conversation card", () => {
  it("renders the transcript as user and Fin turns with a billable marker", () => {
    const card = buildFinCard({
      text: "✅ Fin answered",
      ok: true,
      details: {
        action: "agent",
        operation: "run",
        phase: "run",
        conversationId: "sf-pi-x",
        status: "answered",
        transcript: [
          { role: "user", text: "Status of case 1024?" },
          { role: "fin", text: "Case 00001024 is New." },
        ],
      },
    });
    const turns = card.sections?.find((s) => s.title === "Conversation");
    expect(turns?.rows.map((r) => r.icon)).toEqual(["👤", "🤖"]);
    expect(card.chips?.map((c) => c.label)).toEqual(expect.arrayContaining(["💲 billable"]));
  });
});

describe("model packet", () => {
  it("keeps the model text bounded and secret-free", () => {
    const long = `${"x".repeat(MODEL_PACKET_MAX_CHARS * 2)} token=abc`;
    const packet = modelPacket(long, { secrets: ["abc"] });
    expect(packet.length).toBeLessThanOrEqual(MODEL_PACKET_MAX_CHARS);
    expect(packet).not.toContain("abc");
    expect(packet).toContain("truncated");
  });

  it("strips frontdoor and OAuth URLs from the model text", () => {
    const packet = modelPacket(
      "open https://example.my.salesforce.com/secur/frontdoor.jsp?sid=SECRET then",
      {},
    );
    expect(packet).not.toContain("SECRET");
    expect(packet).not.toContain("frontdoor.jsp?");
  });
});

describe("renderer fallbacks", () => {
  it("falls back to the model text when no card is attached, and shows progress while partial", () => {
    const plain = renderFinResult(
      { content: [{ type: "text", text: "fallback text" }], details: { action: "status" } },
      { expanded: false, isPartial: false },
      theme,
    )
      .render(80)
      .join("\n");
    expect(plain).toContain("fallback text");
    const partial = renderFinResult(
      {
        content: [{ type: "text", text: "Installing package…" }],
        details: { progress: { phase: "package_install", current: "Installing package…" } },
      },
      { expanded: false, isPartial: true },
      theme,
    )
      .render(80)
      .join("\n");
    expect(partial).toContain("Installing package…");
  });
});

describe("sf_fin tool wiring", () => {
  it("attaches a card and a bounded model packet to every result, and streams progress", async () => {
    const { registerSfFinTool } = await import("../lib/sf_fin-tool.ts");
    let tool: any;
    const pi = { registerTool: (t: unknown) => (tool = t) } as never;
    const service = {
      salesforce: async () => ({
        ok: false,
        text: "Fin for Salesforce readiness — ExampleOrg (developer)\n⏳ Fin is not connected",
        details: {
          phase: "readiness",
          orgType: "developer",
          checks: [
            {
              id: "oauth-connection",
              state: "missing",
              title: "Fin is not connected",
              fix: "connect",
            },
          ],
        },
      }),
    } as never;
    registerSfFinTool(pi, service, () => ({}) as never);
    const updates: unknown[] = [];
    const result = await tool.execute(
      "id",
      { action: "salesforce", operation: "readiness", target_org: "ExampleOrg" },
      undefined,
      (u: unknown) => updates.push(u),
      { cwd: "/tmp" },
    );
    expect(result.details.card.title).toContain("ExampleOrg");
    expect(result.details.card.next[0]).toContain("operation='connect'");
    expect(result.details.targetOrg).toBe("ExampleOrg");
    expect(result.content[0].text).toContain("readiness");
    expect(updates.length).toBe(1);
    expect(typeof tool.renderResult).toBe("function");
  });
});

describe("no-op results", () => {
  it("shows an already-done change as a success card with no change", () => {
    const card = buildFinCard({
      text: "✅ Digital Experiences is already enabled. Nothing to do.",
      ok: true,
      details: { action: "salesforce", operation: "digital_experiences_enable", phase: "noop" },
    });
    expect(card.status).toBe("success");
    expect(card.title).toContain("Already done");
    expect(card.summary).not.toMatch(/^✅/u);
  });
});

describe("Fin-as-code depth cards", () => {
  it("renders an agent's chain with connector state and tokens, and the next step", () => {
    const card = buildFinCard({
      text: "Agent: …",
      ok: true,
      details: {
        action: "sdk",
        operation: "agent_status",
        phase: "status",
        procedure: { id: "4242", name: "Order status", state: "paused", unpublished: true },
        channels: ["fin_agent_api"],
        connectors: [{ id: "77", name: "Find order", state: "live", tokens: ["Example OAuth"] }],
        simulations: 4,
        next: "run sdk simulate procedure_id='4242'",
      },
    });
    const chain = card.sections?.find((s) => s.title === "Chain");
    expect(chain?.rows.map((r) => r.label)).toEqual(["channels", "procedure", "connector"]);
    expect(chain?.rows[2]?.value).toContain("🔑 Example OAuth");
    expect(card.next?.[0]).toContain("simulate");
    expect(card.status).toBe("success");
  });

  it("shows a connector_state plan as reversible with the exact Guardrail rule", () => {
    const card = buildFinCard({
      text: "Plan: set data connector \"Find order\" (77) draft → live through the public data connectors API.\nTo proceed, call sf_fin action='sdk' operation='connector_state' connector_id='77' state='live' allow_mutation=true (SF Guardrail mediates it).",
      ok: true,
      details: { action: "sdk", operation: "connector_state", phase: "plan" },
    });
    expect(card.chips?.map((c) => c.label)).toEqual(
      expect.arrayContaining(["↩ reversible", "🔒 native-sf-fin-procedure-state"]),
    );
    expect(card.next?.[0]).toContain("allow_mutation=true");
  });

  it("lists auth tokens with usage and connector runs with failures", () => {
    const tokens = buildFinCard({
      text: "x",
      ok: true,
      details: {
        action: "sdk",
        operation: "auth_tokens",
        tokens: [{ id: "11", name: "Example OAuth", type: "oauth", connectors: ["Lookup (77)"] }],
      },
    });
    expect(tokens.sections?.[0]?.rows[0]?.value).toContain("used by Lookup (77)");
    const logs = buildFinCard({
      text: "x",
      ok: true,
      details: {
        action: "sdk",
        operation: "connector_logs",
        connectorId: "77",
        hours: 24,
        failed: 1,
        runs: [
          { success: true, status: 200, ms: 100, source: "fin 4242", at: "t1" },
          {
            success: false,
            status: 500,
            ms: 80,
            source: "fin 4242",
            at: "t2",
            error: "http_error",
          },
        ],
      },
    });
    expect(logs.status).toBe("warning");
    expect(logs.chips?.map((c) => c.label)).toEqual(["1 ok", "1 failed"]);
  });
});
