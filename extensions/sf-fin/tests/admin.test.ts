/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior Proofs for Fin admin pages in the shared SF Pi browser (synthetic ids). */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 as winPath } from "node:path";
import type { AgentBrowserContext } from "../lib/agent-browser-command.ts";
import { describe, expect, it } from "vitest";
import {
  createAdminRunner,
  runAdmin,
  summarizeAdminSnapshot,
  type AdminRunner,
  type AdminSignin,
} from "../lib/admin.ts";
import { createFinService } from "../lib/service.ts";
import { addWorkspace, bindWorkspaceIdentity, createWorkspaceStore } from "../lib/workspaces.ts";
import type { WorkspaceProfile } from "../lib/workspaces.ts";
import type { SigninBrowser } from "../lib/browser-signin.ts";

const APP = "abc123";
const BOUND: WorkspaceProfile = { name: "default", kind: "test", appId: APP, region: "us" };
// Built at runtime so no key-shaped literal is committed. Synthetic: it
// decodes to "tok:fake_…", not a real credential.
const FAKE_KEY = Buffer.from(`tok:fake_${"0123456789abcdef"}:1:0x${"fake".repeat(4)}`).toString(
  "base64",
);
const noSleep = async () => undefined;
/** Sign-in hooks for direct runAdmin calls: always restored, nothing to clear. */
const SIGNED_IN: AdminSignin = {
  loginId: "sf-fin-browser",
  restore: async () => "restored",
  finish: async () => undefined,
};
const LIVE_COOKIE = {
  name: "remember_admin_token" as const,
  value: `synthetic-${"r".repeat(8)}`,
  expires: Math.floor(Date.now() / 1000) + 7 * 86400,
};

/** Fake sign-in browser: records batches; cookie values only ever go through `batch`. */
function fakeSigninBrowser() {
  const batches: string[][][] = [];
  const browser: SigninBrowser = {
    openSignIn: async () => undefined,
    currentUrl: async () => undefined,
    cookies: async () => [],
    batch: async (commands) => {
      batches.push(commands);
      return true;
    },
    close: async () => undefined,
  };
  return { browser, batches };
}

/**
 * Fake browser: `open` navigates to `landAt(url)` (default: the same URL);
 * `snapshot` returns `snapshots` in order, repeating the last one.
 */
function fakeRunner(options: {
  landAt?: (url: string) => string;
  snapshots?: string[];
  openCode?: number;
}) {
  const calls: Array<{ args: string[]; ownerOnlyFiles?: boolean }> = [];
  let current = "https://app.intercom.com/admins/sign_in";
  let snapshotIndex = 0;
  const snapshots = options.snapshots ?? [
    '- heading "Fin Agent API" [level=1, ref=e1]\n- button "Manage API key" [ref=e2]',
  ];
  const run: AdminRunner = async (args, opts) => {
    calls.push({ args, ownerOnlyFiles: opts.ownerOnlyFiles });
    const op = args[0] === "--headed" ? args.slice(1) : args;
    if (op[0] === "open") {
      current = options.landAt ? options.landAt(op[1]!) : op[1]!;
      return { stdout: "", stderr: "", code: options.openCode ?? 0 };
    }
    if (op[0] === "get" && op[1] === "url") return { stdout: `${current}\n`, stderr: "", code: 0 };
    if (op[0] === "snapshot") {
      const out = snapshots[Math.min(snapshotIndex, snapshots.length - 1)]!;
      snapshotIndex += 1;
      return { stdout: out, stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "", code: 0 };
  };
  return { run, calls };
}

describe("runAdmin navigation", () => {
  it("opens only the verified page URL for the workspace's own app and region", async () => {
    const browser = fakeRunner({});
    const result = await runAdmin(
      { operation: "open", page: "agent-api" },
      BOUND,
      browser.run,
      noSleep,
      SIGNED_IN,
    );
    expect(result.ok).toBe(true);
    const opens = browser.calls.filter((call) => call.args[0] === "open");
    expect(opens).toEqual([
      {
        args: ["open", `https://app.intercom.com/a/apps/${APP}/standalone/deploy/fin-agent-api`],
        ownerOnlyFiles: undefined,
      },
    ]);
  });

  it("refuses unknown pages and unbound workspaces without touching the browser", async () => {
    const browser = fakeRunner({});
    const unknown = await runAdmin(
      { operation: "open", page: "billing" },
      BOUND,
      browser.run,
      noSleep,
      SIGNED_IN,
    );
    expect(unknown.details.code).toBe("unknown_page");
    const unbound = await runAdmin(
      { operation: "open", page: "agent-api" },
      { name: "staging", kind: "test" },
      browser.run,
      noSleep,
      SIGNED_IN,
    );
    expect(unbound.details.code).toBe("app_unbound");
    expect(browser.calls).toEqual([]);
  });

  it("fails closed when the browser lands on another app, region, or a non-Fin page", async () => {
    const otherApp = fakeRunner({ landAt: (u) => u.replace(APP, "zzz999") });
    expect(
      (
        await runAdmin(
          { operation: "read", page: "agent-api" },
          BOUND,
          otherApp.run,
          noSleep,
          SIGNED_IN,
        )
      ).details.code,
    ).toBe("app_mismatch");
    const otherRegion = fakeRunner({
      landAt: (u) => u.replace("app.intercom.com", "app.eu.intercom.com"),
    });
    expect(
      (
        await runAdmin(
          { operation: "read", page: "agent-api" },
          BOUND,
          otherRegion.run,
          noSleep,
          SIGNED_IN,
        )
      ).details.code,
    ).toBe("app_mismatch");
    const notFin = fakeRunner({ landAt: () => "https://example.com/" });
    expect(
      (
        await runAdmin(
          { operation: "read", page: "agent-api" },
          BOUND,
          notFin.run,
          noSleep,
          SIGNED_IN,
        )
      ).details.code,
    ).toBe("not_fin");
    // No page content was read in any of these cases.
    for (const browser of [otherApp, otherRegion, notFin]) {
      expect(browser.calls.some((call) => call.args[0] === "snapshot")).toBe(false);
    }
  });

  it("reports a rejected sign-in (sign-in page) and redirects away from the requested page", async () => {
    const signedOut = fakeRunner({ landAt: () => "https://app.intercom.com/admins/sign_in" });
    expect(
      (
        await runAdmin(
          { operation: "read", page: "agent-api" },
          BOUND,
          signedOut.run,
          noSleep,
          SIGNED_IN,
        )
      ).details.code,
    ).toBe("signin_rejected");
    const redirected = fakeRunner({
      landAt: () => `https://app.intercom.com/a/apps/${APP}/getting-started`,
    });
    expect(
      (
        await runAdmin(
          { operation: "read", page: "agent-api" },
          BOUND,
          redirected.run,
          noSleep,
          SIGNED_IN,
        )
      ).details.code,
    ).toBe("redirected");
  });
});

describe("runAdmin read", () => {
  it("waits for the page heading, then returns a masked compact summary", async () => {
    const browser = fakeRunner({
      snapshots: [
        '- heading "Settings" [level=1, ref=e1]',
        [
          '- generic "Deploy" [ref=e2] clickable [cursor:pointer]',
          '- heading "Fin Agent API" [level=1, ref=e3]',
          '- button "Manage API key" [expanded=false, ref=e4]',
          `- textbox "API key" [ref=e5]: ${FAKE_KEY}`,
          '- button "Open Intercom Messenger" [ref=e6]',
        ].join("\n"),
      ],
    });
    const result = await runAdmin(
      { operation: "read", page: "agent-api" },
      BOUND,
      browser.run,
      noSleep,
      SIGNED_IN,
    );
    expect(result.ok).toBe(true);
    expect(result.text).not.toContain(FAKE_KEY.slice(0, 16));
    expect(result.text).toContain('heading "Fin Agent API"');
    expect(result.text).toContain('button "Manage API key"');
    expect(result.text).not.toContain("Messenger");
    expect(result.text).not.toContain('"Deploy"');
    expect(browser.calls.filter((call) => call.args[0] === "snapshot")).toHaveLength(2);
  });

  it("reports nothing when the page never renders, or changes while reading", async () => {
    const never = fakeRunner({ snapshots: ['- heading "Settings" [level=1, ref=e1]'] });
    // A page title alone (body still loading) is not a rendered page.
    const titleOnly = fakeRunner({ snapshots: ['- heading "Fin Agent API" [level=1, ref=e1]'] });
    expect(
      (
        await runAdmin(
          { operation: "read", page: "agent-api" },
          BOUND,
          titleOnly.run,
          noSleep,
          SIGNED_IN,
        )
      ).details.code,
    ).toBe("not_rendered");
    expect(
      (
        await runAdmin(
          { operation: "read", page: "agent-api" },
          BOUND,
          never.run,
          noSleep,
          SIGNED_IN,
        )
      ).details.code,
    ).toBe("not_rendered");

    let urlReads = 0;
    const base = fakeRunner({});
    const drifting: AdminRunner = async (args, opts) => {
      if (args[0] === "get") {
        urlReads += 1;
        if (urlReads > 1)
          return { stdout: "https://app.intercom.com/a/apps/zzz999/x\n", stderr: "", code: 0 };
      }
      return base.run(args, opts);
    };
    const changed = await runAdmin(
      { operation: "read", page: "agent-api" },
      BOUND,
      drifting,
      noSleep,
      SIGNED_IN,
    );
    expect(changed.details.code).toBe("page_changed");
    expect(changed.text).not.toContain('Fin Agent API"');
  });

  it("summaries keep state flags and drop refs and unlabelled controls", () => {
    expect(
      summarizeAdminSnapshot(
        [
          '- button "Go live in production" [disabled, ref=e1]',
          '- button "Connect to Salesforce" [expanded=true, ref=e2]',
          "- button [ref=e3]",
          "- link [ref=e4]",
        ].join("\n"),
      ),
    ).toEqual([
      'button "Go live in production" [disabled]',
      'button "Connect to Salesforce" [expanded=true]',
    ]);
  });
});

describe("createAdminRunner", () => {
  it("passes arguments through umask 077 without putting them in the shell string", async () => {
    const execs: Array<[string, string[]]> = [];
    // Pin POSIX: the umask launch is the macOS/Linux path (Windows runs the exe directly).
    const posix: AgentBrowserContext = {
      platform: "linux",
      env: { PATH: "/usr/bin" },
      exists: () => false,
      readText: () => "",
      nodePath: "node",
    };
    const run = createAdminRunner(
      async (command, args) => {
        execs.push([command, args]);
        return { stdout: `- textbox "API key": ${FAKE_KEY}`, stderr: "", code: 0 };
      },
      undefined,
      posix,
    );
    const hostile = "https://app.intercom.com/admins/sign_in;rm -rf ~";
    const result = await run(["--headed", "open", hostile], {
      timeoutMs: 1000,
      ownerOnlyFiles: true,
    });
    expect(execs[0]![0]).toBe("sh");
    expect(execs[0]![1].slice(0, 3)).toEqual(["-c", 'umask 077; exec agent-browser "$@"', "sh"]);
    expect(execs[0]![1][1]).not.toContain(hostile);
    expect(execs[0]![1]).toContain(hostile);
    expect(result.stdout).not.toContain(FAKE_KEY.slice(0, 16));

    await run(["get", "url"], { timeoutMs: 1000 });
    expect(execs[1]![0]).toBe("agent-browser");
  });

  it("on Windows runs the exe the npm shim points at, for reads and the sign-in launch", async () => {
    const W = winPath;
    const prefix = W.join("C:\\", "Users", "dev", "AppData", "Roaming", "npm");
    const exe = W.join(
      prefix,
      "node_modules",
      "agent-browser",
      "bin",
      "agent-browser-win32-x64.exe",
    );
    const files: Record<string, string> = {
      [W.join(prefix, "agent-browser.cmd")]:
        String.raw`"%~dp0node_modules\agent-browser\bin\agent-browser-win32-x64.exe" %*`,
      [exe]: "",
    };
    const find = (f: string) => Object.keys(files).find((k) => k.toLowerCase() === f.toLowerCase());
    const ctx: AgentBrowserContext = {
      platform: "win32",
      env: { PATH: prefix },
      exists: (f) => find(f) !== undefined,
      readText: (f) => files[find(f)!]!,
      nodePath: "node.exe",
    };
    const execs: Array<[string, string[]]> = [];
    const run = createAdminRunner(
      async (command, args) => {
        execs.push([command, args]);
        return { stdout: "", stderr: "", code: 0 };
      },
      undefined,
      ctx,
    );
    await run(["get", "url"], { timeoutMs: 1000 });
    await run(["--headed", "open", "https://app.intercom.com/admins/sign_in"], {
      timeoutMs: 1000,
      ownerOnlyFiles: true,
    });
    expect(execs.map(([command]) => command)).toEqual([exe, exe]);
    expect(execs[0]![1].slice(-2)).toEqual(["get", "url"]);
  });
});

describe("service.admin", () => {
  it("uses the requested workspace's bound app id and rejects unknown workspaces", async () => {
    const store = createWorkspaceStore(join(mkdtempSync(join(tmpdir(), "fin-admin-")), "w.json"));
    addWorkspace(store, "staging", "test");
    bindWorkspaceIdentity(store, "staging", {
      appId: "stg456",
      region: "au",
      at: "2026-01-01T00:00:00Z",
    });
    const browser = fakeRunner({});
    const service = createFinService({
      exec: async () => ({ stdout: "", stderr: "", code: 0 }),
      workspaceStore: store,
      adminRunner: browser.run,
      adminSleep: noSleep,
      signinBrowser: fakeSigninBrowser().browser,
      readSignin: () => ({ region: "au", appId: "stg456", cookies: [LIVE_COOKIE] }),
    });
    const opened = await service.admin({
      operation: "open",
      page: "help-centers",
      workspace: "staging",
    });
    expect(opened.ok).toBe(true);
    expect(browser.calls[0]!.args[1]).toBe(
      "https://app.au.intercom.com/a/apps/stg456/settings/helpcenter/all",
    );
    const unknown = await service.admin({
      operation: "open",
      page: "help-centers",
      workspace: "nope",
    });
    expect(unknown.ok).toBe(false);
  });
});

describe("persisted Fin sign-in around admin pages", () => {
  function service(read: () => unknown, browser = fakeRunner({}), signin = fakeSigninBrowser()) {
    const store = createWorkspaceStore(join(mkdtempSync(join(tmpdir(), "fin-signin-")), "w.json"));
    bindWorkspaceIdentity(store, "default", {
      appId: APP,
      region: "us",
      at: "2026-01-01T00:00:00Z",
    });
    return {
      svc: createFinService({
        exec: async () => ({ stdout: "", stderr: "", code: 0 }),
        workspaceStore: store,
        adminRunner: browser.run,
        adminSleep: noSleep,
        signinBrowser: signin.browser,
        readSignin: read as never,
      }),
      browser,
      signin,
    };
  }

  it("restores the saved cookies before the page and clears them after, even on failure", async () => {
    const ok = service(() => ({ region: "us", appId: APP, cookies: [LIVE_COOKIE] }));
    expect((await ok.svc.admin({ operation: "read", page: "agent-api" })).ok).toBe(true);
    expect(ok.signin.batches).toHaveLength(2);
    const [restore, clear] = ok.signin.batches;
    expect(restore![0]).toEqual(expect.arrayContaining(["cookies", "set", "remember_admin_token"]));
    expect(restore![0]).toContain(LIVE_COOKIE.value);
    expect(restore![0]).toContain("https://app.intercom.com/");
    // Leave Fin first, so no open Fin tab can redirect and get a new session
    // cookie; then set each sign-in cookie to an expired, empty value.
    expect(clear![0]).toEqual(["open", "about:blank"]);
    expect(clear!.slice(1).map((cmd) => [cmd[2], cmd[3], cmd.at(-1)])).toEqual([
      ["remember_admin_token", "", "1"],
      ["_intercom_session", "", "1"],
    ]);

    const failing = service(
      () => ({ region: "us", appId: APP, cookies: [LIVE_COOKIE] }),
      fakeRunner({ landAt: (u) => u.replace(APP, "zzz999") }),
    );
    expect((await failing.svc.admin({ operation: "read", page: "agent-api" })).details.code).toBe(
      "app_mismatch",
    );
    expect(failing.signin.batches).toHaveLength(2);
  });

  it("never puts a cookie value in a browser command line or a tool result", async () => {
    const ok = service(() => ({ region: "us", appId: APP, cookies: [LIVE_COOKIE] }));
    const result = await ok.svc.admin({ operation: "read", page: "agent-api" });
    for (const call of ok.browser.calls)
      expect(call.args.join(" ")).not.toContain(LIVE_COOKIE.value);
    expect(JSON.stringify(result)).not.toContain(LIVE_COOKIE.value);
  });

  it("does not touch the browser without a saved, unexpired sign-in, and names the /login fix", async () => {
    const none = service(() => undefined);
    const missing = await none.svc.admin({ operation: "read", page: "agent-api" });
    expect(missing.details).toMatchObject({ code: "signed_out", loginId: "sf-fin-browser" });
    expect(missing.text).toContain("/login sf-fin-browser");
    expect(none.browser.calls).toEqual([]);
    expect(none.signin.batches).toEqual([]);

    const old = service(() => ({
      region: "us",
      appId: APP,
      cookies: [{ ...LIVE_COOKIE, expires: Math.floor(Date.now() / 1000) - 10 }],
    }));
    const expired = await old.svc.admin({ operation: "read", page: "agent-api" });
    expect(expired.details.code).toBe("signin_expired");
    expect(old.browser.calls).toEqual([]);
  });

  it("reports a sign-in Fin rejected, and still clears the cookies", async () => {
    const rejected = service(
      () => ({ region: "us", appId: APP, cookies: [LIVE_COOKIE] }),
      fakeRunner({ landAt: () => "https://app.intercom.com/admins/sign_in" }),
    );
    const result = await rejected.svc.admin({ operation: "read", page: "agent-api" });
    expect(result.details.code).toBe("signin_rejected");
    expect(result.text).toContain("/login sf-fin-browser");
    expect(rejected.signin.batches).toHaveLength(2);
  });

  it("sign_in hands off to /login instead of opening an unsaved window", async () => {
    const svc = service(() => undefined);
    const result = await svc.svc.admin({ operation: "sign_in" });
    expect(result.details).toMatchObject({ handoff: "login", loginId: "sf-fin-browser" });
    expect(svc.browser.calls).toEqual([]);
  });
});
