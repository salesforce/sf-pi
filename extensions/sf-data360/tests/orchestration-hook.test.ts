/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import sfData360 from "../index.ts";

function eventBus() {
  return { on: vi.fn(), emit: vi.fn() };
}

function result(offset: number) {
  const page = offset / 200 + 1;
  return {
    toolName: "sf_data360",
    isError: false,
    details: {
      digest: {
        action: "harmonize.dmo.list",
        namespace: "harmonize",
        status: "pass",
        api_calls: [
          {
            transport: "CONNECT",
            method: "GET",
            url: `https://example.my.salesforce.com/data-model-objects?limit=200&offset=${offset}`,
            status: 200,
            outcome: "success",
            pagination: {
              kind: "offset",
              label: `Page ${page} · items ${offset + 1}–${offset + 200} · batch size 200`,
              offset,
              limit: 200,
              page,
              start: offset + 1,
              end: offset + 200,
              returned: 200,
            },
          },
        ],
        sections: [
          {
            title: "Outcome",
            rows: [{ label: "Resources", value: "200" }],
          },
        ],
      },
    },
  };
}

describe("Data 360 orchestration hook", () => {
  it("appends exactly one top-level Mermaid trace after multiple Data 360 calls", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const pi = {
      events: eventBus(),
      on: vi.fn((name: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(name, handler),
      ),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
    };
    sfData360(pi as never);

    await handlers.get("tool_result")?.(result(0), { cwd: process.cwd() });
    await handlers.get("tool_result")?.(result(200), { cwd: process.cwd() });
    await handlers.get("tool_result")?.(result(400), { cwd: process.cwd() });
    const completed = (await handlers.get("message_end")?.({
      message: {
        role: "assistant",
        content: [{ type: "text", text: "DMO discovery complete." }],
      },
    })) as { message?: { content?: Array<{ type?: string; text?: string }> } } | undefined;

    const text = completed?.message?.content
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    expect(text).toContain("DMO discovery complete.");
    expect(text).toContain("### Data 360 Orchestration");
    expect(text).toContain("```mermaid");
    expect(text).toContain("Page 3");
    expect(text?.match(/```mermaid/g)).toHaveLength(1);
    expect(
      await handlers.get("message_end")?.({
        message: { role: "assistant", content: [{ type: "text", text: "Next." }] },
      }),
    ).toBeUndefined();
  });
});
