/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for narrow editor-surface helpers. */
import { describe, expect, it } from "vitest";
import { EDITOR_HELPERS, runEditorOperation } from "../lib/editor-surfaces.ts";

function runBrowserHelper(operation: Record<string, unknown>): Record<string, unknown> {
  const textarea = {
    value: "before",
    readOnly: false,
    disabled: false,
    ownerDocument: {
      defaultView: { getComputedStyle: () => ({ visibility: "visible", display: "block" }) },
    },
    getBoundingClientRect: () => ({ width: 100, height: 40 }),
    getAttribute: () => null,
    parentElement: null,
    dispatchEvent: () => undefined,
  };
  const document = {
    querySelectorAll: (selector: string) => (selector === "textarea" ? [textarea] : []),
  };
  const windowStub = { document, frames: [] as unknown[], JSON };
  const fn = new Function(
    "window",
    "document",
    "Event",
    "InputEvent",
    "CSS",
    `${EDITOR_HELPERS}; return JSON.parse(window.__sfPiEditorOperation(${JSON.stringify(operation)}));`,
  );
  return fn(windowStub, document, class Event {}, class InputEvent {}, {
    escape: (value: string) => value,
  }) as Record<string, unknown>;
}

describe("editor surfaces", () => {
  it("parses agent-browser eval results that wrap returned strings", async () => {
    const pi = {
      exec: async () => ({
        code: 0,
        stdout: JSON.stringify(
          JSON.stringify({
            ok: true,
            action: "detect",
            candidates: [],
            inaccessibleFrameCount: 0,
          }),
        ),
        stderr: "",
      }),
    };
    const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "test-session" } };

    const result = await runEditorOperation(pi as never, ctx as never, { action: "detect" });

    expect(result.details).toMatchObject({ ok: true, action: "detect", candidates: [] });
  });

  it("detects visible textarea editors", () => {
    const result = runBrowserHelper({ action: "detect", editorIndex: -1, maxChars: 4000 });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("detect");
    expect(result.candidates).toMatchObject([{ editorIndex: 0, kind: "textarea" }]);
  });

  it("writes without exposing content through the helper contract", () => {
    const result = runBrowserHelper({
      action: "write",
      editorIndex: 0,
      value: "after",
      maxChars: 4000,
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("write");
    expect(result).not.toHaveProperty("value");
    expect(result).toMatchObject({ previousLength: 6, newLength: 5, verification: "matched" });
  });

  it("reads bounded editor content", () => {
    const result = runBrowserHelper({ action: "read", editorIndex: 0, maxChars: 3 });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("read");
    expect(result.value).toBe("bef");
    expect(result.truncated).toBe(true);
  });
});
