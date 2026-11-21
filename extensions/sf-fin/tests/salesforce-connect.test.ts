/* SPDX-License-Identifier: Apache-2.0 */
/** Fin Connect runbook against a scripted fake Fin + Salesforce browser. */
import { describe, expect, it } from "vitest";
import {
  oauthApprovalPath,
  parseSnapshot,
  runFinConnect,
  type ConnectBrowser,
  type ConnectPlanInput,
} from "../lib/salesforce/connect.ts";

const APP = "testapp1";
const FIN = `https://app.intercom.com/a/apps/${APP}`;
const ORG = "example.my.salesforce.com";
const APPROVAL = "/setup/secur/RemoteAccessAuthorizationPage.apexp?source=REQUEST";

const CONNECT_PAGE = [
  '- heading "Connect Fin to Salesforce" [level=1, ref=e1]',
  '- heading "Connect Fin to a test organization" [level=3, ref=e2]',
  '- button "Connect" [ref=e3]',
  '- heading "Deploy Fin in a live organization" [level=3, ref=e4]',
  '- button "Connect" [ref=e5]',
].join("\n");
const dialog = (button: string) =>
  `${CONNECT_PAGE}\n- heading "Manage Salesforce environment" [level=2, ref=e6]\n- button "Install package" [ref=e7]\n- button "${button}" [ref=e8]`;
const approvalPage = (app: string, user: string) =>
  [
    '- heading "Allow Access?" [level=2, ref=e20]',
    `- StaticText "${app} is asking to:"`,
    `- StaticText "Do you want to allow access for ${user}?"`,
    '- button " Allow " [ref=e21]',
    '- button " Deny " [ref=e22]',
  ].join("\n");
const SETTINGS = [
  '- heading "Select Fin Salesforce user Required" [level=3, ref=e30]',
  '- combobox "Fin Salesforce user" [expanded=false, ref=e31]: Select a user...',
  '- button "Save" [disabled, ref=e32]',
].join("\n");
const PICKER = [
  SETTINGS,
  '- option "Fin AI Agent" [ref=e33]',
  '- option "Admin · No Service Cloud User permission" [disabled, ref=e34]',
].join("\n");
const SELECTED = [
  '- heading "Select Fin Salesforce user Required" [level=3, ref=e30]',
  '- combobox "Fin Salesforce user" [expanded=false, ref=e31]: Fin AI Agent',
  '- button "Save" [ref=e32]',
].join("\n");
const SAVED = [
  '- heading "Select Fin Salesforce user Done" [level=3, ref=e30]',
  '- combobox "Fin Salesforce user" [expanded=false, ref=e31]: Fin AI Agent',
].join("\n");

interface Script {
  redirectHost?: string;
  approvalApp?: string;
  approvalUser?: string;
  finUserListed?: boolean;
}

/** State machine that reacts to opens and clicks like Fin + Salesforce do. */
function fakeBrowser(script: Script = {}) {
  let url = "about:blank";
  let view = "";
  const clicks: string[] = [];
  const opened: string[] = [];
  const secrets: string[] = [];
  const browser: ConnectBrowser = {
    async open(next) {
      opened.push(next);
      url = next;
      view = next.endsWith("/standalone/connect")
        ? CONNECT_PAGE
        : next.endsWith("/settings/channels/salesforce-cases")
          ? SETTINGS
          : "";
    },
    async openSecret(next) {
      secrets.push(next);
      url = `https://${ORG}${APPROVAL}`;
      view = approvalPage(
        script.approvalApp ?? "Fin for Salesforce",
        script.approvalUser ?? "admin@example.com",
      );
    },
    async url() {
      return url;
    },
    async snapshot() {
      return view;
    },
    async click(ref) {
      clicks.push(ref);
      if (ref === "e5") view = dialog("Connect to Salesforce Production");
      else if (ref === "e3") view = dialog("Connect to Salesforce Sandbox");
      else if (ref === "e8") {
        const host = script.redirectHost ?? ORG;
        url = `https://${host}/?ec=302&startURL=${encodeURIComponent(APPROVAL)}`;
        view = "";
      } else if (ref === "e21") {
        url = `${FIN}/standalone/connect`;
        view = CONNECT_PAGE;
      } else if (ref === "e31") view = script.finUserListed === false ? SETTINGS : PICKER;
      else if (ref === "e33") view = SELECTED;
      else if (ref === "e32") view = SAVED;
    },
    async tabUrls() {
      return [url];
    },
    async closeExtraTabs() {},
    async sleep() {},
  };
  return { browser, clicks, opened, secrets };
}

const input = (over: Partial<ConnectPlanInput> = {}): ConnectPlanInput => ({
  appId: APP,
  region: "us",
  card: "live",
  orgHost: ORG,
  integrationUsername: "admin@example.com",
  finUserName: "Fin AI Agent",
  frontdoor: async (path) =>
    `https://${ORG}/secur/frontdoor.jsp?otp=SECRET&startURL=${encodeURIComponent(path)}`,
  ...over,
});

describe("Fin Connect runbook", () => {
  it("connects through the live card, allows as the integration user, and saves the Fin user", async () => {
    const fake = fakeBrowser();
    const result = await runFinConnect(fake.browser, input());
    expect(result).toMatchObject({ ok: true });
    expect(fake.clicks).toEqual(["e5", "e8", "e21", "e31", "e33", "e32"]);
    expect(fake.opened).toEqual([
      `${FIN}/standalone/connect`,
      `${FIN}/settings/channels/salesforce-cases`,
    ]);
    // The frontdoor URL went only through the secret channel and is not in the result.
    expect(fake.secrets).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("uses the test card's Sandbox button when asked", async () => {
    const fake = fakeBrowser();
    await runFinConnect(fake.browser, input({ card: "test" }));
    expect(fake.clicks.slice(0, 2)).toEqual(["e3", "e8"]);
  });

  it("refuses a redirect to any host other than the target org", async () => {
    const fake = fakeBrowser({ redirectHost: "other.my.salesforce.com" });
    const result = await runFinConnect(fake.browser, input());
    expect(result).toMatchObject({ ok: false, code: "redirect_unexpected" });
    expect(fake.secrets).toEqual([]);
    expect(fake.clicks).not.toContain("e21");
  });

  it("refuses to Allow for another app or another user", async () => {
    for (const [script, code] of [
      [{ approvalApp: "Some Other App" }, "wrong_app"],
      [{ approvalUser: "someone@example.com" }, "wrong_user"],
    ] as const) {
      const fake = fakeBrowser(script);
      const result = await runFinConnect(fake.browser, input());
      expect(result).toMatchObject({ ok: false, code });
      expect(fake.clicks).not.toContain("e21");
    }
  });

  it("stops when Fin does not list the Fin user", async () => {
    const fake = fakeBrowser({ finUserListed: false });
    const result = await runFinConnect(fake.browser, input());
    expect(result).toMatchObject({ ok: false, code: "fin_user_missing" });
    expect(fake.clicks).not.toContain("e32");
  });
});

describe("helpers", () => {
  it("accepts only the OAuth approval path on the target org", () => {
    const wrapped = `https://${ORG}/?ec=302&startURL=${encodeURIComponent(APPROVAL)}`;
    expect(oauthApprovalPath(wrapped, ORG)).toBe(APPROVAL);
    expect(oauthApprovalPath(`https://${ORG}${APPROVAL}`, ORG)).toBe(APPROVAL);
    expect(oauthApprovalPath(wrapped, "other.my.salesforce.com")).toBeUndefined();
    expect(oauthApprovalPath(`http://${ORG}${APPROVAL}`, ORG)).toBeUndefined();
    expect(
      oauthApprovalPath(
        `https://${ORG}/?startURL=${encodeURIComponent("/setup/other.apexp?x=1")}`,
        ORG,
      ),
    ).toBeUndefined();
  });

  it("parses snapshot lines with refs and attributes", () => {
    expect(parseSnapshot('- button "Save" [disabled, ref=e9]')[0]).toMatchObject({
      role: "button",
      name: "Save",
      ref: "e9",
    });
  });
});
