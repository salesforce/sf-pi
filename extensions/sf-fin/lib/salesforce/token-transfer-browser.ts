/* SPDX-License-Identifier: Apache-2.0 */
/**
 * The Fin side of `token_transfer` in the shared SF Pi browser.
 *
 * Follows the controls Fin's Settings → Authentication → Add token → Custom
 * form renders (observed live), located by accessible name. Credential values
 * travel only on agent-browser's stdin (`batch`), so they never appear in
 * argv, process listings, or tool output; the field reads back masked.
 */
import { maskFinSecrets } from "../../../../lib/common/fin-admin-surface.ts";
import type { SpawnAgentBrowser } from "../signin-browser.ts";
import type { TokenTransferBrowser } from "./token-transfer.ts";

const LABEL: Record<"name" | "description" | "clientId" | "clientSecret", string> = {
  name: "Enter a token title",
  description: "Description",
  clientId: "Client ID",
  clientSecret: "Client secret",
};
const POLLS = 15;
const POLL_MS = 1_000;

export function createTokenTransferBrowser(
  spawn: SpawnAgentBrowser,
  finBase: string,
): TokenTransferBrowser {
  const run = async (args: string[]) => (await spawn(args, {})).stdout;
  const batch = async (commands: string[][]) =>
    (
      await spawn(["batch", "--json", "--omit-command", "--bail"], {
        stdin: JSON.stringify(commands),
      })
    ).code === 0;
  const snapshot = async () => maskFinSecrets(await run(["snapshot", "-c"]));
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (test: (snap: string) => boolean) => {
    for (let i = 0; i < POLLS; i += 1) {
      const snap = await snapshot();
      if (test(snap)) return snap;
      await sleep(POLL_MS);
    }
    return undefined;
  };
  const clickText = async (role: "button" | "menuitem" | "menuitemcheckbox", name: string) =>
    batch([["find", "role", role, "click", "--name", name]]);

  return {
    async openNewToken() {
      await run(["open", `${finBase}/settings/app-settings/authentication`]);
      if (!(await waitFor((s) => s.includes('button "Add token"')))) return false;
      await clickText("button", "Add token");
      if (!(await waitFor((s) => s.includes('menuitem "Custom"')))) return false;
      await clickText("menuitem", "Custom");
      return (await waitFor((s) => s.includes(`textbox "${LABEL.name}"`))) !== undefined;
    },
    async fill(field, value) {
      if (field === "url") {
        // The HTTPS URL field is a rich-text editor with no accessible name:
        // the first unnamed textbox after the "OAuth" type button.
        const snap = await run(["snapshot", "-i"]);
        const after = snap.slice(Math.max(0, snap.indexOf('button "OAuth"')));
        const ref = /- textbox \[ref=(e\d+)\]/u.exec(after)?.[1];
        if (!ref) throw new Error("Fin's HTTPS URL field was not found.");
        await batch([["fill", `@${ref}`, value]]);
        return;
      }
      await batch([["find", "label", LABEL[field], "fill", value]]);
    },
    async chooseOAuth() {
      await clickText("button", "Text");
      await waitFor((s) => s.includes('menuitemcheckbox "OAuth"'));
      await clickText("menuitemcheckbox", "OAuth");
      await waitFor((s) => s.includes('textbox "Client ID"'));
    },
    async chooseFormEncoded() {
      await clickText("button", "JSON");
      await waitFor((s) => s.includes("Form Encoded"));
      await batch([["find", "text", "Form Encoded", "click"]]);
    },
    async testRequest() {
      await clickText("button", "Test request");
      const done = await waitFor((s) => /Response: \d{3}/u.test(s));
      const message = /Response: [^"\n]*/u.exec(done ?? "")?.[0] ?? "no response shown";
      return { ok: /Response: 200\b/u.test(message) && /access_token/u.test(message), message };
    },
    async save() {
      await clickText("button", "Save");
      const back = await waitFor((s) => s.includes('button "Add token"'));
      return back !== undefined;
    },
    async listTokenNames() {
      await run(["open", `${finBase}/settings/app-settings/authentication`]);
      const snap = await waitFor((s) => s.includes('button "Add token"'));
      return [...(snap ?? "").matchAll(/heading "([^"]+)" \[level=3/gu)].flatMap((m) =>
        m[1] ? [m[1]] : [],
      );
    },
    async leave() {
      await run(["open", "about:blank"]);
    },
  };
}
