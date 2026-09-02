/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { renderBottomBarParts } from "../lib/bottom-bar.ts";
import { createConfigPanel } from "../lib/config-panel.ts";
import { renderTopBar } from "../lib/top-bar.ts";

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_SGR = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`);
const ANSI_TRUE_COLOR = new RegExp(`${ANSI_ESCAPE}\\[(?:38|48);2;`);
const ansiTheme = {
  fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};

describe("SF DevBar terminal color behavior", () => {
  it("renders top and bottom bars without theme, raw, or upstream ANSI colors", () => {
    withNoColor(() => {
      const [top] = renderTopBar(
        {
          folderName: "example-project",
          modelProvider: "sf-llm-gateway",
          modelName: "Example Model",
          thinkingLevel: "xhigh",
          contextPercent: 42,
          gitBranch: "main",
        },
        ansiTheme,
      );
      const { left, right } = renderBottomBarParts(
        {
          projectDetected: true,
          orgDetected: true,
          orgName: "ExampleOrg",
          orgType: "sandbox",
          extensionStatuses: new Map([
            ["sf-llm-gateway", "\x1b[35mGateway healthy\x1b[0m"],
            ["sf-slack-status", "\x1b[36mSlack connected\x1b[0m"],
          ]),
        },
        ansiTheme,
      );

      expect(top).toContain("Example Model");
      expect(left).toContain("ExampleOrg");
      expect(right).toContain("Slack connected");
      expect(top).not.toMatch(ANSI_SGR);
      expect(left).not.toMatch(ANSI_SGR);
      expect(right).not.toMatch(ANSI_SGR);
    });
  });

  it("renders its color settings page without ANSI styling", () => {
    withNoColor(() => {
      const cwd = mkdtempSync(path.join(tmpdir(), "sf-devbar-no-color-"));
      try {
        const panel = createConfigPanel(
          ansiTheme as unknown as Theme,
          cwd,
          "project",
          () => undefined,
        ) as unknown as { renderContent(width: number): string[] };
        const rendered = panel.renderContent(100).join("\n");

        expect(rendered).toContain("SF Pi › SF DevBar › Color Settings");
        expect(rendered).not.toMatch(ANSI_SGR);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  });

  it("removes raw truecolor from DevBar surfaces when Pi disables it", () => {
    withTrueColor(false, () => {
      const [top] = renderTopBar(
        {
          folderName: "example-project",
          modelProvider: "sf-llm-gateway",
          modelName: "Example Model",
          thinkingLevel: "xhigh",
          contextPercent: 42,
        },
        ansiTheme,
      );
      const { left } = renderBottomBarParts(
        {
          projectDetected: true,
          orgName: "ExampleOrg",
          orgType: "sandbox",
        },
        ansiTheme,
      );
      const cwd = mkdtempSync(path.join(tmpdir(), "sf-devbar-no-truecolor-"));
      try {
        const panel = createConfigPanel(
          ansiTheme as unknown as Theme,
          cwd,
          "project",
          () => undefined,
        ) as unknown as { renderContent(width: number): string[] };
        const settings = panel.renderContent(100).join("\n");

        expect(top).toContain("Example Model");
        expect(left).toContain("ExampleOrg");
        expect(settings).toContain("SF Pi › SF DevBar › Color Settings");
        expect(`${top}\n${left}\n${settings}`).not.toMatch(ANSI_TRUE_COLOR);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  });
});

function withNoColor(work: () => void): void {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    work();
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
}

function withTrueColor(enabled: boolean, work: () => void): void {
  const prior = getCapabilities();
  setCapabilities({ ...prior, trueColor: enabled });
  try {
    work();
  } finally {
    setCapabilities(prior);
  }
}
