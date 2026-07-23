/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  emitHumanOnlyCommandOutput,
  registerHumanOnlyCommandOutput,
} from "../human-only-command-output.ts";

describe("emitHumanOnlyCommandOutput", () => {
  it("emits JSON-mode reports as human-only session entries", async () => {
    const pi = {
      appendEntry: vi.fn(),
      sendMessage: vi.fn(),
    };
    const ctx = {
      cwd: process.cwd(),
      mode: "json",
      hasUI: false,
      ui: { notify: vi.fn() },
    };

    await emitHumanOnlyCommandOutput(pi as never, ctx as never, "test-report", {
      title: "Status",
      body: "Ready",
      severity: "info",
    });

    expect(pi.appendEntry).toHaveBeenCalledWith("test-report", {
      title: "Status",
      body: "Ready",
      severity: "info",
    });
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("redacts secret-shaped values before persistence", async () => {
    const pi = { appendEntry: vi.fn() };
    const ctx = {
      cwd: process.cwd(),
      mode: "json",
      hasUI: false,
      ui: { notify: vi.fn() },
    };

    await emitHumanOnlyCommandOutput(pi as never, ctx as never, "test-report", {
      title: "Status",
      body: "api_key=super-secret-value",
      severity: "info",
    });

    const persisted = JSON.stringify(pi.appendEntry.mock.calls[0]);
    expect(persisted).toContain("<redacted>");
    expect(persisted).not.toContain("super-secret-value");
  });

  it("keeps state-only report entries out of Pi's model context", async () => {
    const session = SessionManager.inMemory();
    const pi = {
      appendEntry: (customType: string, data: unknown) =>
        session.appendCustomEntry(customType, data),
    };
    const ctx = {
      cwd: process.cwd(),
      mode: "json",
      hasUI: false,
      ui: { notify: vi.fn() },
    };

    await emitHumanOnlyCommandOutput(pi as never, ctx as never, "test-report", {
      title: "Status",
      body: "Ready",
      severity: "info",
    });

    expect(session.getEntries()).toEqual([
      expect.objectContaining({ type: "custom", customType: "test-report" }),
    ]);
    expect(session.buildSessionContext().messages).toEqual([]);
  });

  it("uses RPC notifications without appending model-visible messages", async () => {
    const pi = { appendEntry: vi.fn(), sendMessage: vi.fn() };
    const notify = vi.fn();
    const ctx = {
      cwd: process.cwd(),
      mode: "rpc",
      hasUI: true,
      ui: { notify },
    };

    await emitHumanOnlyCommandOutput(pi as never, ctx as never, "test-report", {
      title: "Status",
      body: "Ready",
      severity: "info",
    });

    expect(notify).toHaveBeenCalledWith("Ready", "info");
    expect(pi.appendEntry).not.toHaveBeenCalled();
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("renders the existing TUI info panel without appending a transcript duplicate", async () => {
    const pi = { appendEntry: vi.fn(), sendMessage: vi.fn() };
    let component: { render(width: number): string[] } | undefined;
    const theme = {
      fg: (_color: string, text: string) => text,
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };
    const custom = vi.fn(async (factory) => {
      component = factory({ terminal: { rows: 30 } }, theme, {}, vi.fn());
    });
    const ctx = {
      cwd: process.cwd(),
      mode: "tui",
      hasUI: true,
      ui: { custom },
    };

    await emitHumanOnlyCommandOutput(pi as never, ctx as never, "test-report", {
      title: "Status",
      body: "Ready",
      severity: "info",
    });

    expect(custom).toHaveBeenCalledOnce();
    expect(component?.render(80).join("\n")).toContain("Status");
    expect(component?.render(80).join("\n")).toContain("Ready");
    expect(pi.appendEntry).not.toHaveBeenCalled();
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("registers an entry renderer rather than a model-visible message renderer", () => {
    const pi = {
      registerEntryRenderer: vi.fn(),
      registerMessageRenderer: vi.fn(),
    };

    registerHumanOnlyCommandOutput(pi as never, "test-report");

    expect(pi.registerEntryRenderer).toHaveBeenCalledWith("test-report", expect.any(Function));
    expect(pi.registerMessageRenderer).not.toHaveBeenCalled();
  });

  it("prints reports in print mode while appending only a custom entry", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const pi = {
      appendEntry: vi.fn(),
      sendMessage: vi.fn(),
    };
    const ctx = {
      cwd: process.cwd(),
      mode: "print",
      hasUI: false,
      ui: { notify: vi.fn() },
    };

    await emitHumanOnlyCommandOutput(pi as never, ctx as never, "test-report", {
      title: "Status",
      body: "Ready",
      severity: "info",
    });

    expect(info).toHaveBeenCalledWith("Ready");
    expect(pi.appendEntry).toHaveBeenCalledOnce();
    expect(pi.sendMessage).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
