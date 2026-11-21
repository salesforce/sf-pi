/* SPDX-License-Identifier: Apache-2.0 */
/**
 * `sf_fin action='salesforce' operation='connect'`: Fin's Salesforce
 * connection, driven deterministically in the shared SF Pi browser.
 *
 * Fin has no public API for this step, so the runbook follows the exact
 * controls Fin's Connect page renders, and refuses anything else:
 *
 *   1. Fin Connect page → environment card (live = login.salesforce.com, or
 *      test = test.salesforce.com) → dialog → "Connect to Salesforce …".
 *   2. Fin redirects to the target org's login with a startURL for the
 *      OAuth approval page. The runbook only accepts that exact Salesforce
 *      path on the target org's own My Domain, then opens it through a
 *      frontdoor session for the CLI user (the integration user).
 *   3. On the approval page it verifies the app is "Fin for Salesforce" and
 *      the user is the integration user, then clicks Allow.
 *   4. Back in Fin it picks the dedicated Fin user (by display name) under
 *      Salesforce cases settings and saves.
 *
 * Every step checks the page it expects; an unexpected page stops the run
 * with what was seen. OAuth URLs carry a one-time request token, so they are
 * opened through the browser's stdin channel and never returned or logged.
 * The org side is then verified through the API (OauthToken present).
 */

export type FinEnvironmentCard = "live" | "test";

/** Browser surface the runbook needs; the real one wraps agent-browser. */
export interface ConnectBrowser {
  /** Open a URL that is safe to log (Fin admin pages). */
  open(url: string): Promise<void>;
  /** Open a secret-bearing URL (frontdoor / OAuth) without logging it. */
  openSecret(url: string): Promise<void>;
  /** Current URL, unmasked, for host/path checks only. Never returned to tools. */
  url(): Promise<string | undefined>;
  /** Interactive accessibility snapshot (`- role "name" [ref=eN]` lines). */
  snapshot(): Promise<string>;
  click(ref: string): Promise<void>;
  /** Close any extra tabs and return to the first one. */
  closeExtraTabs(): Promise<void>;
  /** URLs of every open tab, unmasked. Never returned to tools. */
  tabUrls(): Promise<string[]>;
  sleep(ms: number): Promise<void>;
}

export interface ConnectPlanInput {
  appId: string;
  region: "us" | "eu" | "au";
  card: FinEnvironmentCard;
  /** Target org My Domain host, e.g. example.my.salesforce.com. */
  orgHost: string;
  /** Username the approval page must name (the CLI user). */
  integrationUsername: string;
  /** Display name of the dedicated Fin user in Fin's picker. */
  finUserName: string;
  /** Build a frontdoor URL for a Salesforce path on the target org. */
  frontdoor(path: string): Promise<string>;
}

export interface ConnectResult {
  ok: boolean;
  steps: string[];
  code?: string;
}

const FIN_HOSTS = { us: "app.intercom.com", eu: "app.eu.intercom.com", au: "app.au.intercom.com" };
const OAUTH_APPROVAL_PATH = "/setup/secur/RemoteAccessAuthorizationPage.apexp";
const CARD_HEADING: Record<FinEnvironmentCard, string> = {
  live: "Deploy Fin in a live organization",
  test: "Connect Fin to a test organization",
};
const CONNECT_BUTTON: Record<FinEnvironmentCard, string> = {
  live: "Connect to Salesforce Production",
  test: "Connect to Salesforce Sandbox",
};
const WAIT_POLLS = 15;
const WAIT_MS = 1_000;

/** Parse `- role "name" [attrs, ref=eN]` snapshot lines. */
export function parseSnapshot(
  snapshot: string,
): Array<{ role: string; name: string; ref?: string; attrs: string; index: number }> {
  const out: Array<{ role: string; name: string; ref?: string; attrs: string; index: number }> = [];
  snapshot.split(/\r?\n/u).forEach((line, index) => {
    const match = /^\s*-\s+([a-zA-Z]+)(?:\s+"((?:[^"\\]|\\.)*)")?(?:\s+\[([^\]]*)\])?/u.exec(line);
    if (!match) return;
    const attrs = match[3] ?? "";
    out.push({
      role: match[1] ?? "",
      name: (match[2] ?? "").replace(/\\"/gu, '"'),
      ref: /ref=(e\d+)/u.exec(attrs)?.[1],
      attrs,
      index,
    });
  });
  return out;
}

/** The OAuth approval startURL Fin's redirect carries, accepted only for the target org. */
export function oauthApprovalPath(url: string | undefined, orgHost: string): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== orgHost.toLowerCase()) {
    return undefined;
  }
  const start =
    parsed.pathname === OAUTH_APPROVAL_PATH
      ? `${parsed.pathname}${parsed.search}`
      : parsed.searchParams.get("startURL");
  if (!start || !start.startsWith(`${OAUTH_APPROVAL_PATH}?`)) return undefined;
  return start;
}

export async function runFinConnect(
  browser: ConnectBrowser,
  input: ConnectPlanInput,
): Promise<ConnectResult> {
  const steps: string[] = [];
  const stop = (code: string, message: string): ConnectResult => ({
    ok: false,
    code,
    steps: [...steps, `❌ ${message}`],
  });
  const finBase = `https://${FIN_HOSTS[input.region]}/a/apps/${input.appId}`;

  // 1. Fin Connect page → environment card → dialog → Connect.
  await browser.open(`${finBase}/standalone/connect`);
  const page = await waitFor(browser, (nodes) =>
    nodes.some((n) => n.role === "heading" && n.name === "Connect Fin to Salesforce"),
  );
  if (!page) return stop("not_connect_page", "Fin's Connect page did not render.");
  const card = cardButton(page, input.card);
  if (!card)
    return stop("card_missing", `Fin's "${CARD_HEADING[input.card]}" card has no Connect button.`);
  await browser.click(card);
  const dialog = await waitFor(browser, (nodes) =>
    nodes.some((n) => n.role === "button" && n.name === CONNECT_BUTTON[input.card]),
  );
  const connect = dialog && findRef(dialog, "button", CONNECT_BUTTON[input.card]);
  if (!connect)
    return stop("dialog_missing", `Fin's dialog did not offer "${CONNECT_BUTTON[input.card]}".`);
  await browser.click(connect);
  steps.push(`✅ Fin: ${CARD_HEADING[input.card]} → ${CONNECT_BUTTON[input.card]}`);

  // 2. Fin redirects to the target org; accept only its OAuth approval path.
  let approvalPath: string | undefined;
  for (let i = 0; i < WAIT_POLLS && !approvalPath; i += 1) {
    await browser.sleep(WAIT_MS);
    for (const url of [await browser.url(), ...(await browser.tabUrls())]) {
      approvalPath ??= oauthApprovalPath(url, input.orgHost);
    }
  }
  if (!approvalPath) {
    return stop(
      "redirect_unexpected",
      `Fin did not redirect to the OAuth approval page on ${input.orgHost}. For a Developer Edition or production org use card='live'; for a sandbox use card='test'.`,
    );
  }
  await browser.closeExtraTabs();
  await browser.openSecret(await input.frontdoor(approvalPath));
  steps.push(`✅ Salesforce: OAuth approval page on ${input.orgHost} (signed in as the CLI user)`);

  // 3. Verify app and user, then Allow.
  const approval = await waitFor(browser, (nodes) =>
    nodes.some((n) => n.role === "heading" && n.name === "Allow Access?"),
  );
  if (!approval) return stop("approval_missing", "Salesforce did not show the Allow Access page.");
  const text = approvalTextOf(await browser.snapshot());
  if (!text.includes("Fin for Salesforce")) {
    return stop("wrong_app", "The approval page is not for the Fin for Salesforce app.");
  }
  if (!text.includes(input.integrationUsername)) {
    return stop("wrong_user", `The approval page is not for ${input.integrationUsername}.`);
  }
  const allow = findRef(approval, "button", "Allow");
  if (!allow) return stop("allow_missing", "The approval page has no Allow button.");
  await browser.click(allow);
  const back = await waitForUrl(browser, (url) => url.startsWith(`${finBase}/`));
  if (!back) return stop("no_return", "Salesforce did not return to Fin after Allow.");
  steps.push(`✅ Salesforce: allowed Fin for Salesforce for ${input.integrationUsername}`);

  // 4. Pick the dedicated Fin user in Salesforce cases settings.
  await browser.open(`${finBase}/settings/channels/salesforce-cases`);
  const settings = await waitFor(browser, (nodes) =>
    nodes.some((n) => n.role === "combobox" && n.name === "Fin Salesforce user"),
  );
  if (!settings) return stop("settings_missing", "Fin's Salesforce cases settings did not render.");
  if (currentPickerValue(await browser.snapshot()) === input.finUserName) {
    steps.push(`✅ Fin: Salesforce user already "${input.finUserName}"`);
    return { ok: true, steps };
  }
  const picker = findRef(settings, "combobox", "Fin Salesforce user");
  if (!picker) return stop("settings_missing", "Fin's Salesforce user picker has no control.");
  await browser.click(picker);
  const options = await waitFor(browser, (nodes) =>
    nodes.some((n) => n.role === "option" && n.name === input.finUserName),
  );
  const option = options?.find(
    (n) => n.role === "option" && n.name === input.finUserName && !n.attrs.includes("disabled"),
  );
  if (!option?.ref) {
    return stop(
      "fin_user_missing",
      `Fin does not list "${input.finUserName}" as a selectable Service Cloud user.`,
    );
  }
  await browser.click(option.ref);
  const ready = await waitFor(browser, (nodes) =>
    nodes.some((n) => n.role === "button" && n.name === "Save" && !n.attrs.includes("disabled")),
  );
  const save = ready?.find(
    (n) => n.role === "button" && n.name === "Save" && !n.attrs.includes("disabled"),
  );
  if (!save?.ref) return stop("save_missing", "Fin's Save button did not enable.");
  await browser.click(save.ref);
  const saved = await waitFor(browser, (nodes) =>
    nodes.some((n) => n.role === "heading" && n.name === "Select Fin Salesforce user Done"),
  );
  if (!saved) return stop("save_unverified", "Fin did not mark the Salesforce user step Done.");
  steps.push(`✅ Fin: Salesforce user set to "${input.finUserName}"`);
  return { ok: true, steps };
}

function cardButton(
  nodes: ReturnType<typeof parseSnapshot>,
  card: FinEnvironmentCard,
): string | undefined {
  const heading = nodes.find((n) => n.role === "heading" && n.name === CARD_HEADING[card]);
  if (!heading) return undefined;
  return nodes.find(
    (n) => n.index > heading.index && n.role === "button" && n.name === "Connect" && n.ref,
  )?.ref;
}

function findRef(
  nodes: ReturnType<typeof parseSnapshot>,
  role: string,
  name: string,
): string | undefined {
  return nodes.find((n) => n.role === role && n.name.trim() === name && n.ref)?.ref;
}

function approvalTextOf(snapshot: string): string {
  return snapshot
    .split(/\r?\n/u)
    .map((line) => /"((?:[^"\\]|\\.)*)"/u.exec(line)?.[1] ?? "")
    .join(" ");
}

function currentPickerValue(snapshot: string): string | undefined {
  const line = snapshot.split(/\r?\n/u).find((l) => /combobox "Fin Salesforce user"/u.test(l));
  return line ? /\]:\s*(.+)$/u.exec(line)?.[1]?.trim() : undefined;
}

async function waitFor(
  browser: ConnectBrowser,
  ready: (nodes: ReturnType<typeof parseSnapshot>) => boolean,
): Promise<ReturnType<typeof parseSnapshot> | undefined> {
  for (let i = 0; i < WAIT_POLLS; i += 1) {
    const nodes = parseSnapshot(await browser.snapshot());
    if (ready(nodes)) return nodes;
    await browser.sleep(WAIT_MS);
  }
  return undefined;
}

async function waitForUrl(
  browser: ConnectBrowser,
  ready: (url: string) => boolean,
): Promise<boolean> {
  for (let i = 0; i < WAIT_POLLS; i += 1) {
    const url = await browser.url();
    if (url && ready(url)) return true;
    await browser.sleep(WAIT_MS);
  }
  return false;
}
