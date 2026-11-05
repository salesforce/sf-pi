/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Behavior Proofs: SF Browser never returns Fin secrets as text, and never
 * screenshots or editor-reads a Fin admin page that can show one.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runAgentBrowser } from "../lib/agent-browser.ts";
import { runEditorOperation } from "../lib/editor-surfaces.ts";
import { checkFinSecretSurface } from "../lib/fin-admin-guard.ts";
import { captureEvidence } from "../lib/operations.ts";

// Built at runtime so no key-shaped literal is committed. Synthetic: it
// decodes to "tok:fake_…", not a real credential.
const FAKE_KEY = Buffer.from(`tok:fake_${"0123456789abcdef"}:1:0x${"fake".repeat(4)}`).toString(
  "base64",
);
const SECRET_PAGE = "https://app.intercom.com/a/apps/abc123/standalone/deploy/fin-agent-api";
const PLAIN_FIN_PAGE = "https://app.intercom.com/a/apps/abc123/settings/helpcenter/all";

/** Fake agent-browser: answers `get url` and `snapshot`, records every call. */
function fakeBrowser(url: string, snapshot = '- heading "Page" [level=1, ref=e1]') {
  const calls: string[][] = [];
  const pi = {
    exec: vi.fn(async (_command: string, args: string[]) => {
      const op = args.slice(4);
      calls.push(op);
      if (op[0] === "get" && op[1] === "url") return { stdout: `${url}\n`, stderr: "", code: 0 };
      if (op[0] === "snapshot") return { stdout: snapshot, stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 0 };
    }),
  } as unknown as ExtensionAPI;
  return { pi, calls };
}

function ctx(sessionId: string) {
  return { cwd: process.cwd(), sessionManager: { getSessionId: () => sessionId } } as never;
}

describe("runAgentBrowser output", () => {
  it("masks a revealed key in stdout and stderr before any caller sees it", async () => {
    const pi = {
      exec: async () => ({
        stdout: `- textbox "API key" [ref=e1]: ${FAKE_KEY}`,
        stderr: `error near ${FAKE_KEY}`,
        code: 0,
      }),
    } as unknown as ExtensionAPI;
    const result = await runAgentBrowser(pi, ["snapshot"], { cwd: "." });
    expect(result.stdout + result.stderr).not.toContain(FAKE_KEY.slice(0, 16));
  });
});

describe("checkFinSecretSurface", () => {
  it("blocks Fin secret pages, open key dialogs, and unreadable Fin page state", async () => {
    expect((await checkFinSecretSurface(fakeBrowser(SECRET_PAGE).pi, ".", undefined)).blocked).toBe(
      true,
    );
    const dialog = fakeBrowser(PLAIN_FIN_PAGE, '- dialog "Manage API key"');
    expect((await checkFinSecretSurface(dialog.pi, ".", undefined)).blocked).toBe(true);
    const broken = {
      exec: async (_c: string, args: string[]) =>
        args.includes("url")
          ? { stdout: PLAIN_FIN_PAGE, stderr: "", code: 0 }
          : { stdout: "", stderr: "boom", code: 1 },
    } as unknown as ExtensionAPI;
    expect((await checkFinSecretSurface(broken, ".", undefined)).blocked).toBe(true);
  });

  it("never blocks Salesforce or plain Fin pages", async () => {
    for (const url of [
      "https://example.my.salesforce.com/lightning/setup/SetupOneHome/home",
      PLAIN_FIN_PAGE,
    ]) {
      expect((await checkFinSecretSurface(fakeBrowser(url).pi, ".", undefined)).blocked).toBe(
        false,
      );
    }
  });

  it("uses the browser's own URL, not a caller-supplied one", async () => {
    const browser = fakeBrowser(SECRET_PAGE);
    const result = await checkFinSecretSurface(browser.pi, ".", undefined);
    expect(result.blocked).toBe(true);
    expect(browser.calls).toContainEqual(["get", "url"]);
  });
});

describe("screenshots and editor reads on Fin secret pages", () => {
  it("takes no screenshot on a Fin secret page", async () => {
    const browser = fakeBrowser(SECRET_PAGE);
    const result = await captureEvidence(
      browser.pi,
      ctx("fin-guard-shot"),
      { label: "fin", imageMode: "thumbnail", dismissOverlays: false },
      undefined,
    );
    expect(result.details).toMatchObject({ ok: false, code: "fin-secret-surface" });
    expect(result.content.some((part) => part.type === "image")).toBe(false);
    expect(browser.calls.some((call) => call[0] === "screenshot")).toBe(false);
  });

  it("still screenshots a plain Fin page", async () => {
    const browser = fakeBrowser(PLAIN_FIN_PAGE);
    await captureEvidence(
      browser.pi,
      ctx("fin-guard-plain"),
      { label: "plain", imageMode: "artifact", dismissOverlays: false },
      undefined,
    ).catch(() => undefined);
    expect(browser.calls.some((call) => call[0] === "screenshot")).toBe(true);
  });

  it("refuses editor read and write on a Fin secret page; detect still works", async () => {
    for (const action of ["read", "write"] as const) {
      const browser = fakeBrowser(SECRET_PAGE);
      const result = await runEditorOperation(
        browser.pi,
        ctx("fin-guard-editor"),
        { action, value: action === "write" ? "x" : undefined },
        undefined,
      );
      expect(result.details).toMatchObject({ ok: false, code: "fin-secret-surface" });
      expect(browser.calls.some((call) => call[0] === "eval")).toBe(false);
    }
    const detect = fakeBrowser(SECRET_PAGE);
    await runEditorOperation(
      detect.pi,
      ctx("fin-guard-detect"),
      { action: "detect" },
      undefined,
    ).catch(() => undefined);
    expect(detect.calls.some((call) => call[0] === "eval")).toBe(true);
  });
});

it("leaves no screenshot file behind when refused", async () => {
  const browser = fakeBrowser(SECRET_PAGE);
  const result = await captureEvidence(
    browser.pi,
    ctx("fin-guard-file"),
    { label: "nofile", imageMode: "full", dismissOverlays: false },
    undefined,
  );
  const path = (result.details as { path?: string }).path;
  expect(path === undefined || !existsSync(path)).toBe(true);
});
