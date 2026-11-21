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
