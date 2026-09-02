/* SPDX-License-Identifier: Apache-2.0 */
import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { SfWelcomeHeader, SfWelcomeOverlay } from "../lib/splash-component.ts";
import { collectInitialSplashData } from "../lib/splash-data.ts";

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_SGR = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`);
const ANSI_TRUE_COLOR = new RegExp(`${ANSI_ESCAPE}\\[(?:38|48);2;`);

describe("SF Welcome terminal color behavior", () => {
  it("renders the overlay and persistent header without ANSI color escapes", () => {
    withNoColor(() => {
      const data = collectInitialSplashData("Example Model", "example-provider", 100);
      const overlay = new SfWelcomeOverlay(data).render(140).join("\n");
      const header = new SfWelcomeHeader(data).render(140).join("\n");

      expect(overlay).toContain("Welcome back!");
      expect(header).toContain("Press Esc to dismiss");
      expect(overlay).not.toMatch(ANSI_SGR);
      expect(header).not.toMatch(ANSI_SGR);
    });
  });

  it("removes raw truecolor while preserving indexed colors when Pi disables truecolor", () => {
    withTrueColor(false, () => {
      const data = collectInitialSplashData("Example Model", "example-provider", 100);
      const overlay = new SfWelcomeOverlay(data).render(140).join("\n");
      const header = new SfWelcomeHeader(data).render(140).join("\n");

      expect(overlay).toContain("Welcome back!");
      expect(header).toContain("Press Esc to dismiss");
      expect(`${overlay}\n${header}`).not.toMatch(ANSI_TRUE_COLOR);
      expect(`${overlay}\n${header}`).toContain(`${ANSI_ESCAPE}[38;5;`);
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
