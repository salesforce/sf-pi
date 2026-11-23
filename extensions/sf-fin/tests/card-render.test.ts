/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SF Fin flat Result Cards, rendered from real result shapes.
 *
 * `fixtures/card-results.json` holds sanitized `{ text, details }` pairs that
 * the live sf_fin tool returned. Each test builds the card the way the tool
 * does (buildFinCard) and renders it the way Pi does (renderFinResult), then
 * checks what a person sees: the answer first, honest status, plain words,
 * and no generic numbered-row fallback.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { buildFinCard } from "../lib/cards.ts";
import { renderFinResult } from "../lib/render.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(
  readFileSync(path.join(here, "fixtures", "card-results.json"), "utf8"),
) as Record<string, { ok: boolean; text: string; details: Record<string, unknown> }>;

/** Plain theme: colors become nothing, so the text a person reads is what is tested. */
const plain = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  bg: (_color: string, text: string) => text,
} as unknown as Theme;

function view(name: string, options: { expanded?: boolean; width?: number } = {}) {
  const fixture = FIXTURES[name];
  if (!fixture) throw new Error(`no fixture ${name}`);
  const card = buildFinCard({ text: fixture.text, ok: fixture.ok, details: fixture.details });
  const lines = renderFinResult(
    { content: [{ type: "text", text: fixture.text }], details: { ...fixture.details, card } },
    { expanded: options.expanded === true, isPartial: false },
    plain,
  ).render(options.width ?? 92);
  const text = lines.join("\n");
  // The card starts with one blank row under Pi's call line; `head` is the status headline.
  const head = lines.find((l) => l.trim()) ?? "";
  return { card, lines, head, text, rows: lines.filter((l) => l.trim()).length };
}

describe("flat Fin Result Cards", () => {
  it("draws no inner box: the card sits on Pi's own tool tile", () => {
    const fixture = FIXTURES.observe!;
    const card = buildFinCard({ text: fixture.text, ok: true, details: fixture.details });
    const painted: string[] = [];
    const recording = {
      ...plain,
      bg: (color: string, text: string) => {
        painted.push(color);
        return text;
      },
    } as unknown as Theme;
    renderFinResult(
      { content: [{ type: "text", text: fixture.text }], details: { ...fixture.details, card } },
      { expanded: false, isPartial: false },
      recording,
    ).render(92);
    expect(painted).toEqual([]);
  });

  it("drops the Summary / Scope / Execution scaffolding on every card", () => {
    for (const name of Object.keys(FIXTURES)) {
      const { lines } = view(name);
      const headings = lines.map((l) => l.trim());
      expect(headings, name).not.toContain("Summary");
      expect(headings, name).not.toContain("Scope");
      expect(headings, name).not.toContain("Execution");
    }
  });

  it("fits every line at 92, 60, and 40 columns, collapsed and expanded", () => {
    for (const name of Object.keys(FIXTURES)) {
      for (const width of [92, 60, 40]) {
        for (const expanded of [false, true]) {
          const { lines } = view(name, { width, expanded });
          for (const line of lines) {
            expect(visibleWidth(line), `${name} @${width}${expanded ? " expanded" : ""}`).toBe(
              width,
            );
          }
        }
      }
    }
  });

  it("never falls back to numbered rows for a known result", () => {
    for (const name of Object.keys(FIXTURES)) {
      const { card, text } = view(name, { expanded: true });
      expect(
        (card.blocks ?? []).some(
          (b) => b.kind === "rows" && b.title === "Details" && !b.expandedOnly,
        ),
        name,
      ).toBe(false);
      // The old generic card numbered every text line: "1", "2", "3" in a column.
      expect(text, name).not.toMatch(/^\s+1\s{2,}\S.*\n\s+2\s{2,}\S.*\n\s+3\s{2,}\S/mu);
    }
  });
});

describe("readiness", () => {
  it("answers first, counts the checks, and lists only what needs you when collapsed", () => {
    const { head, text, rows } = view("readiness");
    expect(head).toMatch(/⚠ .*Fin for Salesforce · ExampleOrg/u);
    expect(text).toContain("Fin is connected and cases reach it.");
    expect(text).toContain("17 of 18 checks pass");
    expect(text).toMatch(
      /✓ Package\s+›\s+⚠ Settings\s+›\s+✓ Access\s+›\s+✓ Routing\s+›\s+✓ Connection/u,
    );
    expect(text).toContain("Needs you");
    expect(text).toContain("Email-to-Case");
    // Passing checks and the go-live paragraph stay out of the collapsed card.
    expect(text).not.toContain("Fin Case fields present");
    expect(text).not.toContain("Before go-live:");
    expect(text).not.toMatch(/…$/mu);
    expect(rows).toBeLessThanOrEqual(14);
  });

  it("shows every check, grouped with counts, when expanded", () => {
    const { text } = view("readiness", { expanded: true });
    expect(text).toMatch(/Package\s+3\/3/u);
    expect(text).toMatch(/Settings\s+3\/4/u);
    expect(text).toContain("Fin Case fields present");
    expect(text).toContain("Fin user fin_agent@example.ext exists");
  });
});

describe("observe", () => {
  it("leads with four numbers and names Fin's outcomes in plain words", () => {
    const { text } = view("observe");
    expect(text).toMatch(/100% resolved/u);
    expect(text).toMatch(/2 cases worked/u);
    expect(text).toMatch(/0 handed to a person/u);
    expect(text).toMatch(/3 assigned to Fin now/u);
    expect(text).toContain("Answered, no follow-up");
    expect(text).toContain("Customer confirmed");
    expect(text).toContain("Handed to your team");
    expect(text).toContain("Customer left");
    expect(text).not.toContain("Soft Resolution");
    expect(text).toMatch(/00001460 .*New .*answered .*Password reset/u);
    expect(text).toMatch(/00001459 .*no Fin result/u);
  });

  it("keeps Fin's own field value in the expanded view", () => {
    expect(view("observe", { expanded: true }).text).toContain("Soft Resolution");
  });
});

describe("agent status", () => {
  it("is a review, not a success, while the procedure is paused, and draws the chain", () => {
    const { card, text } = view("agent_status");
    expect(card.status).toBe("warning");
    expect(text).toMatch(/Paused\. Fin isn't using this procedure\./u);
    expect(text).toMatch(/Channel .*Procedure .*Connector .*Token/u);
    expect(text).toContain("7 simulations saved");
    expect(text).not.toContain("procedure_id='");
  });

  it("is a success once the procedure and every connector are live", () => {
    const fixture = FIXTURES.agent_status!;
    const details = {
      ...fixture.details,
      procedure: { ...(fixture.details.procedure as object), state: "live" },
    };
    expect(buildFinCard({ text: fixture.text, ok: true, details }).status).toBe("success");
  });
});

describe("plans and no-ops", () => {
  it("shows a publish plan as a state change with what happens, undo, and approval", () => {
    const { head, text } = view("plan.publish");
    expect(head).toContain("plan · nothing changed yet");
    expect(text).toMatch(/paused\s+──→\s+● live/u);
    expect(text).toMatch(/What happens\s+Fin will start using it/u);
    expect(text).toMatch(/Undo\s+/u);
    expect(text).toMatch(/Approval\s+SF Guardrail asks you first/u);
    expect(text).toContain("native-sf-fin-procedure-state");
    expect(text).toContain("/sf-fin sdk publish 4242");
    expect(text).not.toContain("allow_mutation");
  });

  it("shows an already-done change in one line", () => {
    const { head, rows } = view("plan.handoff");
    expect(head).toMatch(/✓ .*Already done · Handoff queue/u);
    expect(rows).toBeLessThanOrEqual(3);
  });
});

describe("doctor, status, and setup", () => {
  it("doctor is a ready card with a grid of checks, not numbered rows", () => {
    const { card, head, text, rows } = view("doctor");
    expect(card.status).toBe("success");
    expect(head).toMatch(/✓ .*SF Fin is ready · Example Workspace/u);
    expect(text).toMatch(/✓ Node 26\.13\.1/u);
    expect(text).toMatch(/✓ Fin CLI 0\.16\.4/u);
    expect(text).toMatch(/✓ Workspace reachable/u);
    expect(rows).toBeLessThanOrEqual(8);
  });

  it("status shows labeled rows with local times and says it is cached", () => {
    const { head, text } = view("status");
    expect(head).toContain("cached, no network");
    expect(text).not.toContain("# SF Fin status");
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/u);
    expect(text).toMatch(/Signed in\s+Example Admin/u);
  });

  it("setup counts capabilities and is a review, not blocked, when only one is missing", () => {
    const { card, text } = view("setup");
    expect(card.status).toBe("warning");
    expect(text).toContain("2 of 3 ready.");
    expect(text).toMatch(/○\s+Fin Operator\s+read data through the Intercom MCP/u);
    expect(text).toContain("/mcp login intercom");
    expect(text).not.toContain("|");
  });
});

describe("runs, tokens, manifest, and errors", () => {
  it("connector runs show a success count and average time", () => {
    const { text } = view("connector_logs");
    expect(text).toMatch(/4 of 4 succeeded/u);
    expect(text).toMatch(/avg 257ms/u);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/u);
  });

  it("an error card names the problem and one recovery step", () => {
    const { card, head, text } = view("agent_status.bad");
    expect(card.status).toBe("error");
    expect(head).toMatch(/✕ .*Procedure not found/u);
    expect(text).toContain("/sf-fin sdk manifest");
  });

  it("a refused change says why in an error card", () => {
    const { card, head, text } = view("plan.connector_state");
    expect(card.status).toBe("error");
    expect(head).toMatch(/✕ .*Data connector · not done/u);
    expect(text).toContain("no request URL");
  });

  it("simulations and conversations are failures, not blocks, and read plainly", () => {
    const sim = view("simulate");
    expect(sim.card.status).toBe("error");
    expect(sim.text).toContain("1 of 2 failed");
    expect(sim.text).toMatch(/✕\s+Not found\s*\n\s+outcome failed/u);
    expect(sim.text).not.toContain("Blocked");
    const chat = view("agent.run");
    expect(chat.head).toMatch(/✕ .*Fin conversation · 1 of 2 expected · billable/u);
    expect(chat.text).toMatch(/You\s+│ Talk to a human/u);
    expect(chat.text).toMatch(/Fin\s+│ Connecting you to an agent now/u);
    expect(chat.text).toContain("📎 1 source cited  ·  🙋 handed to a person");
    expect(chat.text).toMatch(/✕\s+"refund"\s+not in Fin's reply/u);
    expect(chat.text).not.toContain("Blocked");
  });

  it("an admin page read shows the page's headings and cells, not raw accessibility roles", () => {
    const { card, head, text, rows } = view("admin.read");
    expect(card.status).toBe("info");
    expect(head).toMatch(/ⓘ .*Data connectors · workspace default · masked/u);
    expect(text).not.toMatch(/\b(button|cell|combobox|heading|link) "/u);
    expect(text).toContain("Get Salesforce case status");
    expect(rows).toBeLessThanOrEqual(14);
  });

  it("an error-log read groups errors by code with the fix", () => {
    const { head, text } = view("admin.read.error-logs");
    expect(head).toMatch(/⚠ .*Fin error logs · 4 errors/u);
    expect(text).toMatch(/FIELD_CUSTOM_VALIDATION_EXCEPTION on Case\s+×4/u);
    expect(text).toContain("System error text can hold record data");
  });

  it("an SDK download counts files by folder instead of listing every file", () => {
    const { head, text, rows } = view("sdk.download");
    expect(head).toMatch(/✓ .*Fin SDK downloaded · 79 files/u);
    expect(text).toMatch(/\.claude\/skills\s+\d+ files/u);
    expect(text).not.toContain("attribute-upload-format.md");
    expect(rows).toBeLessThanOrEqual(12);
  });

  it("an agent with no connectors shows only the parts it has", () => {
    const { text } = view("agent_status.draft");
    expect(text).toMatch(/Paused, with unpublished draft changes\.|Paused\. Fin isn't using/u);
    expect(text).toMatch(/Channel .*Procedure/u);
    expect(text).not.toContain("Connector");
    expect(text).toContain("Web, iOS, Android");
  });

  it("a multi-step plan numbers its steps and keeps the Guardrail rule", () => {
    const { text } = view("plan.permissions");
    expect(text).toMatch(/1\.\s+Deploy permission set SF_Fin_Salesforce_Access/u);
    expect(text).toContain("native-sf-fin-salesforce-setup");
  });

  it("surfaces, workspaces, admin pages, install, and access each get their own card", () => {
    expect(view("surfaces").text).toMatch(/344 CLI commands · 19 MCP tools/u);
    expect(view("workspace.list").text).toMatch(/▶\s+default/u);
    expect(view("admin.pages").text).toMatch(/error-logs/u);
    expect(view("install.plan").head).toMatch(/✓ .*Fin CLI 0\.16\.4 is installed/u);
    expect(view("agent.access").head).toMatch(/✓ .*Fin Agent API access granted/u);
  });
});
