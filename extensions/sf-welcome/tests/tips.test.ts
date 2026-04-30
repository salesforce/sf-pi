/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the welcome-screen tip builder.
 *
 * Tips are a public contract between the splash and the list of sf-pi
 * extensions. Adding a new curated tip should show up; disabling an
 * extension should hide its tip; unknown extensions should never leak.
 */
import { describe, it, expect } from "vitest";
import { buildTipsForActiveExtensions } from "../lib/tips.ts";
import type { ExtensionHealthItem } from "../lib/types.ts";

function health(name: string, status: ExtensionHealthItem["status"]): ExtensionHealthItem {
  return { name, status, icon: status === "active" ? "●" : status === "locked" ? "◆" : "○" };
}

describe("buildTipsForActiveExtensions", () => {
  it("returns only sf-pi extension tips, no generic Pi base tips", () => {
    // The splash intentionally drops `/`, `!`, `Shift+Tab` — those are Pi
    // built-ins the user learns elsewhere. Guard against someone wiring them
    // back in without revisiting the welcome screen design.
    const tips = buildTipsForActiveExtensions([
      health("Pi Manager", "locked"),
      health("Slack", "active"),
    ]);
    const cmds = tips.map((t) => t.command);
    expect(cmds).not.toContain("/");
    expect(cmds).not.toContain("!");
    expect(cmds).not.toContain("Shift+Tab");
    expect(cmds.every((c) => c.startsWith("/sf-"))).toBe(true);
  });

  it("adds tips for active and locked extensions", () => {
    const tips = buildTipsForActiveExtensions([
      health("Pi Manager", "locked"),
      health("Slack", "active"),
    ]);
    const cmds = tips.map((t) => t.command);
    expect(cmds).toContain("/sf-pi");
    expect(cmds).toContain("/sf-slack");
  });

  it("skips disabled extensions", () => {
    const tips = buildTipsForActiveExtensions([
      health("Pi Manager", "locked"),
      health("Slack", "disabled"),
    ]);
    const cmds = tips.map((t) => t.command);
    expect(cmds).toContain("/sf-pi");
    expect(cmds).not.toContain("/sf-slack");
  });

  it("returns an empty list when every extension is disabled", () => {
    const tips = buildTipsForActiveExtensions([
      health("Pi Manager", "disabled"),
      health("Slack", "disabled"),
    ]);
    expect(tips).toEqual([]);
  });

  it("ignores extensions without a curated tip", () => {
    // "Mystery Extension" isn't in EXTENSION_TIPS — it should be dropped.
    const tips = buildTipsForActiveExtensions([health("Mystery Extension", "active")]);
    expect(tips).toEqual([]);
  });
});
