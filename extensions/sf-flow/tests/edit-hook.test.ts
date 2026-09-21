/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";

describe("SF Flow edit feedback", () => {
  it("adds local findings after a successful Flow write without contacting an org", async () => {
    const mod = await import("../index.ts");
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
    const pi = {
      on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        handlers.set(event, handler);
      }),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
    };
    mod.default(pi as never);

    const updated = (await handlers.get("tool_result")?.(
      {
        toolName: "write",
        isError: false,
        input: { path: "extensions/sf-flow/tests/fixtures/broken.flow" },
        content: [{ type: "text", text: "wrote file" }],
        details: {},
      },
      { cwd: process.cwd() },
    )) as { content?: Array<{ text?: string }>; details?: Record<string, unknown> };

    expect(updated.content?.at(-1)?.text).toContain("SF Flow diagnostics");
    expect(updated.details?.sf_flow_diagnostics).toBeDefined();
  });

  it("stops repair guidance when the actionable signature repeats", async () => {
    const mod = await import("../index.ts");
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
    const pi = {
      on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) =>
        handlers.set(event, handler),
      ),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
    };
    mod.default(pi as never);
    const event = {
      toolName: "edit",
      isError: false,
      input: { path: "extensions/sf-flow/tests/fixtures/broken.flow" },
      content: [{ type: "text", text: "edited file" }],
      details: {},
    };
    await handlers.get("tool_result")?.(event, { cwd: process.cwd() });
    const repeated = (await handlers.get("tool_result")?.(event, {
      cwd: process.cwd(),
    })) as { content?: Array<{ text?: string }>; details?: Record<string, unknown> };

    expect(repeated.content?.at(-1)?.text).toContain("finding signature did not change");
    expect(repeated.details?.sf_flow_repair_loop).toMatchObject({
      status: "stopped",
      reason: "repeated-signature",
    });
  });

  it("keeps low-only generation findings human-only after edits", async () => {
    const mod = await import("../index.ts");
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
    const pi = {
      on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) =>
        handlers.set(event, handler),
      ),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
    };
    mod.default(pi as never);

    expect(
      await handlers.get("tool_result")?.(
        {
          toolName: "write",
          isError: false,
          input: { path: "extensions/sf-flow/tests/fixtures/Screen_Example.flow-meta.xml" },
          content: [],
          details: {},
        },
        { cwd: process.cwd() },
      ),
    ).toBeUndefined();
  });

  it("appends topology to the next final assistant message for Pi-native rendering", async () => {
    const mod = await import("../index.ts");
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
    const pi = {
      on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) =>
        handlers.set(event, handler),
      ),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
    };
    mod.default(pi as never);

    await handlers.get("tool_result")?.(
      {
        toolName: "sf_flow",
        isError: false,
        input: { action: "flow.inspect" },
        content: [{ type: "text", text: "PASS: Flow Inspection" }],
        details: {
          file: "force-app/main/default/flows/Example.flow-meta.xml",
          digest: {
            title: "Flow Inspection",
            meta: ["Example.flow-meta.xml"],
            topology: {
              mermaid:
                'flowchart TD\n    start(["Start"])\n    finish["Finish"]\n    start --> finish',
              truncated: false,
            },
          },
        },
      },
      { cwd: process.cwd() },
    );
    await handlers.get("tool_result")?.(
      {
        toolName: "sf_flow",
        isError: false,
        input: { action: "diagnose.file" },
        content: [{ type: "text", text: "PASS: Flow Diagnostics" }],
        details: {
          file: "force-app/main/default/flows/Example.flow-meta.xml",
          digest: {
            title: "Flow Diagnostics",
            meta: ["force-app/main/default/flows/Example.flow-meta.xml"],
            topology: {
              mermaid:
                'flowchart TD\n    start(["Start"])\n    repaired["Repaired"]\n    start --> repaired',
              truncated: false,
            },
          },
        },
      },
      { cwd: process.cwd() },
    );

    expect(
      await handlers.get("message_end")?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }],
          },
        },
        { cwd: process.cwd() },
      ),
    ).toBeUndefined();

    const completed = (await handlers.get("message_end")?.(
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Inspection complete." }],
        },
      },
      { cwd: process.cwd() },
    )) as { message?: { content?: Array<{ type?: string; text?: string }> } };
    const text = completed.message?.content
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");

    expect(text).toContain("Inspection complete.");
    expect(text).toContain("### Flow Topology — Example.flow-meta.xml");
    expect(text).toContain("```mermaid");
    expect(text).toContain("flowchart TD");
    expect(text).toContain('repaired["Repaired"]');
    expect(text).not.toContain('finish["Finish"]');
    expect(text?.match(/```mermaid/g)).toHaveLength(1);
    expect(
      await handlers.get("message_end")?.(
        { message: { role: "assistant", content: [{ type: "text", text: "Next." }] } },
        { cwd: process.cwd() },
      ),
    ).toBeUndefined();
  });

  it("stays silent for non-Flow writes", async () => {
    const mod = await import("../index.ts");
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
    const pi = {
      on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) =>
        handlers.set(event, handler),
      ),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
    };
    mod.default(pi as never);

    expect(
      await handlers.get("tool_result")?.(
        {
          toolName: "write",
          isError: false,
          input: { path: "README.md" },
          content: [],
          details: {},
        },
        { cwd: process.cwd() },
      ),
    ).toBeUndefined();
  });
});
