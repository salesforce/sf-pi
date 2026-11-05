/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fin admin surface: the shared rules for Fin's web admin in SF Browser.
 *
 * SF Browser drives the admin site; SF Fin owns the runbooks; SF Guardrail
 * binds browser commits on these pages to their Fin workspace. All three use
 * these rules so they agree on what a Fin admin page is, which app it
 * belongs to, and which pages can show a secret.
 *
 * Secrets never leave the browser through SF Pi: text output is masked, and
 * screenshots and editor reads are refused while a secret-bearing page or
 * dialog is showing. Credentials still reach Pi only when the human pastes
 * them into a masked `/login` prompt.
 */

/** Fin's regional admin hosts. HTTPS only, exact host match. */
export const FIN_ADMIN_HOSTS = {
  us: "app.intercom.com",
  eu: "app.eu.intercom.com",
  au: "app.au.intercom.com",
} as const;

export type FinAdminRegion = keyof typeof FIN_ADMIN_HOSTS;

/**
 * Verified Fin admin pages (paths observed live from the admin navigation).
 * `secret` pages can show a credential, so they get no screenshots or editor
 * reads even when the value is hidden behind a reveal button.
 */
export const FIN_ADMIN_PAGES = {
  "agent-api": {
    label: "Fin Agent API (Deploy)",
    path: "standalone/deploy/fin-agent-api",
    secret: true,
  },
  "api-tokens": {
    label: "Personal API tokens",
    path: "settings/personal/authentication",
    secret: true,
  },
  "data-connectors": {
    label: "Data connectors",
    path: "settings/app-settings/data-connectors",
    secret: false,
  },
  "help-centers": {
    label: "All Help Centers",
    path: "settings/helpcenter/all",
    secret: false,
  },
  "salesforce-cases": {
    label: "Salesforce cases (Deploy)",
    path: "standalone/deploy/channel/salesforce/cases",
    secret: false,
  },
  "workspace-tokens": {
    label: "Workspace authentication tokens",
    path: "settings/app-settings/authentication",
    secret: true,
  },
} as const;

export type FinAdminPageId = keyof typeof FIN_ADMIN_PAGES;

export const FIN_ADMIN_PAGE_IDS = Object.keys(FIN_ADMIN_PAGES) as FinAdminPageId[];

const APP_ID_PATTERN = /^[a-z0-9]{4,32}$/u;

export interface FinAdminLocation {
  region: FinAdminRegion;
  /** App id from `/a/apps/<appId>/…`; undefined on sign-in or non-app pages. */
  appId?: string;
  /** Path after `/a/apps/<appId>/`, without query or hash. */
  appPath?: string;
  /** Matching verified page, if any. */
  page?: FinAdminPageId;
}

/** Parses a URL as a Fin admin location, or undefined when it is not one. */
export function finAdminLocation(urlValue: string | undefined): FinAdminLocation | undefined {
  if (!urlValue) return undefined;
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  const host = url.hostname.toLowerCase();
  const region = (Object.keys(FIN_ADMIN_HOSTS) as FinAdminRegion[]).find(
    (candidate) => FIN_ADMIN_HOSTS[candidate] === host,
  );
  if (!region) return undefined;
  const match = /^\/a\/apps\/([^/]+)(?:\/(.*))?$/u.exec(url.pathname);
  const appId = match?.[1] && APP_ID_PATTERN.test(match[1]) ? match[1] : undefined;
  const appPath = appId ? (match?.[2] ?? "").replace(/\/+$/u, "") : undefined;
  const page = appPath
    ? FIN_ADMIN_PAGE_IDS.find((id) => {
        const pagePath = FIN_ADMIN_PAGES[id].path;
        return appPath === pagePath || appPath.startsWith(`${pagePath}/`);
      })
    : undefined;
  return { region, appId, appPath, page };
}

export function isFinAdminUrl(urlValue: string | undefined): boolean {
  return finAdminLocation(urlValue) !== undefined;
}

/** Full HTTPS URL for a verified page in one app. */
export function finAdminPageUrl(
  region: FinAdminRegion,
  appId: string,
  page: FinAdminPageId,
): string {
  if (!APP_ID_PATTERN.test(appId)) throw new Error("Invalid Fin app id.");
  return `https://${FIN_ADMIN_HOSTS[region]}/a/apps/${appId}/${FIN_ADMIN_PAGES[page].path}`;
}

export function finAdminSignInUrl(region: FinAdminRegion): string {
  return `https://${FIN_ADMIN_HOSTS[region]}/admins/sign_in`;
}

/** True on the sign-in page (or any non-app page), where no workspace is open. */
export function isFinAdminSignedOut(location: FinAdminLocation): boolean {
  return location.appId === undefined;
}

/** Labels of dialogs or controls that reveal or hold a Fin secret. */
const SECRET_SURFACE_PATTERN =
  /\b(?:dialog|textbox|region)\s+"(?:[^"]*\b(?:api key|access token|api token|secret|client secret|signing key)\b[^"]*)"/iu;

/**
 * True when a page snapshot shows a secret-bearing surface (for example an
 * open "Manage API key" dialog), so screenshots and editor reads must stop.
 */
export function snapshotShowsFinSecretSurface(snapshot: string): boolean {
  return SECRET_SURFACE_PATTERN.test(snapshot);
}

const MASK = "<masked>";

/** Labels whose value on the same line must never be shown. */
const SECRET_FIELD_VALUE =
  /((?:textbox|cell|StaticText|generic)\s+"[^"]*\b(?:api key|access token|api token|token|secret|client secret|signing key|webhook secret)\b[^"]*"[^\n:]*:\s*)(\S.*)$/gimu;

/** Opaque run without slashes or dots: 32+ chars mixing letters and digits. */
const OPAQUE_RUN =
  /(?<![A-Za-z0-9_+=-])(?=[A-Za-z0-9_+=-]*[0-9])(?=[A-Za-z0-9_+=-]*[A-Za-z])[A-Za-z0-9_+=-]{32,}(?![A-Za-z0-9_+=-])/gu;

/**
 * Base64 run that may contain `/`: 40+ chars with upper, lower, and digits.
 * Fin admin paths are lowercase, so they are not caught.
 */
const BASE64_RUN =
  /(?<![A-Za-z0-9+/=_-])(?=[A-Za-z0-9+/=_-]*[0-9])(?=[A-Za-z0-9+/=_-]*[a-z])(?=[A-Za-z0-9+/=_-]*[A-Z])[A-Za-z0-9+/=_-]{40,}(?![A-Za-z0-9+/=_-])/gu;

/**
 * Masks secret-shaped text: any value printed after a secret-labelled field,
 * `Bearer`/`Basic` credentials, and long opaque runs (keys, tokens,
 * signatures). Dotted placeholders such as `••••` hold no secret and stay.
 */
export function maskFinSecrets(text: string): string {
  return text
    .replace(SECRET_FIELD_VALUE, (_match, prefix: string, value: string) =>
      /^[•*\s]+$/u.test(value) ? `${prefix}${value}` : `${prefix}${MASK}`,
    )
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gu, MASK)
    .replace(BASE64_RUN, MASK)
    .replace(OPAQUE_RUN, MASK);
}
