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

/**
 * How each field is located (observed live): the title input has only a
 * placeholder; the others have a <label for>. A locator that matches nothing
 * is an error, never a silent no-op.
 */
const LOCATOR: Record<
  "name" | "description" | "clientId" | "clientSecret",
  ["placeholder" | "label", string]
> = {
  name: ["placeholder", "Enter a token title"],
  description: ["label", "Description"],
  clientId: ["label", "Client ID"],
  clientSecret: ["label", "Client secret"],
};
const POLLS = 15;
const POLL_MS = 1_000;

/**
 * Fin's Test request result from a snapshot. The text sits in a quoted
 * StaticText whose own quotes are escaped (`\"access_token\"`), so read the
 * whole quoted value and unescape it. A pass needs 200 and a found token.
 */
export function testRequestOutcome(snapshot: string): { ok: boolean; message: string } {
  const quoted = /StaticText "(Response: (?:[^"\\]|\\.)*)"/u.exec(snapshot)?.[1];
  const message = quoted?.replace(/\\(.)/gu, "$1") ?? "no response shown";
  return {
    ok: /^Response: 200\b/u.test(message) && /Found token under the path/u.test(message),
    message,
  };
}

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
      return (await waitFor((s) => s.includes(`textbox "${LOCATOR.name[1]}"`))) !== undefined;
    },
    async fill(field, value) {
      if (field === "url") {
        // The HTTPS URL field is a rich-text editor with no accessible name:
        // the first unnamed textbox after the "OAuth" type button.
        const snap = await run(["snapshot", "-i"]);
        const after = snap.slice(Math.max(0, snap.indexOf('button "OAuth"')));
        const ref = /- textbox \[ref=(e\d+)\]/u.exec(after)?.[1];
        if (!ref) throw new Error("Fin's HTTPS URL field was not found.");
        if (!(await batch([["fill", `@${ref}`, value]]))) {
          throw new Error("Could not fill Fin's HTTPS URL field.");
        }
        return;
      }
      const [locator, label] = LOCATOR[field];
      if (!(await batch([["find", locator, label, "fill", value]]))) {
        throw new Error(`Could not fill Fin's "${label}" field.`);
      }
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
      return testRequestOutcome((await waitFor((s) => /Response: \d{3}/u.test(s))) ?? "");
    },
    async save() {
      // Save stays disabled until the form is complete; clicking it then does
      // nothing, so check it first and say why.
      const ready = await waitFor((s) => /button "Save"(?! \[disabled)/u.test(s));
      if (!ready) throw new Error("Fin's Save button stayed disabled (a required field is empty).");
      await clickText("button", "Save");
      // Fin then opens the saved token's page (Save disabled again).
      const settled = await waitFor((s) => /button "Save" \[disabled/u.test(s));
      return settled !== undefined;
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
