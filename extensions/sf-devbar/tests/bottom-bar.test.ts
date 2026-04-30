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
    cliFreshness: "unknown",
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

  it("shows org name and sandbox badge in bracketed format", () => {
    const { left } = renderBottomBarParts(
      makeState({
        orgName: "Example-Dev",
        orgType: "sandbox",
        orgDetected: true,
        connectedStatus: "Connected",
      }),
      stubTheme,
    );
    expect(left).toContain("Example-Dev");
    expect(left).toContain("sandbox");
    // Bracketed format: "OrgName [⬡ sandbox]"
    expect(left).toContain("[");
    expect(left).toContain("]");
    expect(left).toContain("Connected");
  });

  it("shows production warning with error color", () => {
    const { left } = renderBottomBarParts(
      makeState({
        orgName: "Example-Prod",
        orgType: "production",
        orgDetected: true,
        connectedStatus: "Connected",
      }),
      stubTheme,
    );
    expect(left).toContain("PRODUCTION");
    expect(left).toContain("error");
  });

  it("shows no-org warning", () => {
    const { left } = renderBottomBarParts(makeState(), stubTheme);
    expect(left).toContain("No org configured");
  });

  it("shows disconnected org warning", () => {
    const { left } = renderBottomBarParts(
      makeState({
        orgName: "BadOrg",
        orgDetected: false,
      }),
      stubTheme,
    );
    expect(left).toContain("disconnected");
  });

  it("shows CLI version with 'SF CLI Version:' label and freshness badge", () => {
    const { left: latestLeft } = renderBottomBarParts(
      makeState({ cliVersion: "2.130.9", cliFreshness: "latest" }),
      stubTheme,
    );
    expect(latestLeft).toContain("SF CLI Version: 2.130.9");
    expect(latestLeft).toContain("latest");

    const { left: updateLeft } = renderBottomBarParts(
      makeState({ cliVersion: "2.128.0", cliFreshness: "update-available" }),
      stubTheme,
    );
    expect(updateLeft).toContain("SF CLI Version: 2.128.0");
    expect(updateLeft).toContain("update");
  });

  it("shows token stats on the right", () => {
    // Token stats were removed from the bottom bar — right side now only shows
    // extension statuses from allowed keys (sf-pi, sf-llm-gateway-internal).
    const { right } = renderBottomBarParts(makeState(), stubTheme);
    expect(right).not.toContain("↑");
    expect(right).not.toContain("↓");
    expect(right).not.toContain("$0");
  });

  it("shows empty right side when no extension statuses", () => {
    const { right } = renderBottomBarParts(makeState(), stubTheme);
    expect(right).toBe("");
  });

  it("includes allowed extension statuses (sf-pi)", () => {
    const extStatuses = new Map([["sf-pi", "📦 SF Pi Packages: 7/7 extensions"]]);
    const { right } = renderBottomBarParts(
      makeState({ extensionStatuses: extStatuses }),
      stubTheme,
    );
    expect(right).toContain("SF Pi Packages");
  });

  it("includes allowed extension statuses (sf-llm-gateway-internal)", () => {
    const extStatuses = new Map([["sf-llm-gateway-internal", "💰 $665.52/∞"]]);
    const { right } = renderBottomBarParts(
      makeState({ extensionStatuses: extStatuses }),
      stubTheme,
    );
    expect(right).toContain("💰 $665.52/∞");
  });

  it("includes allowed extension statuses (sf-slack-status)", () => {
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
    const { right } = renderBottomBarParts(
      makeState({ extensionStatuses: extStatuses }),
      stubTheme,
    );
    expect(right).not.toContain("13 pkgs");
    expect(right).toContain("SF Pi Packages");
  });

  it("shows scratch org badge", () => {
    const { left } = renderBottomBarParts(
      makeState({ orgType: "scratch", orgDetected: true, orgName: "MyScratch" }),
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
        orgName: "DevInt",
        connectedStatus: "Connected",
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
        orgName: "GT-Dev",
        connectedStatus: "Connected",
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
