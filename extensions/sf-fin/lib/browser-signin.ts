/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fin admin browser sign-in, persisted by Pi like the other Fin credentials.
 *
 * `/login sf-fin-browser` (or `sf-fin-browser-<workspace>`) opens the shared SF
 * Pi browser in a window on Fin's sign-in page. The human signs in. SF Fin
 * then captures only Fin's two sign-in cookies and returns them to Pi as an
 * OAuth-shaped credential, so Pi alone stores them and `/logout` removes them.
 *
 * Before each Fin admin page, SF Fin restores the cookies into the browser,
 * and afterwards clears them, so the browser's saved-state file never holds
 * a Fin sign-in. The sign-in lasts until Fin expires its remember cookie
 * (about two weeks after signing in); then `/login` again. Cookie values
 * travel to agent-browser on stdin (batch JSON), never in argv, and are never
 * returned to tools or logs.
 */
import type {
  OAuthCredential,
  OAuthCredentials,
  ProviderAuthInteraction,
} from "@earendil-works/pi-ai";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { getPiAuthStorePath } from "../../../lib/common/pi-auth-status.ts";
import { createAuthOnlyProvider } from "../../../lib/common/auth-only-provider.ts";
import {
  finAdminLocation,
  finAdminSignInUrl,
  FIN_ADMIN_HOSTS,
  type FinAdminRegion,
} from "../../../lib/common/fin-admin-surface.ts";
import { DEFAULT_WORKSPACE, workspaceProviders, type WorkspaceProfile } from "./workspaces.ts";

/** Fin's sign-in cookies. Everything else (analytics, consent) is ignored. */
export const FIN_SIGNIN_COOKIES = ["remember_admin_token", "_intercom_session"] as const;
export type FinSigninCookieName = (typeof FIN_SIGNIN_COOKIES)[number];

export interface FinSigninCookie {
  name: FinSigninCookieName;
  value: string;
  /** Unix seconds; 0 for a browser-session cookie. */
  expires: number;
}

/** Non-secret metadata kept alongside the cookies in the Pi credential. */
interface FinSigninExtra {
  region: FinAdminRegion;
  appId?: string;
  cookies: FinSigninCookie[];
}

export type FinSigninCredential = OAuthCredentials & FinSigninExtra;

/** Raw browser cookie, as agent-browser reports it. */
export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  expires?: number;
}

/**
 * Talks to the shared SF Pi browser. `batch` sends commands as JSON on stdin,
 * so cookie values never appear in argv or process listings.
 */
export interface SigninBrowser {
  openSignIn(url: string): Promise<void>;
  currentUrl(): Promise<string | undefined>;
  cookies(): Promise<BrowserCookie[]>;
  batch(commands: string[][]): Promise<boolean>;
  /** Closes the shared browser (the next SF Pi action relaunches it headless). */
  close(): Promise<void>;
}

export type SigninSleep = (ms: number) => Promise<void>;

const SIGNIN_POLL_MS = 2_000;
/** Ten minutes for the human to finish signing in, including 2FA. */
const SIGNIN_MAX_POLLS = 300;
/** Fallback lifetime when Fin sends only browser-session cookies. */
const SESSION_ONLY_LIFETIME_S = 12 * 60 * 60;

export function browserSigninProviderId(workspace: string): string {
  return workspaceProviders(workspace).browser;
}

/** Picks Fin's sign-in cookies for one region's admin host; ignores the rest. */
export function pickSigninCookies(
  cookies: BrowserCookie[],
  region: FinAdminRegion,
): FinSigninCookie[] {
  const host = FIN_ADMIN_HOSTS[region];
  const picked: FinSigninCookie[] = [];
  for (const name of FIN_SIGNIN_COOKIES) {
    const cookie = cookies.find(
      (candidate) =>
        candidate.name === name &&
        candidate.domain.replace(/^\./u, "") === host &&
        typeof candidate.value === "string" &&
        candidate.value.length > 0,
    );
    if (cookie) {
      picked.push({
        name,
        value: cookie.value,
        expires: cookie.expires && cookie.expires > 0 ? Math.floor(cookie.expires) : 0,
      });
    }
  }
  return picked;
}

/** Pi refreshes an OAuth credential five minutes before `expires`. */
export function signinExpiry(cookies: FinSigninCookie[], nowMs = Date.now()): number {
  const remember = cookies.find((cookie) => cookie.name === "remember_admin_token");
  const latest = Math.max(0, ...cookies.map((cookie) => cookie.expires));
  const seconds = remember?.expires || latest || Math.floor(nowMs / 1000) + SESSION_ONLY_LIFETIME_S;
  return seconds * 1000;
}

export function toSigninCredential(extra: FinSigninExtra, nowMs = Date.now()): OAuthCredential {
  return {
    type: "oauth",
    // OAuth fields are required by Pi's store; the cookies are the secret.
    access: "fin-browser-signin",
    refresh: "fin-browser-signin",
    expires: signinExpiry(extra.cookies, nowMs),
    region: extra.region,
    ...(extra.appId ? { appId: extra.appId } : {}),
    cookies: extra.cookies,
  };
}

/** Reads a stored credential back into cookies, refusing malformed shapes. */
export function readSigninCredential(value: unknown): FinSigninExtra | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const region = record.region;
  if (region !== "us" && region !== "eu" && region !== "au") return undefined;
  if (!Array.isArray(record.cookies)) return undefined;
  const cookies = record.cookies.filter(
    (cookie): cookie is FinSigninCookie =>
      !!cookie &&
      typeof cookie === "object" &&
      FIN_SIGNIN_COOKIES.includes((cookie as FinSigninCookie).name) &&
      typeof (cookie as FinSigninCookie).value === "string" &&
      (cookie as FinSigninCookie).value.length > 0 &&
      typeof (cookie as FinSigninCookie).expires === "number",
  );
  if (!cookies.length) return undefined;
  return {
    region,
    cookies,
    ...(typeof record.appId === "string" ? { appId: record.appId } : {}),
  };
}

/** Batch commands that put the cookies into the browser for the region's host. */
export function restoreCommands(extra: FinSigninExtra, nowS = Date.now() / 1000): string[][] {
  const url = `https://${FIN_ADMIN_HOSTS[extra.region]}/`;
  return extra.cookies
    .filter((cookie) => cookie.expires === 0 || cookie.expires > nowS)
    .map((cookie) => [
      "cookies",
      "set",
      cookie.name,
      cookie.value,
      "--url",
      url,
      "--httpOnly",
      "--secure",
      "--sameSite",
      "Lax",
      ...(cookie.expires > 0 ? ["--expires", String(cookie.expires)] : []),
    ]);
}

/** Batch commands that remove the sign-in cookies from the browser. */
export function clearCommands(region: FinAdminRegion): string[][] {
  const url = `https://${FIN_ADMIN_HOSTS[region]}/`;
  return FIN_SIGNIN_COOKIES.map((name) => [
    "cookies",
    "set",
    name,
    "",
    "--url",
    url,
    "--expires",
    "1",
  ]);
}

export interface SigninControllerOptions {
  workspace?: string;
  /** Reads the workspace profile at login time (region and verified app id). */
  profile: () => WorkspaceProfile | undefined;
  browser: () => SigninBrowser;
  sleep?: SigninSleep;
  now?: () => number;
}

/**
 * Pi sign-in provider for the Fin admin browser of one workspace. Login is
 * the human signing in through a visible window; refresh re-reads Fin's
 * rotated cookies from the browser (Fin rotates `_intercom_session` on use).
 */
export function createFinBrowserSigninProvider(options: SigninControllerOptions) {
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const id = browserSigninProviderId(workspace);
  return createAuthOnlyProvider({
    id,
    name:
      workspace === DEFAULT_WORKSPACE
        ? "SF Fin admin browser sign-in"
        : `SF Fin admin browser sign-in (${workspace})`,
    auth: {
      oauth: {
        name:
          workspace === DEFAULT_WORKSPACE
            ? "Fin admin sign-in (browser window)"
            : `Fin admin sign-in (${workspace}, browser window)`,
        loginLabel: "Sign in to Fin in a browser window",
        login: (interaction) =>
          loginInBrowser(interaction, {
            workspace,
            profile: options.profile(),
            browser: options.browser(),
            sleep,
            now,
          }),
        // Fin's remember cookie cannot be renewed without the human signing in.
        refresh: async () => {
          throw new Error(`The Fin admin sign-in has expired; run /login ${id}.`);
        },
        // Fin admin pages take cookies, not request auth.
        toAuth: async () => ({}),
      },
    },
  });
}

async function loginInBrowser(
  interaction: ProviderAuthInteraction,
  input: {
    workspace: string;
    profile: WorkspaceProfile | undefined;
    browser: SigninBrowser;
    sleep: SigninSleep;
    now: () => number;
  },
): Promise<OAuthCredential> {
  const { profile, browser } = input;
  if (!profile) throw new Error(`Unknown Fin workspace "${input.workspace}".`);
  if (!profile.region || !profile.appId) {
    throw new Error(
      `Workspace "${input.workspace}" has no verified app id yet. Run /sf-fin setup${input.workspace === DEFAULT_WORKSPACE ? "" : ` ${input.workspace}`} first.`,
    );
  }
  const region = profile.region;
  await browser.openSignIn(finAdminSignInUrl(region));
  interaction.notify({
    type: "info",
    message: `A browser window opened on Fin's sign-in page. Sign in there yourself and tick "Keep me signed in". SF Pi never sees your password. Waiting up to 10 minutes…`,
  });
  let observedRegion: FinAdminRegion = region;
  try {
    for (let poll = 0; poll < SIGNIN_MAX_POLLS; poll += 1) {
      interaction.signal.throwIfAborted();
      const location = finAdminLocation(await browser.currentUrl());
      if (location?.appId) {
        observedRegion = location.region;
        if (location.region !== region || location.appId !== profile.appId) {
          throw new Error(
            `Signed in to a different Fin app (${location.region}/${location.appId}) than workspace "${input.workspace}" (${region}/${profile.appId}). Nothing was saved.`,
          );
        }
        const cookies = pickSigninCookies(await browser.cookies(), region);
        if (!cookies.length) {
          throw new Error(
            "Signed in, but Fin's sign-in cookies were not found. Nothing was saved.",
          );
        }
        interaction.notify({ type: "info", message: "Signed in. Pi saved the Fin sign-in." });
        return toSigninCredential({ region, appId: profile.appId, cookies }, input.now());
      }
      await input.sleep(SIGNIN_POLL_MS);
    }
    throw new Error("Timed out waiting for Fin sign-in. Nothing was saved.");
  } finally {
    // Pi now holds the sign-in (or nothing was saved). Remove it from the
    // browser and close the window, so the browser's state file never keeps it.
    await browser.batch(clearCommands(observedRegion)).catch(() => false);
    await browser.close().catch(() => undefined);
  }
}

/** True when no stored cookie can still sign in at `nowS` (Unix seconds). */
export function signinExpired(extra: FinSigninExtra, nowS = Date.now() / 1000): boolean {
  return !extra.cookies.some((cookie) => cookie.expires === 0 || cookie.expires > nowS + 60);
}

/** Reads the stored sign-in from Pi's credential store (read-only). */
export function readStoredSignin(
  workspace: string,
  read: (providerId: string) => unknown = (providerId) =>
    readStoredCredential(providerId, getPiAuthStorePath()),
): FinSigninExtra | undefined {
  return readSigninCredential(read(browserSigninProviderId(workspace)));
}
