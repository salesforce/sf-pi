/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for browser opener command selection. */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { buildBrowserOpenCommand, openUrlInBrowser } from "../lib/open-url.ts";

describe("buildBrowserOpenCommand", () => {
  it("uses the macOS open command", () => {
    expect(buildBrowserOpenCommand("https://gateway.example.com", "darwin")).toEqual({
      command: "open",
      args: ["https://gateway.example.com"],
    });
  });

  it("uses cmd start on Windows", () => {
    expect(buildBrowserOpenCommand("https://gateway.example.com", "win32")).toEqual({
      command: "cmd",
      args: ["/c", "start", "", "https://gateway.example.com"],
    });
  });

  it("uses xdg-open on Linux", () => {
    expect(buildBrowserOpenCommand("https://gateway.example.com", "linux")).toEqual({
      command: "xdg-open",
      args: ["https://gateway.example.com"],
    });
  });
});

describe("openUrlInBrowser", () => {
  it("rejects non-http URLs", () => {
    const result = openUrlInBrowser("file:///tmp/token");
    expect(result.ok).toBe(false);
  });

  it("spawns the platform opener when URL is valid", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const fakeSpawn = ((command: string, args: string[]) => {
      calls.push({ command, args });
      const child = new EventEmitter() as EventEmitter & { unref(): void };
      child.unref = () => undefined;
      return child;
    }) as never;

    const result = openUrlInBrowser("https://gateway.example.com", {
      platform: "darwin",
      spawn: fakeSpawn,
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ command: "open", args: ["https://gateway.example.com"] }]);
  });
});
