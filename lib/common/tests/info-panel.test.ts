/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for shared info panel behavior. */
import { describe, expect, it, vi } from "vitest";
import { openInfoPanel } from "../info-panel.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

describe("openInfoPanel", () => {
  it("renders long content with scroll affordance and handles page down", async () => {
    let component: { render(width: number): string[]; handleInput(data: string): void } | undefined;
    const done = vi.fn();
    const ctx = {
      cwd: process.cwd(),
      hasUI: true,
      mode: "tui",
      ui: {
        custom: vi.fn(async (factory) => {
          component = factory({ terminal: { rows: 10 } }, theme, {}, done);
        }),
      },
    } as never;

    await openInfoPanel(ctx, {
      title: "Long help",
      body: Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join("\n"),
    });

    expect(component).toBeDefined();
    const first = component!.render(80).join("\n");
    expect(first).toContain("1-2/20");
    expect(first).toContain("Line 1");
    expect(first).not.toContain("Line 10");

    component!.handleInput("\x1b[6~"); // PageDown
    const second = component!.render(80).join("\n");
    expect(second).toContain("Line 2");
    expect(second).toContain("2-3/20");
  });
});
