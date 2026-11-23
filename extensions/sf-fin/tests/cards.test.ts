/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SF Fin Result Cards: every sf_fin result carries a human card in
 * `details.card` (rendered by renderResult) and a compact, secret-free model
 * packet in `content`. These tests pin the behaviors each card must keep;
 * card-render.test.ts checks the layout against real result shapes.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { buildFinCard, localTime, modelPacket, MODEL_PACKET_MAX_CHARS } from "../lib/cards.ts";
import { renderFinResult } from "../lib/render.ts";

const plain = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  bg: (_color: string, text: string) => text,
} as unknown as Theme;

function render(
  details: Record<string, unknown>,
  text = "model text",
  options: { expanded?: boolean; ok?: boolean } = {},
) {
  const ok = options.ok ?? details.ok !== false;
  const card = buildFinCard({ text, details, ok });
  const out = renderFinResult(
    { content: [{ type: "text", text }], details: { ...details, card } },
    { expanded: options.expanded === true, isPartial: false },
    plain,
  )
    .render(100)
    .join("\n");
  return { card, out };
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
    connected: false,
    checks: CHECKS,
  };

  it("counts what is left, groups checks into stages, and names the first fix plainly", () => {
    const { card, out } = render(details, "x");
    expect(card.status).toBe("warning");
    expect(out).toContain("2 items left before Fin can work cases in this org.");
    expect(out).toContain("2 of 4 checks pass");
    expect(out).toMatch(/✓ Package\s+›\s+○|⚠ Settings/u);
    expect(out).toContain("Turn on audit fields on record creation");
    expect(card.meta).toEqual(["ExampleOrg", "developer"]);
  });

  it("lists every open check with its glyph when collapsed and every check when expanded", () => {
    const collapsed = render(details, "x").out;
    expect(collapsed).toContain("Audit field setting is off");
    expect(collapsed).toContain("Fin is not connected");
    expect(collapsed).not.toContain("Fin user exists");
    expect(render(details, "x", { expanded: true }).out).toContain("Fin user exists");
  });

  it("is a success card with no fix when everything is ok", () => {
    const { card, out } = render(
      { ...details, ok: true, connected: true, checks: CHECKS.map((c) => ({ ...c, state: "ok" })) },
      "x",
      { ok: true },
    );
    expect(card.status).toBe("success");
    expect(out).toContain("4 of 4 checks pass");
    expect(out).toContain("Fin is connected and ready to work cases.");
  });

  it("is blocked only when a check is blocked", () => {
    const { card } = render(
      { ...details, checks: [...CHECKS, { id: "profile", state: "blocked", title: "No profile" }] },
      "x",
    );
    expect(card.status).toBe("error");
  });
});

describe("change plan and result cards", () => {
  it("shows a one-way plan with its Guardrail rule and plain approval", () => {
    const { card, out } = render(
      {
        action: "salesforce",
        operation: "digital_experiences_enable",
        phase: "plan",
        targetOrg: "ExampleOrg",
        oneWay: true,
      },
      "Plan: enable Digital Experiences in ExampleOrg (developer).\n- Deploy CommunitiesSettings with only enableNetworksEnabled=true.\n\nTo execute: sf_fin action='salesforce' operation='digital_experiences_enable' target_org='ExampleOrg' allow_mutation=true (SF Guardrail mediates it).",
    );
    expect(card.status).toBe("warning");
    expect(card.meta).toContain("plan · nothing changed yet");
    expect(out).toMatch(/One-way\s+Cannot be undone/u);
    expect(out).toContain("native-sf-fin-salesforce-setup");
    expect(out).toContain("Deploy CommunitiesSettings with only enableNetworksEnabled=true.");
    expect(out).toContain("ask the agent to apply it");
    expect(out).not.toContain("allow_mutation");
  });

  it("marks an org-wide plan and a reversible plan differently", () => {
    const orgWide = render(
      { action: "salesforce", operation: "enhanced_email_enable", phase: "plan" },
      "Plan: enable Enhanced Email.",
    ).out;
    expect(orgWide).toMatch(/Org-wide\s+Turn Enhanced Email off/u);
    const reversible = render(
      { action: "sdk", operation: "connector_state", phase: "plan" },
      'Plan: set data connector "Find order" (77) draft → live.',
    ).out;
    expect(reversible).toMatch(/Undo\s+Set the connector back to draft/u);
    expect(reversible).toContain("native-sf-fin-procedure-state");
  });

  it("shows a verified change as done and a failed one as not done", () => {
    const ok = render(
      {
        action: "salesforce",
        operation: "audit_fields_enable",
        phase: "execute",
        verified: true,
        targetOrg: "ExampleOrg",
      },
      "✅ enabled",
    );
    expect(ok.card.status).toBe("success");
    expect(ok.card.title).toBe("Turn on audit fields · done");
    const bad = render(
      { action: "salesforce", operation: "audit_fields_enable", phase: "execute" },
      "❌ did not verify",
      { ok: false },
    );
    expect(bad.card.status).toBe("error");
    expect(bad.card.title).toBe("Turn on audit fields · not done");
  });

  it("turns a tool-call next step into plain words", () => {
    const { out } = render(
      { action: "salesforce", operation: "package_install", phase: "execute", checks: CHECKS },
      "✅ Installed.\nNext: sf_fin action='salesforce' operation='permissions_apply' target_org='ExampleOrg'.",
    );
    expect(out).toContain("Create the Fin user and assign its permission sets.");
    expect(out).not.toContain("operation='");
  });

  it("shows an already-done change as a one-line success", () => {
    const { card, out } = render(
      { action: "salesforce", operation: "digital_experiences_enable", phase: "noop" },
      "✅ Digital Experiences is already enabled. Nothing to do.",
    );
    expect(card.status).toBe("success");
    expect(card.title).toBe("Already done · Turn on Digital Experiences");
    expect(out).not.toMatch(/✅ Digital/u);
  });
});

describe("procedure and simulation cards", () => {
  it("shows the procedure state, version, and round-trip check", () => {
    const { card, out } = render({
      action: "sdk",
      operation: "upload",
      phase: "upload",
      procedureId: "4242",
      savedState: "draft",
      savedVersion: "9",
      verified: true,
    });
    expect(card.meta).toEqual(["procedure 4242", "draft", "v9", "round-trip verified"]);
    expect(out).toContain("Nothing is live. Publishing is a separate step.");
  });

  it("lists validation problems by path", () => {
    const { card, out } = render(
      {
        action: "sdk",
        operation: "validate",
        phase: "validate",
        issues: [{ path: "steps[0].name", message: "is required" }],
      },
      "❌ 1 issue",
      { ok: false },
    );
    expect(card.title).toBe("1 problem to fix");
    expect(out).toMatch(/steps\[0\]\.name\s+is required/u);
  });

  it("lists each simulation with its failure reasons and the version tested", () => {
    const { card, out } = render(
      {
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
      "Simulations: 1/2 passed.",
      { ok: false },
    );
    expect(card.status).toBe("error");
    expect(card.meta).toEqual(["procedure 4242", "draft"]);
    expect(out).toContain("1 of 2 failed");
    expect(out).toMatch(/✓\s+Happy path/u);
    expect(out).toMatch(/✕\s+Not found\s*\n\s+outcome failed/u);
  });

  it("is a review while simulations are still running", () => {
    const { card, out } = render(
      {
        action: "sdk",
        operation: "simulate",
        phase: "result",
        passed: 1,
        total: 2,
        runs: [
          { runId: "r1", name: "A", status: "passed", passed: true },
          { runId: "r2", name: "B", status: "running" },
        ],
      },
      "Simulations: 1/2 passed · 1 still running.",
      { ok: false },
    );
    expect(card.status).toBe("warning");
    expect(out).toContain("1 of 2 passed, 1 still running");
  });
});

describe("Fin-as-code upload cards", () => {
  it("lists uploaded simulations and warns about duplicates", () => {
    const { card, out } = render(
      {
        action: "sdk",
        operation: "upload_simulations",
        phase: "upload",
        tests: [
          { id: "1", name: "Known case" },
          { id: "2", name: "Unknown case" },
          { id: "3", name: "Unknown case" },
        ],
        duplicates: ["Unknown case"],
      },
      "✅ Procedure 4242 now has 3 simulations.",
    );
    expect(card.status).toBe("warning");
    expect(card.title).toBe("3 simulations saved");
    expect(out).toMatch(/Known case\s+#1/u);
    expect(out).toContain("Unknown case appears more than once");
  });

  it("refuses duplicate simulations by name with the ids to add", () => {
    const { card, out } = render(
      {
        action: "sdk",
        operation: "upload_simulations",
        phase: "duplicates",
        matches: [{ name: "Known case", ids: ["1"] }],
      },
      "❌ Not uploaded: 1 test without an `id` already exists.",
      { ok: false },
    );
    expect(card.status).toBe("error");
    expect(card.title).toBe("Not uploaded · would add duplicates");
    expect(out).toMatch(/Known case\s+add id: 1/u);
  });

  it("shows uploaded guidance as paused and a connector as a draft, with the next step", () => {
    const guidance = render(
      {
        action: "sdk",
        operation: "upload",
        phase: "upload",
        kind: "guidance",
        id: "31",
        state: "paused",
      },
      '✅ Uploaded guidance "Clear tone" as 31 (paused — Fin does not use it yet).',
    );
    expect(guidance.card.title).toBe("Guidance uploaded · paused");
    expect(guidance.out).toContain("Set it live when you want Fin to use it");
    const connector = render(
      {
        action: "sdk",
        operation: "upload",
        phase: "upload",
        kind: "data_connector",
        id: "77",
        state: "draft",
      },
      '✅ Uploaded data connector "Find order" (77) as a draft.',
    );
    expect(connector.card.title).toBe("Data connector uploaded · draft");
    expect(connector.out).toContain("Drafts are not available to Fin");
  });

  it("explains unpublished changes on a live connector", () => {
    const { card, out } = render(
      {
        action: "sdk",
        operation: "upload",
        phase: "upload",
        kind: "data_connector",
        id: "77",
        state: "live",
        pending: true,
      },
      '✅ Uploaded data connector "Find order" (77): saved as unpublished changes on a live connector.',
    );
    expect(card.status).toBe("warning");
    expect(card.title).toBe("Data connector · unpublished changes");
    expect(out.replace(/\s+/gu, " ")).toContain('click "Set changes live"');
  });
});

describe("conversation card", () => {
  it("renders the turns as a chat and marks the run billable", () => {
    const { card, out } = render({
      action: "agent",
      operation: "run",
      phase: "run",
      conversationId: "sf-pi-x",
      status: "answered",
      transcript: [
        { role: "user", text: "Status of case 1024?" },
        { role: "fin", text: "Case 00001024 is New." },
      ],
    });
    expect(card.status).toBe("success");
    expect(card.meta).toContain("billable");
    expect(out).toMatch(/You\s+│ Status of case 1024\?/u);
    expect(out).toMatch(/Fin\s+│ Case 00001024 is New\./u);
  });

  it("fails the card on a missing expectation and shows citations and handoffs", () => {
    const { card, out } = render(
      {
        action: "agent",
        operation: "run",
        phase: "run",
        status: "answered",
        transcript: [
          { role: "user", text: "Talk to a human" },
          { role: "fin", text: "Connecting you to an agent now [1]." },
        ],
        signals: { citations: 1, handoff: true },
        expectations: {
          passed: false,
          results: [
            { expect: "agent", found: true },
            { expect: "refund", found: false },
          ],
        },
      },
      "⚠ Fin answered, but an expectation failed",
      { ok: false },
    );
    expect(card.status).toBe("error");
    expect(card.meta).toEqual(["1 of 2 expected", "billable"]);
    expect(out).toContain("📎 1 source cited  ·  🙋 handed to a person");
    expect(out).toMatch(/✓\s+"agent"/u);
    expect(out).toMatch(/✕\s+"refund"\s+not in Fin's reply/u);
  });

  it("is a review, not a failure, when Fin did not reply in time", () => {
    const { card, out } = render(
      { action: "agent", operation: "run", phase: "run", status: "timeout", transcript: [] },
      "Fin did not reply",
      { ok: false },
    );
    expect(card.status).toBe("warning");
    expect(out).toContain("Fin did not reply within the wait limit.");
  });
});

describe("agent status, tokens, and connector runs", () => {
  const status = {
    action: "sdk",
    operation: "agent_status",
    phase: "status",
    procedure: { id: "4242", name: "Order status", state: "paused", unpublished: true },
    channels: ["fin_agent_api"],
    connectors: [{ id: "77", name: "Find order", state: "live", tokens: ["Example OAuth"] }],
    simulations: 4,
  };

  it("draws the chain with each state and the token, and is a review while paused", () => {
    const { card, out } = render(status);
    expect(card.status).toBe("warning");
    expect(out).toMatch(/Channel .*Procedure .*Connector .*Token/u);
    expect(out).toMatch(/Fin Agent API\s+paused\s+live\s+signed in/u);
    expect(out).toMatch(/Signs in with\s+Example OAuth/u);
    expect(out).toContain("Run the 4 saved tests, then publish when you want it live.");
  });

  it("names the connector to fix first when one is not live", () => {
    const { out } = render({
      ...status,
      connectors: [{ id: "77", name: "Find order", state: "draft", tokens: [] }],
    });
    expect(out).toContain('Set the data connector "Find order" live');
  });

  it("lists tokens with what uses them, and never reads secrets", () => {
    const { out } = render({
      action: "sdk",
      operation: "auth_tokens",
      tokens: [
        { id: "11", name: "Example OAuth", type: "oauth", connectors: ["Lookup (77)"] },
        { id: "12", name: "Old key", connectors: [] },
      ],
    });
    expect(out).toContain("used by Lookup (77)");
    expect(out).toContain("not used by any connector");
    expect(out).toContain("1 unused");
    expect(out).toContain("Secret values are never read.");
  });

  it("counts connector runs and is a review when one failed", () => {
    const { card, out } = render({
      action: "sdk",
      operation: "connector_logs",
      connectorId: "77",
      hours: 24,
      failed: 1,
      runs: [
        { success: true, status: 200, ms: 100, source: "fin 4242", at: "2026-01-01T10:00:00Z" },
        {
          success: false,
          status: 500,
          ms: 80,
          source: "fin 4242",
          at: "2026-01-01T10:01:00Z",
          error: "http_error",
        },
      ],
    });
    expect(card.status).toBe("warning");
    expect(card.meta).toEqual(["#77", "last 24 hours"]);
    expect(out).toContain("1 of 2 succeeded");
    expect(out).toMatch(/✕ .*500 .*http_error .*called by procedure 4242/u);
  });
});

describe("local time", () => {
  const now = new Date("2026-03-11T12:00:00Z");
  it("shows weekday and time within a week, the date beyond it, and nothing for bad input", () => {
    expect(localTime("2026-03-10T12:00:00Z", now)).toMatch(/^[A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M$/u);
    expect(localTime("2026-01-02T12:00:00.000+0000", now)).toMatch(/^Jan \d{1,2}$/u);
    expect(localTime("2025-01-02T12:00:00Z", now)).toMatch(/^Jan \d{1,2}, 2025$/u);
    expect(localTime("not a date", now)).toBeUndefined();
    expect(localTime(undefined, now)).toBeUndefined();
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
    const fallback = renderFinResult(
      { content: [{ type: "text", text: "fallback text" }], details: { action: "status" } },
      { expanded: false, isPartial: false },
      plain,
    )
      .render(80)
      .join("\n");
    expect(fallback).toContain("fallback text");
    const partial = renderFinResult(
      {
        content: [{ type: "text", text: "Installing package…" }],
        details: { progress: { phase: "package_install", current: "Installing package…" } },
      },
      { expanded: false, isPartial: true },
      plain,
    )
      .render(80)
      .join("\n");
    expect(partial).toContain("Installing package…");
  });

  it("gives an unknown result a card from its first line, without numbered rows", () => {
    const { card, out } = render(
      { action: "sdk", operation: "download", phase: "download" },
      "✅ Downloaded 12 files.\nSaved under the SF Fin state folder.",
    );
    expect(card.title).toBe("Sdk · download");
    expect(out).toContain("Downloaded 12 files.");
    expect(out).not.toMatch(/^\s+1\s{2,}\S.*\n\s+2\s{2,}\S/mu);
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
    expect(result.details.card.meta).toContain("ExampleOrg");
    expect(result.details.card.next).toContain("Connect Fin to this org");
    expect(result.details.targetOrg).toBe("ExampleOrg");
    // The model still gets the operation's own text, unchanged.
    expect(result.content[0].text).toContain("readiness — ExampleOrg");
    expect(updates.length).toBe(1);
    expect(typeof tool.renderResult).toBe("function");
  });
});
