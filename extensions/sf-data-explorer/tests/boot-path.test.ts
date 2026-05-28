/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import sfDataExplorer from "../index.ts";

type SessionHandler = () => unknown | Promise<unknown>;

describe("sf-data-explorer boot path", () => {
  it("uses shared REST helpers instead of importing sf-data360 internals", () => {
    const source = readFileSync("extensions/sf-data-explorer/lib/transport.ts", "utf8");
    expect(source).toContain("lib/common/sf-rest/path.ts");
    expect(source).toContain("lib/common/sf-rest/target-org.ts");
    expect(source).not.toContain("extensions/sf-data360/lib/path.ts");
    expect(source).not.toContain("extensions/sf-data360/lib/target-org.ts");
  });

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
