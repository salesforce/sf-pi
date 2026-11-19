/* SPDX-License-Identifier: Apache-2.0 */
/**
 * The real ConnectBrowser: the shared SF Pi agent-browser session.
 *
 * Secret-bearing URLs (frontdoor, OAuth) travel on stdin through `batch`, so
 * they never appear in argv or process listings, and URLs read back are used
 * only for host/path checks inside the runbook.
 */
import type { SpawnAgentBrowser } from "../signin-browser.ts";
import type { ConnectBrowser } from "./connect.ts";

export function createConnectBrowser(spawn: SpawnAgentBrowser): ConnectBrowser {
  const run = async (args: string[]) => (await spawn(args, {})).stdout;
  const urlsOf = (stdout: string) =>
    [...stdout.matchAll(/https:\/\/\S+/gu)].map((match) => match[0].replace(/[)\]]+$/u, ""));
  return {
    async open(url) {
      await run(["open", url]);
    },
    async openSecret(url) {
      await spawn(["batch", "--json", "--omit-command", "--bail"], {
        stdin: JSON.stringify([["open", url]]),
      });
    },
    async url() {
      return urlsOf(await run(["get", "url"]))[0];
    },
    async snapshot() {
      return run(["snapshot", "-i", "-c"]);
    },
    async click(ref) {
      await run(["click", `@${ref.replace(/^@/u, "")}`]);
    },
    async tabUrls() {
      return urlsOf(await run(["tab", "list"]));
    },
    async closeExtraTabs() {
      const listed = await run(["tab", "list"]);
      const ids = [...listed.matchAll(/\[(t\d+)\]/gu)].flatMap((match) =>
        match[1] ? [match[1]] : [],
      );
      for (const id of ids.slice(1).reverse()) await run(["tab", "close", id]);
      if (ids[0]) await run(["tab", ids[0]]);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
