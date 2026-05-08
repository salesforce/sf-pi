/* SPDX-License-Identifier: Apache-2.0 */
/** Browser opener used by gateway onboarding commands. */
import { spawn as realSpawn } from "node:child_process";

export type BrowserOpenCommand = {
  command: string;
  args: string[];
};

export type BrowserOpenSuccess = BrowserOpenCommand & {
  ok: true;
  error?: undefined;
};

export type BrowserOpenFailure = {
  ok: false;
  error: string;
  command?: string;
  args?: string[];
};

export type BrowserOpenResult = BrowserOpenSuccess | BrowserOpenFailure;

type SpawnLike = typeof realSpawn;

export function buildBrowserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): BrowserOpenCommand {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}

export function openUrlInBrowser(
  url: string,
  options: { platform?: NodeJS.Platform; spawn?: SpawnLike } = {},
): BrowserOpenResult {
  if (!isHttpUrl(url)) {
    return { ok: false, error: "Only http:// and https:// URLs can be opened." };
  }

  const { command, args } = buildBrowserOpenCommand(url, options.platform);
  const spawn = options.spawn ?? realSpawn;

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", () => undefined);
    child.unref();
    return { ok: true, command, args };
  } catch (error) {
    return {
      ok: false,
      command,
      args,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
