/* SPDX-License-Identifier: Apache-2.0 */
/** Cross-platform URL and folder openers. */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { browserOpenCommand, folderOpenCommand, openFolder, openUrl } from "../open-external.ts";

const URL_WITH_QUERY = "https://github.com/example/repo/issues/new?title=Bug&body=Steps&labels=bug";

function fakeSpawn(calls: Array<{ command: string; args: string[]; shell: unknown }>) {
  return ((command: string, args: string[], options: { shell?: unknown }) => {
    calls.push({ command, args, shell: options.shell });
    const child = new EventEmitter() as EventEmitter & { unref(): void };
    child.unref = () => undefined;
    return child;
  }) as never;
}

describe("browserOpenCommand", () => {
  it("uses open on macOS and xdg-open on Linux", () => {
    expect(browserOpenCommand(URL_WITH_QUERY, "darwin")).toEqual({
      command: "open",
      args: [URL_WITH_QUERY],
    });
    expect(browserOpenCommand(URL_WITH_QUERY, "linux")).toEqual({
      command: "xdg-open",
      args: [URL_WITH_QUERY],
    });
  });

  it("passes a URL with & as one argument on Windows, never through cmd.exe", () => {
    const open = browserOpenCommand(URL_WITH_QUERY, "win32");
    expect(open).toEqual({
      command: "rundll32",
      args: ["url.dll,FileProtocolHandler", URL_WITH_QUERY],
    });
    expect(open.command.toLowerCase()).not.toBe("cmd");
    expect(open.args.at(-1)).toBe(URL_WITH_QUERY);
  });
});

describe("folderOpenCommand", () => {
  it("uses the platform file manager", () => {
    expect(folderOpenCommand("/work/out", "darwin").command).toBe("open");
    expect(folderOpenCommand("C:\\work\\out", "win32")).toEqual({
      command: "explorer",
      args: ["C:\\work\\out"],
    });
    expect(folderOpenCommand("/work/out", "linux").command).toBe("xdg-open");
  });
});

describe("openUrl", () => {
  it("rejects non-http URLs without spawning", () => {
    const calls: Array<{ command: string; args: string[]; shell: unknown }> = [];
    expect(openUrl("file:///etc/passwd", { spawn: fakeSpawn(calls) }).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("spawns the platform opener without a shell", () => {
    const calls: Array<{ command: string; args: string[]; shell: unknown }> = [];
    const result = openUrl(URL_WITH_QUERY, { platform: "win32", spawn: fakeSpawn(calls) });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      { command: "rundll32", args: ["url.dll,FileProtocolHandler", URL_WITH_QUERY], shell: false },
    ]);
  });

  it("reports a spawn failure instead of throwing", () => {
    const throwing = (() => {
      throw new Error("spawn ENOENT");
    }) as never;
    const result = openUrl(URL_WITH_QUERY, { platform: "linux", spawn: throwing });
    expect(result).toMatchObject({ ok: false, command: "xdg-open", error: "spawn ENOENT" });
  });
});

describe("openFolder", () => {
  it("opens a folder through the platform file manager", () => {
    const calls: Array<{ command: string; args: string[]; shell: unknown }> = [];
    expect(openFolder("C:\\work\\out", { platform: "win32", spawn: fakeSpawn(calls) }).ok).toBe(
      true,
    );
    expect(calls[0]).toMatchObject({ command: "explorer", args: ["C:\\work\\out"] });
  });
});
