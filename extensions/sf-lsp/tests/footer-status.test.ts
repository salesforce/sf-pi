/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the footer status renderer with a stub theme that returns
 * markers we can assert on.
 */
import { describe, it, expect } from "vitest";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { createActivityStore, recordCheck, seedFromDoctor } from "../lib/activity.ts";
import { formatFooterStatus } from "../lib/footer-status.ts";
import type { LspDiagnostic } from "../lib/types.ts";

function stubTheme(): Theme {
  return {
    fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => `*${text}*`,
    italic: (text: string) => text,
    strikethrough: (text: string) => text,
  } as unknown as Theme;
}

function errorDiag(line = 1): LspDiagnostic {
  return {
    severity: 1,
    message: "x",
    range: { start: { line, character: 0 }, end: { line, character: 1 } },
  };
}

describe("formatFooterStatus", () => {
  it("renders LSP prefix + three dim dots on a fresh store", () => {
    const store = createActivityStore();
    const output = formatFooterStatus(store, stubTheme());
    expect(output).toContain("<muted>LSP:</muted>");
    // idle dots are dim
    const dimCount = (output.match(/<dim>·<\/dim>/g) ?? []).length;
    expect(dimCount).toBe(3);
  });

  it("renders success dot for clean Apex", () => {
    const store = createActivityStore();
    recordCheck(store, {
      language: "apex",
      filePath: "/p/Foo.cls",
      startedAt: 0,
      finishedAt: 10,
      diagnostics: [],
      previousFileStatus: undefined,
    });
    const output = formatFooterStatus(store, stubTheme());
    expect(output).toMatch(/<success>●<\/success>/);
  });

  it("renders error dot when Apex has errors and warning for unavailable LWC", () => {
    const store = createActivityStore();
    recordCheck(store, {
      language: "apex",
      filePath: "/p/Foo.cls",
      startedAt: 0,
      finishedAt: 10,
      diagnostics: [errorDiag()],
      previousFileStatus: undefined,
    });
    seedFromDoctor(store, [
      { language: "apex", available: true, detail: "ok" },
      { language: "lwc", available: false, detail: "missing" },
      { language: "agentscript", available: true, detail: "ok" },
    ]);
    const output = formatFooterStatus(store, stubTheme());
    expect(output).toMatch(/<error>●<\/error>/);
    expect(output).toMatch(/<warning>○<\/warning>/);
  });

  it("includes the Apex·LWC·AS language tail", () => {
    const store = createActivityStore();
    const output = formatFooterStatus(store, stubTheme());
    expect(output).toContain("<dim> Apex·LWC·AS</dim>");
  });
});
