/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Guardrail Manager settings panel interaction. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
const theme: Theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;
const tui = { terminal: { rows: 40, cols: 120 }, requestRender: vi.fn() } as never;

let tmpDir: string;
let prevAgentDir: string | undefined;

beforeEach(() => {
  vi.resetModules();
  tmpDir = mkdtempSync(path.join(tmpdir(), "sf-guardrail-config-panel-"));
  prevAgentDir = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (prevAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgentDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("SF Guardrail config panel", () => {
  it("edits protected aliases with a native input page", async () => {
    const [{ createConfigPanel }, preferences] = await Promise.all([
      import("../lib/config-panel.ts"),
      import("../lib/preferences.ts"),
    ]);
    const panel = createConfigPanel(theme, "/tmp/project", "global", vi.fn(), tui) as unknown as {
      handleInput(data: string): void;
      renderContent(width: number): string[];
    };

    // Move to Protected org aliases and open it.
    panel.handleInput("\u001b[B");
    panel.handleInput("\u001b[B");
    panel.handleInput("\u001b[B");
    panel.handleInput("\r");
    panel.handleInput("e");

    expect(panel.renderContent(120).join("\n")).toContain("Enter save aliases");
    for (const char of "Prod, FullCopy") panel.handleInput(char);
    panel.handleInput("\r");

    expect(
      preferences.productionAliasesText((await import("../lib/config.ts")).loadConfig().config),
    ).toBe("Prod, FullCopy");
    expect(panel.renderContent(120).join("\n")).toContain("Protected org aliases saved");
  });
});
