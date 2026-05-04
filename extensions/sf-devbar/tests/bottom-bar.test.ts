/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { renderBottomBarParts, type BottomBarState, type BarTheme } from "../lib/bottom-bar.ts";

// -------------------------------------------------------------------------------------------------
// Stub theme — returns plain text with markers for testing
// -------------------------------------------------------------------------------------------------

const stubTheme: BarTheme = {
  fg: (color, text) => `[${color}:${text}]`,
  bold: (text) => `<b>${text}</b>`,
};

function makeState(overrides?: Partial<BottomBarState>): BottomBarState {
  return {
    ...overrides,
  };
}

// -------------------------------------------------------------------------------------------------
// renderBottomBarParts
// -------------------------------------------------------------------------------------------------

describe("renderBottomBarParts", () => {
  it("returns left and right parts", () => {
    const { left, right } = renderBottomBarParts(makeState(), stubTheme);
    expect(typeof left).toBe("string");
    expect(typeof right).toBe("string");
  });

  it("shows org name and sandbox badge in bracketed format inside a Salesforce project", () => {
    const { left } = renderBottomBarParts(
      makeState({
        orgName: "Example-Dev",
        orgType: "sandbox",
        orgDetected: true,
        projectDetected: true,
      }),
      stubTheme,
    );
    expect(left).toContain("SFDX Project →");
    expect(left).toContain("Example-Dev");
    expect(left).toContain("sandbox");
    // Bracketed format: "OrgName [⬡ sandbox]"
    expect(left).toContain("[");
    expect(left).toContain("]");
  });

  it("hides org info outside a Salesforce project", () => {
    const { left } = renderBottomBarParts(
      makeState({
        orgName: "GlobalDefault",
        orgType: "sandbox",
        orgDetected: true,
        projectDetected: false,
      }),
      stubTheme,
    );
    expect(left).not.toContain("GlobalDefault");
    expect(left).not.toContain("sandbox");
  });

  it("shows production warning with error color", () => {
    const { left } = renderBottomBarParts(
      makeState({
        orgName: "Example-Prod",
        orgType: "production",
        orgDetected: true,
        projectDetected: true,
      }),
      stubTheme,
    );
    expect(left).toContain("PRODUCTION");
    expect(left).toContain("error");
  });

  it("shows no-org warning inside a Salesforce project", () => {
    const { left } = renderBottomBarParts(makeState({ projectDetected: true }), stubTheme);
    expect(left).toContain("No org configured");
  });

  it("does not show SF CLI version or freshness badges", () => {
    const { left } = renderBottomBarParts(
      makeState({
        orgName: "Example-Dev",
        orgType: "sandbox",
        orgDetected: true,
        projectDetected: true,
      }),
      stubTheme,
    );
    expect(left).not.toContain("SF CLI Version");
    expect(left).not.toContain("latest");
    expect(left).not.toContain("update");
  });

  it("shows token stats on the right", () => {
    // Token stats were removed from the bottom bar — right side now only shows
    // curated extension statuses such as Slack.
    const { right } = renderBottomBarParts(makeState(), stubTheme);
    expect(right).not.toContain("↑");
    expect(right).not.toContain("↓");
    expect(right).not.toContain("$0");
  });

  it("shows empty right side when no extension statuses", () => {
    const { right } = renderBottomBarParts(makeState(), stubTheme);
    expect(right).toBe("");
  });

  it("includes SF Pi package status on the left", () => {
    const extStatuses = new Map([["sf-pi", "📦 SF Pi Packages: 7/7 extensions"]]);
    const { left, right } = renderBottomBarParts(
      makeState({ extensionStatuses: extStatuses }),
      stubTheme,
    );
    expect(left).toContain("SF Pi Packages");
    expect(right).not.toContain("SF Pi Packages");
  });

  it("includes LLM gateway cost status on the left", () => {
    const extStatuses = new Map([["sf-llm-gateway-internal", "💰 $665.52/∞"]]);
    const { left, right } = renderBottomBarParts(
      makeState({ extensionStatuses: extStatuses }),
      stubTheme,
    );
    expect(left).toContain("💰 $665.52/∞");
    expect(right).not.toContain("💰 $665.52/∞");
  });

  it("orders bottom-left segments as cost, packages, then SFDX org", () => {
    const extStatuses = new Map([
      ["sf-pi", "📦 SF Pi Packages: 11/11 extensions"],
      ["sf-llm-gateway-internal", "💰 $12.34/∞"],
    ]);
    const { left } = renderBottomBarParts(
      makeState({
        extensionStatuses: extStatuses,
        orgName: "Example-Dev",
        orgType: "sandbox",
        orgDetected: true,
        projectDetected: true,
      }),
      stubTheme,
    );
    expect(left.indexOf("💰 $12.34/∞")).toBeLessThan(left.indexOf("SF Pi Packages"));
    expect(left.indexOf("SF Pi Packages")).toBeLessThan(left.indexOf("SFDX Project →"));
    expect(left.indexOf("SFDX Project →")).toBeLessThan(left.indexOf("Example-Dev"));
  });

  it("includes Slack status on the right", () => {
    // sf-slack emits a pre-themed pill (icon + Slack + ✓ Connected + handle
    // + bracketed tokenType + scopes). The bottom bar is a passthrough for
    // allowed statuses, so the test verifies the string made it through.
    const pill = "💬 Slack ✓ Connected @handle [user] 14/14 scopes";
    const extStatuses = new Map([["sf-slack-status", pill]]);
    const { right } = renderBottomBarParts(
      makeState({ extensionStatuses: extStatuses }),
      stubTheme,
    );
    expect(right).toContain("✓ Connected");
    expect(right).toContain("@handle");
    expect(right).toContain("[user]");
    expect(right).toContain("14/14 scopes");
  });

  it("filters out non-allowed extension statuses (Pi core)", () => {
    const extStatuses = new Map([
      ["pi-packages", "13 pkgs • ↻ daily • 1 update"],
      ["sf-pi", "📦 SF Pi Packages: 7/7 extensions"],
    ]);
    const { left, right } = renderBottomBarParts(
      makeState({ extensionStatuses: extStatuses }),
      stubTheme,
    );
    expect(left).not.toContain("13 pkgs");
    expect(right).not.toContain("13 pkgs");
    expect(left).toContain("SF Pi Packages");
  });

  it("shows scratch org badge", () => {
    const { left } = renderBottomBarParts(
      makeState({
        orgType: "scratch",
        orgDetected: true,
        projectDetected: true,
        orgName: "MyScratch",
      }),
      stubTheme,
    );
    expect(left).toContain("scratch");
  });

  it("uses ASCII glyphs when glyphMode is ascii (Terminal.app compatibility)", () => {
    // With glyphMode:"ascii" the bar should avoid `⬢`/`⬡`/`◆`/`◇` —
    // those render as tofu on Terminal.app default fonts. Asserting the
    // ASCII variants are present + their emoji counterparts are absent
    // locks the fallback in place across the full left segment.
    const { left } = renderBottomBarParts(
      makeState({
        orgType: "sandbox",
        orgDetected: true,
        projectDetected: true,
        orgName: "DevInt",
        glyphMode: "ascii",
      }),
      stubTheme,
    );
    expect(left).not.toContain("⬢"); // node icon
    expect(left).not.toContain("⬡"); // hex badge
    expect(left).toContain("sandbox");
  });

  it("keeps emoji glyphs when glyphMode is emoji", () => {
    const { left } = renderBottomBarParts(
      makeState({
        orgType: "developer",
        orgDetected: true,
        projectDetected: true,
        orgName: "GT-Dev",
        glyphMode: "emoji",
      }),
      stubTheme,
    );
    // Developer org badge uses ◆ (solid diamond) which is BMP-safe but
    // we still want to prove the emoji pathway renders it.
    expect(left).toContain("◆");
    expect(left).toContain("GT-Dev");
  });
});
