/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Behavior Proofs for moving an External Client App's client credentials into
 * a Fin OAuth auth token without the secret ever reaching tool output.
 * Synthetic ids and values only.
 */
import { describe, expect, it } from "vitest";
import {
  runTokenTransfer,
  type TokenTransferBrowser,
  type TokenTransferOrg,
} from "../lib/salesforce/token-transfer.ts";

const APP = "testapp1";
const FIN = `https://app.intercom.com/a/apps/${APP}`;
const ORG_HOST = "example.my.salesforce.com";
// Built at runtime: synthetic, never a real credential.
const KEY = `3MVG${"k".repeat(60)}`;
const SECRET = `${"s".repeat(32)}${"0".repeat(32)}`;

function fakeOrg(options: { setting?: boolean; secretReadable?: boolean; apps?: number } = {}) {
  let setting = options.setting === true;
  const events: string[] = [];
  const org: TokenTransferOrg = {
    async findApp(name) {
      if ((options.apps ?? 1) === 0) return undefined;
      return {
        id: "0xI000000000001",
        name,
        clientCredentials: true,
        runAs: "api-user@example.com",
      };
    },
    async restSecretSetting() {
      return setting;
    },
    async setRestSecretSetting(value) {
      events.push(`setting=${value}`);
      setting = value;
      return { ok: true };
    },
    async readCredentials() {
      events.push("read");
      if (!setting || options.secretReadable === false) return undefined;
      return { key: KEY, secret: SECRET };
    },
    host: ORG_HOST,
  };
  return { org, events, setting: () => setting };
}

function fakeFin(options: { testPasses?: boolean; existing?: string[] } = {}) {
  const filled: Record<string, string> = {};
  const events: string[] = [];
  let tokens = [...(options.existing ?? [])];
  const browser: TokenTransferBrowser = {
    async openNewToken() {
      events.push("open");
      return true;
    },
    async fill(field, value) {
      filled[field] = value;
      events.push(`fill:${field}`);
    },
    async chooseOAuth() {
      events.push("type:oauth");
    },
    async chooseFormEncoded() {
      events.push("format:form");
    },
    async testRequest() {
      events.push("test");
      return options.testPasses === false
        ? { ok: false, message: "Response: 400 Bad Request" }
        : { ok: true, message: 'Response: 200 OK. Found token under the path "access_token".' };
    },
    async save() {
      events.push("save");
      tokens = [...tokens, filled.name ?? ""];
      return true;
    },
    async listTokenNames() {
      return tokens;
    },
    async leave() {
      events.push("leave");
    },
  };
  return { browser, events, filled };
}

const input = {
  appName: "FinCaseStatusApi",
  tokenName: "Salesforce - Case Status API",
  targetOrg: "DevOrg",
  orgType: "developer" as const,
  finBase: FIN,
};

describe("token_transfer", () => {
  it("plans without touching the org or Fin", async () => {
    const org = fakeOrg();
    const fin = fakeFin();
    const plan = await runTokenTransfer(org.org, fin.browser, { ...input, execute: false });
    expect(plan.ok).toBe(true);
    expect(plan.details).toMatchObject({ phase: "plan", app: "FinCaseStatusApi" });
    expect(plan.text).toContain("turns the setting off again");
    expect(org.events).toEqual([]);
    expect(fin.events).toEqual([]);
  });

  it("moves the credentials into Fin, restores the setting, and never returns them", async () => {
    const org = fakeOrg();
    const fin = fakeFin();
    const result = await runTokenTransfer(org.org, fin.browser, { ...input, execute: true });
    expect(result.ok).toBe(true);
    expect(org.events).toEqual(["setting=true", "read", "setting=false", "read"]);
    expect(org.setting()).toBe(false);
    expect(fin.filled).toMatchObject({
      name: "Salesforce - Case Status API",
      url: `https://${ORG_HOST}/services/oauth2/token`,
      clientId: KEY,
      clientSecret: SECRET,
    });
    expect(fin.events).toEqual([
      "open",
      "fill:name",
      "fill:description",
      "type:oauth",
      "fill:url",
      "format:form",
      "fill:clientId",
      "fill:clientSecret",
      "test",
      "save",
      "leave",
    ]);
    const output = JSON.stringify(result);
    expect(output).not.toContain(KEY);
    expect(output).not.toContain(SECRET);
    expect(result.details).toMatchObject({ phase: "execute", saved: true, settingRestored: true });
  });

  it("judges the save by Fin's token list, not by the page Fin lands on", async () => {
    // Found live: after Save, Fin opens the new token's own page, so a
    // "back on the list" check reported a failure for a token that was saved.
    const landedElsewhere = fakeFin();
    landedElsewhere.browser.save = async () => {
      landedElsewhere.events.push("save");
      return false; // the page check did not match…
    };
    const realList = landedElsewhere.browser.listTokenNames;
    let listed = 0;
    landedElsewhere.browser.listTokenNames = async () =>
      ++listed === 1 ? realList() : [...(await realList()), input.tokenName];
    const ok = await runTokenTransfer(fakeOrg().org, landedElsewhere.browser, {
      ...input,
      execute: true,
    });
    expect(ok.ok).toBe(true);
    expect(ok.details).toMatchObject({ saved: true });

    // …and a page that looks right is not enough when the token is not listed.
    const notListed = fakeFin();
    notListed.browser.listTokenNames = async () => [];
    const bad = await runTokenTransfer(fakeOrg().org, notListed.browser, {
      ...input,
      execute: true,
    });
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain("not in Fin's token list");
  });

  it("restores the setting and saves nothing when Fin's test request fails", async () => {
    const org = fakeOrg();
    const fin = fakeFin({ testPasses: false });
    const result = await runTokenTransfer(org.org, fin.browser, { ...input, execute: true });
    expect(result.ok).toBe(false);
    expect(fin.events).not.toContain("save");
    expect(org.setting()).toBe(false);
    expect(result.text).toContain("400");
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("restores the setting when turning it on timed out but applied later", async () => {
    // Found live: the Metadata API client timed out, the deploy stayed queued,
    // and the setting turned on after the runbook had given up.
    const org = fakeOrg();
    const real = org.org.setRestSecretSetting;
    let first = true;
    org.org.setRestSecretSetting = async (value) => {
      if (value && first) {
        first = false;
        await real(true); // applied server-side…
        return { ok: false, error: "Metadata API request failed: The client has timed out." };
      }
      return real(value);
    };
    const fin = fakeFin();
    const result = await runTokenTransfer(org.org, fin.browser, { ...input, execute: true });
    expect(result.ok).toBe(false);
    expect(fin.events).not.toContain("open");
    expect(org.setting()).toBe(false);
    expect(result.details).toMatchObject({ settingRestored: true });
    expect(result.text).toContain("timed out");
  });

  it("reports an unverified setting loudly when it cannot be turned off", async () => {
    const org = fakeOrg();
    const real = org.org.setRestSecretSetting;
    org.org.setRestSecretSetting = async (value) =>
      value
        ? real(true)
        : { ok: false, error: "Metadata API request failed: The client has timed out." };
    const result = await runTokenTransfer(org.org, fakeFin().browser, { ...input, execute: true });
    expect(result.ok).toBe(false);
    expect(result.details).toMatchObject({ settingRestored: false });
    expect(result.text).toContain("Turn it off in Setup");
  });

  it("leaves an already-on setting on (it was not SF Fin's to change)", async () => {
    const org = fakeOrg({ setting: true });
    const fin = fakeFin();
    const result = await runTokenTransfer(org.org, fin.browser, { ...input, execute: true });
    expect(result.ok).toBe(true);
    expect(org.events.filter((e) => e.startsWith("setting="))).toEqual([]);
    expect(result.text).toContain("was already on");
  });

  it("refuses a missing app, a name Fin already uses, and production orgs", async () => {
    const missing = await runTokenTransfer(fakeOrg({ apps: 0 }).org, fakeFin().browser, {
      ...input,
      execute: true,
    });
    expect(missing.details).toMatchObject({ phase: "refused", code: "app_not_found" });
    const taken = fakeFin({ existing: ["Salesforce - Case Status API"] });
    const dup = await runTokenTransfer(fakeOrg().org, taken.browser, { ...input, execute: true });
    expect(dup.details).toMatchObject({ phase: "refused", code: "token_name_taken" });
    expect(taken.events).not.toContain("open");
    const prod = fakeOrg();
    const blocked = await runTokenTransfer(prod.org, fakeFin().browser, {
      ...input,
      orgType: "production",
      execute: true,
    });
    expect(blocked.details).toMatchObject({ phase: "refused", code: "production" });
    expect(prod.events).toEqual([]);
  });
});

describe("token_transfer browser: Fin's Test request result", () => {
  it("reads Fin's real snapshot line, whose quotes are escaped", async () => {
    const { testRequestOutcome } = await import("../lib/salesforce/token-transfer-browser.ts");
    // Exact shape observed live in the accessibility snapshot.
    const passed =
      '        - StaticText "Response: 200 OK. Found token under the path \\"access_token\\"."';
    expect(testRequestOutcome(passed)).toEqual({
      ok: true,
      message: 'Response: 200 OK. Found token under the path "access_token".',
    });
    const failed = '        - StaticText "Response: 400 Bad Request"';
    expect(testRequestOutcome(failed)).toMatchObject({
      ok: false,
      message: "Response: 400 Bad Request",
    });
    // 200 without a token is not a pass.
    expect(testRequestOutcome('- StaticText "Response: 200 OK. No token found."').ok).toBe(false);
    expect(testRequestOutcome("")).toMatchObject({ ok: false, message: "no response shown" });
  });
});

describe("token_transfer browser: every fill is checked", () => {
  /**
   * Fake agent-browser that behaves like Fin's form: the title field has a
   * placeholder and no label, so `find label "Enter a token title"` fills
   * nothing (the live bug) while `find placeholder` works.
   */
  function fakeAgentBrowser() {
    const values: Record<string, string> = {};
    const calls: string[][] = [];
    const spawn = async (args: string[], options: { stdin?: string }) => {
      const commands: string[][] =
        args[0] === "batch" ? (JSON.parse(options.stdin ?? "[]") as string[][]) : [args];
      for (const cmd of commands) {
        calls.push(cmd);
        if (cmd[0] === "find" && cmd.at(-2) === "fill") {
          const [, locator, label] = cmd;
          const ok =
            (locator === "placeholder" && label === "Enter a token title") ||
            (locator === "label" && label !== "Enter a token title");
          if (ok) values[label!] = cmd.at(-1)!;
          if (!ok) return { code: 1, stdout: '[{"success":false}]' };
        }
      }
      if (args[0] === "eval") {
        return { code: 0, stdout: JSON.stringify(JSON.stringify(Object.values(values))) };
      }
      return { code: 0, stdout: "" };
    };
    return { spawn, values, calls };
  }

  it("fills the title by placeholder and refuses to continue when a field stays empty", async () => {
    const { createTokenTransferBrowser } =
      await import("../lib/salesforce/token-transfer-browser.ts");
    const fake = fakeAgentBrowser();
    const browser = createTokenTransferBrowser(fake.spawn as never, FIN);
    await browser.fill("name", "Example token");
    expect(fake.values["Enter a token title"]).toBe("Example token");
    // A label that matches nothing must throw, never pass silently.
    const broken = createTokenTransferBrowser(
      (async () => ({ code: 1, stdout: "" })) as never,
      FIN,
    );
    await expect(broken.fill("description", "x")).rejects.toThrow(/Description/);
  });
});
