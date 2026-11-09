/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior Proofs for the Pi-persisted Fin admin sign-in (synthetic cookies only). */
import { describe, expect, it } from "vitest";
import {
  browserSigninProviderId,
  createFinBrowserSigninProvider,
  pickSigninCookies,
  readSigninCredential,
  restoreCommands,
  signinExpired,
  toSigninCredential,
  type BrowserCookie,
  type SigninBrowser,
} from "../lib/browser-signin.ts";
import { EventEmitter } from "node:events";
import path from "node:path";
import type { AgentBrowserContext } from "../lib/agent-browser-command.ts";
import {
  createSigninBrowser,
  createSpawnAgentBrowser,
  parseCookieOutput,
} from "../lib/signin-browser.ts";
import type { WorkspaceProfile } from "../lib/workspaces.ts";

const NOW_S = 1_900_000_000;
const APP = "abc123";
const PROFILE: WorkspaceProfile = { name: "default", kind: "test", appId: APP, region: "us" };
const REMEMBER = `synthetic-remember-${"a".repeat(6)}`;
const SESSION = `synthetic-session-${"b".repeat(6)}`;
const SIGNED_IN: BrowserCookie[] = [
  {
    name: "remember_admin_token",
    value: REMEMBER,
    domain: "app.intercom.com",
    expires: NOW_S + 13 * 86400,
  },
  {
    name: "_intercom_session",
    value: SESSION,
    domain: "app.intercom.com",
    expires: NOW_S + 4 * 86400,
  },
  { name: "gtm_id", value: "analytics", domain: ".intercom.com", expires: NOW_S + 365 * 86400 },
  {
    name: "remember_admin_token",
    value: "other-region",
    domain: "app.eu.intercom.com",
    expires: NOW_S + 86400,
  },
];

function interaction() {
  const notes: string[] = [];
  return {
    notes,
    value: {
      signal: new AbortController().signal,
      prompt: async () => "",
      notify: (event: { message?: string }) => notes.push(event.message ?? ""),
    },
  };
}

/** Browser that reports the sign-in page `signedInAfter` times, then `landing`. */
function fakeBrowser(landing: string, signedInAfter = 1, cookies = SIGNED_IN) {
  const log: string[] = [];
  const batches: string[][][] = [];
  let polls = 0;
  const browser: SigninBrowser = {
    openSignIn: async (url) => {
      log.push(`open ${url}`);
    },
    currentUrl: async () => {
      polls += 1;
      return polls > signedInAfter ? landing : "https://app.intercom.com/admins/sign_in";
    },
    cookies: async () => {
      log.push("cookies");
      return cookies;
    },
    batch: async (commands) => {
      batches.push(commands);
      log.push(`batch ${commands.map((c) => c.slice(0, 3).join(" ")).join(" | ")}`);
      return true;
    },
    close: async () => {
      log.push("close");
    },
  };
  return { browser, log, batches };
}

function provider(browser: SigninBrowser, profile: WorkspaceProfile | undefined = PROFILE) {
  return createFinBrowserSigninProvider({
    profile: () => profile,
    browser: () => browser,
    sleep: async () => undefined,
    now: () => NOW_S * 1000,
  });
}

describe("Fin browser sign-in login", () => {
  it("waits for the human, keeps only this region's two sign-in cookies, then clears and closes", async () => {
    const fake = fakeBrowser(`https://app.intercom.com/a/apps/${APP}/home`, 3);
    const auth = provider(fake.browser).auth.oauth!;
    const ui = interaction();
    const credential = await auth.login(ui.value as never);

    expect(fake.log[0]).toBe("open https://app.intercom.com/admins/sign_in");
    const stored = readSigninCredential(credential)!;
    expect(stored.region).toBe("us");
    expect(stored.appId).toBe(APP);
    expect(stored.cookies.map((c) => [c.name, c.value])).toEqual([
      ["remember_admin_token", REMEMBER],
      ["_intercom_session", SESSION],
    ]);
    // Expiry follows Fin's remember cookie, so Pi reports it as expired with Fin.
    expect(credential.expires).toBe((NOW_S + 13 * 86400) * 1000);
    // Removed from the browser, and the window closed, after capture.
    expect(fake.log.slice(-2)).toEqual([
      "batch cookies set remember_admin_token | cookies set _intercom_session",
      "close",
    ]);
    expect(ui.notes.join(" ")).toMatch(/never sees your password/);
  });

  it("refuses a sign-in to a different app or region, and saves nothing", async () => {
    for (const landing of [
      "https://app.intercom.com/a/apps/zzz999/home",
      `https://app.eu.intercom.com/a/apps/${APP}/home`,
    ]) {
      const fake = fakeBrowser(landing);
      await expect(
        provider(fake.browser).auth.oauth!.login(interaction().value as never),
      ).rejects.toThrow(/different Fin app[\s\S]*Nothing was saved/);
      expect(fake.log).not.toContain("cookies");
      expect(fake.log.at(-1)).toBe("close");
    }
  });

  it("requires a workspace with a verified app id before opening any window", async () => {
    const fake = fakeBrowser(`https://app.intercom.com/a/apps/${APP}/home`);
    await expect(
      provider(fake.browser, { name: "default", kind: "test" }).auth.oauth!.login(
        interaction().value as never,
      ),
    ).rejects.toThrow(/no verified app id/);
    expect(fake.log).toEqual([]);
  });

  it("fails when signed in but no sign-in cookie exists, and still clears", async () => {
    const fake = fakeBrowser(`https://app.intercom.com/a/apps/${APP}/home`, 1, [SIGNED_IN[2]!]);
    await expect(
      provider(fake.browser).auth.oauth!.login(interaction().value as never),
    ).rejects.toThrow(/cookies were not found/);
    expect(fake.log.at(-1)).toBe("close");
    expect(fake.batches).toHaveLength(1);
  });

  it("never refreshes on its own: an expired sign-in needs the human again", async () => {
    const auth = provider(fakeBrowser("x").browser).auth.oauth!;
    await expect(auth.refresh({} as never, new AbortController().signal)).rejects.toThrow(
      /run \/login sf-fin-browser/,
    );
  });
});

describe("pickSigninCookies", () => {
  it("takes only the region's admin host cookies, whatever the order", () => {
    const shuffled: BrowserCookie[] = [
      {
        name: "remember_admin_token",
        value: "eu-value",
        domain: "app.eu.intercom.com",
        expires: NOW_S + 9,
      },
      {
        name: "_intercom_session",
        value: "parent-domain",
        domain: ".intercom.com",
        expires: NOW_S + 9,
      },
      {
        name: "remember_admin_token",
        value: "lookalike",
        domain: "app.intercom.com.example.net",
        expires: NOW_S + 9,
      },
      ...SIGNED_IN,
    ];
    expect(pickSigninCookies(shuffled, "us").map((c) => c.value)).toEqual([REMEMBER, SESSION]);
    expect(pickSigninCookies(shuffled, "eu").map((c) => c.value)).toEqual(["eu-value"]);
    expect(pickSigninCookies(shuffled, "au")).toEqual([]);
  });
});

describe("stored sign-in", () => {
  it("names one Pi sign-in per workspace", () => {
    expect(browserSigninProviderId("default")).toBe("sf-fin-browser");
    expect(browserSigninProviderId("prod")).toBe("sf-fin-browser-prod");
  });

  it("is a valid Pi OAuth credential, and reads back only well-formed cookies", () => {
    const credential = toSigninCredential(
      { region: "us", appId: APP, cookies: pickSigninCookies(SIGNED_IN, "us") },
      NOW_S * 1000,
    );
    expect(credential).toMatchObject({ type: "oauth" });
    expect(typeof credential.access).toBe("string");
    expect(typeof credential.refresh).toBe("string");
    expect(Number.isFinite(credential.expires)).toBe(true);

    expect(readSigninCredential({ ...credential, region: "mars" })).toBeUndefined();
    expect(
      readSigninCredential({
        ...credential,
        cookies: [{ name: "gtm_id", value: "x", expires: 1 }],
      }),
    ).toBeUndefined();
    expect(readSigninCredential(undefined)).toBeUndefined();
  });

  it("restores only unexpired cookies, as HttpOnly + Secure for the region host", () => {
    const commands = restoreCommands(
      {
        region: "au",
        cookies: [
          { name: "remember_admin_token", value: REMEMBER, expires: NOW_S + 10 },
          { name: "_intercom_session", value: SESSION, expires: NOW_S - 10 },
        ],
      },
      NOW_S,
    );
    expect(commands).toEqual([
      [
        "cookies",
        "set",
        "remember_admin_token",
        REMEMBER,
        "--url",
        "https://app.au.intercom.com/",
        "--httpOnly",
        "--secure",
        "--sameSite",
        "Lax",
        "--expires",
        String(NOW_S + 10),
      ],
    ]);
  });

  it("is expired once no cookie outlives the next minute", () => {
    const at = (offset: number) => ({
      region: "us" as const,
      cookies: [
        { name: "remember_admin_token" as const, value: REMEMBER, expires: NOW_S + offset },
      ],
    });
    expect(signinExpired(at(3600), NOW_S)).toBe(false);
    expect(signinExpired(at(30), NOW_S)).toBe(true);
  });
});

describe("agent-browser boundary", () => {
  it("sends cookie values only on stdin, never in argv", async () => {
    const calls: Array<{ args: string[]; stdin?: string; ownerOnlyFiles?: boolean }> = [];
    const browser = createSigninBrowser(async (args, options) => {
      calls.push({ args, ...options });
      return { code: 0, stdout: "" };
    });
    await browser.batch(
      restoreCommands({
        region: "us",
        cookies: [{ name: "remember_admin_token", value: REMEMBER, expires: 0 }],
      }),
    );
    expect(calls[0]!.args).toEqual(["batch", "--json", "--omit-command", "--bail"]);
    expect(calls[0]!.args.join(" ")).not.toContain(REMEMBER);
    expect(calls[0]!.stdin).toContain(REMEMBER);
  });

  it("opens sign-in headed with owner-only files, after closing the headless browser", async () => {
    const calls: Array<{ args: string[]; ownerOnlyFiles?: boolean }> = [];
    const browser = createSigninBrowser(async (args, options) => {
      calls.push({ args, ownerOnlyFiles: options.ownerOnlyFiles });
      return { code: 0, stdout: "" };
    });
    await browser.openSignIn("https://app.intercom.com/admins/sign_in");
    expect(calls).toEqual([
      { args: ["close"], ownerOnlyFiles: undefined },
      {
        args: ["--headed", "open", "https://app.intercom.com/admins/sign_in"],
        ownerOnlyFiles: true,
      },
    ]);
  });

  it("parses agent-browser cookie JSON and ignores junk", () => {
    const json = JSON.stringify({
      success: true,
      data: {
        cookies: [{ name: "a", value: "1", domain: "app.intercom.com", expires: 5 }, { name: 3 }],
      },
    });
    expect(parseCookieOutput(`[agent-browser] restore: loaded\n${json}`)).toEqual([
      { name: "a", value: "1", domain: "app.intercom.com", expires: 5 },
    ]);
    expect(parseCookieOutput("not json")).toEqual([]);
  });
});

describe("agent-browser spawn on Windows", () => {
  // The shim points at the native exe; injected so this runs on any runner.
  const W = path.win32;
  const PREFIX = W.join("C:\\", "Users", "dev", "AppData", "Roaming", "npm");
  const EXE = W.join(PREFIX, "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
  const SHIM = W.join(PREFIX, "agent-browser.cmd");
  const files: Record<string, string> = {
    [SHIM]: String.raw`"%~dp0node_modules\agent-browser\bin\agent-browser-win32-x64.exe" %*`,
    [EXE]: "",
  };
  const ctx: AgentBrowserContext = {
    platform: "win32",
    env: { PATH: PREFIX },
    exists: (f) => Object.keys(files).some((k) => k.toLowerCase() === f.toLowerCase()),
    readText: (f) => files[Object.keys(files).find((k) => k.toLowerCase() === f.toLowerCase())!]!,
    nodePath: "node.exe",
  };

  function recordingSpawn() {
    const calls: Array<[string, string[]]> = [];
    const spawnFn = ((command: string, args: string[]) => {
      calls.push([command, args]);
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { end: () => void };
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stdin = { end: () => queueMicrotask(() => child.emit("close", 0)) };
      child.kill = () => {};
      return child;
    }) as unknown as typeof import("node:child_process").spawn;
    return { calls, spawnFn };
  }

  it("reads the URL and cookies through the resolved exe, not the bare name", async () => {
    const { calls, spawnFn } = recordingSpawn();
    const browser = createSigninBrowser(createSpawnAgentBrowser(ctx, spawnFn));
    await browser.currentUrl();
    await browser.cookies();
    expect(calls.map(([command]) => command)).toEqual([EXE, EXE]);
    expect(calls[0]![1]).toEqual(["--session", "sf-pi", "--session-name", "sf-pi", "get", "url"]);
    expect(calls[1]![1].slice(-3)).toEqual(["cookies", "get", "--json"]);
  });

  it("opens the sign-in window without sh on Windows", async () => {
    const { calls, spawnFn } = recordingSpawn();
    await createSigninBrowser(createSpawnAgentBrowser(ctx, spawnFn)).openSignIn(
      "https://app.intercom.com/admins/sign_in",
    );
    expect(calls.map(([command]) => command)).toEqual([EXE, EXE]);
    expect(calls[1]![1].slice(-3)).toEqual([
      "--headed",
      "open",
      "https://app.intercom.com/admins/sign_in",
    ]);
  });
});
