/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import sfDataExplorer from "../index.ts";

type SessionHandler = () => unknown | Promise<unknown>;

describe("sf-data-explorer boot path", () => {
  it("does not initialize Salesforce transport during session lifecycle hooks", async () => {
    const handlers = new Map<string, SessionHandler[]>();
    const pi = {
      on: vi.fn((event: string, handler: SessionHandler) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      }),
      registerCommand: vi.fn(),
      exec: vi.fn(async () => ({ stdout: "", stderr: "", code: 0 })),
    };

    sfDataExplorer(pi as never);

    for (const event of ["session_start", "session_shutdown"]) {
      for (const handler of handlers.get(event) ?? []) {
        await handler();
      }
    }

    expect(pi.exec).not.toHaveBeenCalled();
  });
});
