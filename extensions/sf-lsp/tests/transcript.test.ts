/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the transcript emission policy.
 */
import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
  createTranscriptRenderer,
  emitTranscriptRow,
  shouldEmitTranscriptRow,
  LSP_TRANSCRIPT_CUSTOM_TYPE,
  type LspTranscriptEntry,
} from "../lib/transcript.ts";

describe("emitTranscriptRow", () => {
  it("persists a human-only transcript entry instead of sending a model-visible custom message", () => {
    const pi = {
      appendEntry: vi.fn(),
      sendMessage: vi.fn(),
    } as unknown as ExtensionAPI;

    emitTranscriptRow(pi, {
      language: "apex",
      fileName: "MyClass.cls",
      status: "error",
      diagnosticCount: 2,
      durationMs: 42,
    });

    expect(pi.appendEntry).toHaveBeenCalledWith(LSP_TRANSCRIPT_CUSTOM_TYPE, {
      content: "Apex · MyClass.cls · 2 errors",
      details: {
        language: "apex",
        fileName: "MyClass.cls",
        status: "error",
        diagnosticCount: 2,
        durationMs: 42,
      },
    });
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });
});

describe("createTranscriptRenderer", () => {
  it("renders the persisted human-only entry", () => {
    const renderer = createTranscriptRenderer();
    const component = renderer(
      {
        type: "custom",
        id: "entry-1",
        parentId: null,
        timestamp: new Date(0).toISOString(),
        customType: LSP_TRANSCRIPT_CUSTOM_TYPE,
        data: {
          content: "Apex · MyClass.cls · 1 error",
          details: {
            language: "apex",
            fileName: "MyClass.cls",
            status: "error",
            diagnosticCount: 1,
            previewLines: ["L3: Unexpected token"],
          },
        } satisfies LspTranscriptEntry,
      },
      { expanded: true },
      passthroughTheme,
    );

    const rendered = component?.render(120).join("\n") ?? "";
    expect(rendered).toContain("[sf-lsp]");
    expect(rendered).toContain("Apex · MyClass.cls · 1 error");
    expect(rendered).toContain("L3: Unexpected token");
  });
});

const passthroughTheme = {
  fg: (_color: string, value: string) => value,
  bg: (_color: string, value: string) => value,
} as Theme;

describe("shouldEmitTranscriptRow", () => {
  it("balanced: emits on error", () => {
    expect(shouldEmitTranscriptRow("error", "balanced", false)).toBe(true);
  });

  it("balanced: emits on error->clean transition", () => {
    expect(shouldEmitTranscriptRow("transition-clean", "balanced", false)).toBe(true);
  });

  it("balanced: stays silent on plain clean", () => {
    expect(shouldEmitTranscriptRow("clean", "balanced", false)).toBe(false);
  });

  it("balanced: stays silent on checking/idle", () => {
    expect(shouldEmitTranscriptRow("checking", "balanced", false)).toBe(false);
    expect(shouldEmitTranscriptRow("idle", "balanced", false)).toBe(false);
  });

  it("balanced: emits first unavailable, silent after", () => {
    expect(shouldEmitTranscriptRow("unavailable", "balanced", false)).toBe(true);
    expect(shouldEmitTranscriptRow("unavailable", "balanced", true)).toBe(false);
  });

  it("verbose: emits on every status except still suppresses duplicate unavailable is caller's job", () => {
    expect(shouldEmitTranscriptRow("error", "verbose", true)).toBe(true);
    expect(shouldEmitTranscriptRow("clean", "verbose", true)).toBe(true);
    expect(shouldEmitTranscriptRow("transition-clean", "verbose", true)).toBe(true);
    expect(shouldEmitTranscriptRow("checking", "verbose", true)).toBe(true);
    expect(shouldEmitTranscriptRow("idle", "verbose", true)).toBe(true);
  });
});
