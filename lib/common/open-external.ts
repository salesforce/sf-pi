/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Open a URL in the user's browser, or a folder in the file manager, on
 * macOS, Windows, and Linux, without a shell.
 *
 * - macOS: `open <target>`.
 * - Windows URLs: `rundll32 url.dll,FileProtocolHandler <url>`. The URL is one
 *   argument and never passes through `cmd.exe`, so `&` in query strings is
 *   not treated as a command separator (`cmd /c start` truncates such URLs).
 * - Windows folders: `explorer <folder>`.
 * - Linux and other Unix: `xdg-open <target>`.
 *
 * Opening is best-effort: headless sessions, SSH, and minimal Linux installs
 * may have no opener. Callers must always show the URL or path as a fallback.
 */
import { spawn as realSpawn } from "node:child_process";

export interface OpenCommand {
  command: string;
  args: string[];
}

export type OpenResult =
  ({ ok: true } & OpenCommand) | { ok: false; error: string; command?: string; args?: string[] };

export interface OpenOptions {
  platform?: NodeJS.Platform;
  spawn?: typeof realSpawn;
}

/** The shell-free command that opens `url` in the default browser. */
export function browserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): OpenCommand {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") {
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  }
  return { command: "xdg-open", args: [url] };
}

/** The shell-free command that opens `folder` in the file manager. */
export function folderOpenCommand(
  folder: string,
  platform: NodeJS.Platform = process.platform,
): OpenCommand {
  if (platform === "darwin") return { command: "open", args: [folder] };
  if (platform === "win32") return { command: "explorer", args: [folder] };
  return { command: "xdg-open", args: [folder] };
}

export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Open an http(s) URL in the default browser. Never throws. */
export function openUrl(url: string, options: OpenOptions = {}): OpenResult {
  if (!isHttpUrl(url)) {
    return { ok: false, error: "Only http:// and https:// URLs can be opened." };
  }
  return launch(browserOpenCommand(url, options.platform), options.spawn);
}

/** Open a folder in the file manager. Never throws. */
export function openFolder(folder: string, options: OpenOptions = {}): OpenResult {
  return launch(folderOpenCommand(folder, options.platform), options.spawn);
}

function launch(open: OpenCommand, spawn: typeof realSpawn = realSpawn): OpenResult {
  try {
    const child = spawn(open.command, open.args, {
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    });
    // A missing opener (for example no xdg-open) surfaces asynchronously.
    child.once("error", () => undefined);
    child.unref();
    return { ok: true, ...open };
  } catch (error) {
    return { ok: false, ...open, error: error instanceof Error ? error.message : String(error) };
  }
}
