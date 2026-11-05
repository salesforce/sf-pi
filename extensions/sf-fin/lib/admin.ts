/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fin admin web pages, opened in the shared SF Pi browser.
 *
 * SF Fin opens only verified admin pages, only for the app id its workspace
 * profile proved, and verifies after navigation that the browser landed on
 * that same app. SF Browser masks every page snapshot and refuses screenshots
 * and editor reads on pages that can show a secret. Sign-in is always done by
 * the human in a visible browser window; SF Pi never types a Fin password.
 *
 * Runbooks here navigate and read. Changes in Fin (generating a key,
 * publishing a connector, going live) are separate, Guardrail-mediated work.
 */
import type { ExecFn } from "../../../lib/common/sf-environment/detect.ts";
import {
  FIN_ADMIN_PAGE_IDS,
  FIN_ADMIN_PAGES,
  finAdminLocation,
  finAdminPageUrl,
  finAdminSignInUrl,
  isFinAdminSignedOut,
  maskFinSecrets,
  type FinAdminPageId,
  type FinAdminRegion,
} from "../../../lib/common/fin-admin-surface.ts";
import type { WorkspaceProfile } from "./workspaces.ts";

/** Same shared session SF Browser uses; SF Browser stays self-contained. */
const SF_PI_BROWSER_SESSION = "sf-pi";
const OPEN_TIMEOUT_MS = 60_000;
const READ_TIMEOUT_MS = 20_000;
/** Fin renders inside a shadow root, so readiness is read from the snapshot. */
const READY_POLLS = 10;
const READY_POLL_MS = 700;

export type AdminSleep = (ms: number) => Promise<void>;

export type AdminRunner = (
  args: string[],
  options: { timeoutMs: number; ownerOnlyFiles?: boolean },
) => Promise<{ stdout: string; stderr: string; code: number }>;

export interface AdminRequest {
  operation: "pages" | "open" | "read" | "sign_in";
  page?: string;
}

export interface AdminResult {
  ok: boolean;
  text: string;
  details: Record<string, unknown>;
}

/** What each verified page is for, and what to look at once it is open. */
const PAGE_GUIDE: Record<FinAdminPageId, { useFor: string; read: string[] }> = {
  "agent-api": {
    useFor: "Fin Agent API status and key management",
    read: ["Live", "Manage API key", "Workflows"],
  },
  "api-tokens": {
    useFor: "Personal API tokens (the token /login sf-fin uses)",
    read: ["Create API token", "Revoke"],
  },
  "data-connectors": {
    useFor: "Data connector drafts and their status",
    read: ["Draft", "Live", "Needs attention", "New"],
  },
  "help-centers": {
    useFor: "Help Center sites and whether each is live",
    read: ["Not live", "Live", "New Help Center"],
  },
  "salesforce-cases": {
    useFor: "Fin for Salesforce cases: connection checklist",
    read: ["Connect to Salesforce", "Required", "Go live in production"],
  },
  "workspace-tokens": {
    useFor: "Workspace authentication tokens used by integrations",
    read: ["Add token", "No authentication tokens yet"],
  },
};

export function isAdminPageId(value: string | undefined): value is FinAdminPageId {
  return FIN_ADMIN_PAGE_IDS.includes(value as FinAdminPageId);
}

/** Default runner: shared SF Pi browser, headless; sign-in opens a window. */
export function createAdminRunner(exec: ExecFn, cwd?: string): AdminRunner {
  return async (args, options) => {
    const browserArgs = [
      "--session",
      SF_PI_BROWSER_SESSION,
      "--session-name",
      SF_PI_BROWSER_SESSION,
      ...args,
    ];
    // A launch that will hold a Fin login runs under umask 077, so the
    // browser's saved-login file and daemon files are created owner-only.
    // Arguments go through "$@", never into the shell string.
    const result = options.ownerOnlyFiles
      ? await exec("sh", ["-c", 'umask 077; exec agent-browser "$@"', "sh", ...browserArgs], {
          cwd,
          timeout: options.timeoutMs,
        })
      : await exec("agent-browser", browserArgs, { cwd, timeout: options.timeoutMs });
    return {
      stdout: maskFinSecrets(result.stdout ?? ""),
      stderr: maskFinSecrets(result.stderr ?? ""),
      code: result.code ?? -1,
    };
  };
}

export async function runAdmin(
  request: AdminRequest,
  profile: WorkspaceProfile,
  run: AdminRunner,
  sleep: AdminSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<AdminResult> {
  if (request.operation === "pages") return listPages(profile);
  const identity = boundIdentity(profile);
  if (identity.ok === false) return identity.result;
  const { appId, region } = identity;

  if (request.operation === "sign_in") return signIn(region, run);

  if (!isAdminPageId(request.page)) {
    return fail(
      `Pass page=<id>. Verified pages: ${FIN_ADMIN_PAGE_IDS.join(", ")}.`,
      "unknown_page",
    );
  }
  const page = request.page;
  const url = finAdminPageUrl(region, appId, page);
  const opened = await run(["open", url], { timeoutMs: OPEN_TIMEOUT_MS });
  if (opened.code !== 0) {
    return fail(
      `Could not open the Fin admin page: ${firstLine(opened.stderr || opened.stdout)}`,
      "open_failed",
    );
  }
  const landed = await currentLocation(run);
  if (!landed)
    return fail("The browser did not report a Fin admin page after opening it.", "not_fin");
  if (isFinAdminSignedOut(landed)) {
    return fail(
      `Not signed in to Fin in the SF Pi browser. Run /sf-fin admin sign-in (opens a window), sign in yourself, then retry.`,
      "signed_out",
      { region: landed.region },
    );
  }
  if (landed.appId !== appId || landed.region !== region) {
    return fail(
      `The browser is signed in to a different Fin app (${landed.region}/${landed.appId}) than workspace "${profile.name}" (${region}/${appId}). Sign in to the right workspace with /sf-fin admin sign-in.`,
      "app_mismatch",
      { expectedAppId: appId, observedAppId: landed.appId },
    );
  }
  if (landed.page !== page) {
    return fail(
      `Fin redirected away from ${FIN_ADMIN_PAGES[page].label} (landed on ${landed.appPath || "the app home"}). The page may be unavailable for this workspace or plan.`,
      "redirected",
      { landedPath: landed.appPath },
    );
  }

  const base = {
    page,
    label: FIN_ADMIN_PAGES[page].label,
    secretPage: FIN_ADMIN_PAGES[page].secret,
    appId,
    region,
  };
  if (request.operation === "open") {
    return {
      ok: true,
      text: [
        `Opened ${FIN_ADMIN_PAGES[page].label} for workspace "${profile.name}" (${region}, app verified).`,
        FIN_ADMIN_PAGES[page].secret
          ? "This page can show a secret: snapshots are masked, and screenshots and editor reads are refused."
          : undefined,
        "Next: sf_browser_snapshot to read it, or sf_fin action='admin' operation='read' for a compact summary.",
      ]
        .filter(Boolean)
        .join("\n"),
      details: base,
    };
  }

  // Poll until the page's own level-1 heading has rendered (bounded).
  let snapshot = { stdout: "", stderr: "", code: -1 };
  for (let attempt = 0; attempt < READY_POLLS; attempt += 1) {
    snapshot = await run(["snapshot", "-i", "-c"], { timeoutMs: READ_TIMEOUT_MS });
    if (snapshot.code === 0 && pageRendered(snapshot.stdout)) break;
    await sleep(READY_POLL_MS);
  }
  if (snapshot.code !== 0) {
    return fail(
      `Could not read the page: ${firstLine(snapshot.stderr || snapshot.stdout)}`,
      "read_failed",
    );
  }
  if (!pageRendered(snapshot.stdout)) {
    return fail("The page did not finish rendering in time; nothing was reported.", "not_rendered");
  }
  const after = await currentLocation(run);
  if (!after || after.appId !== appId || after.page !== page) {
    return fail("The page changed while it was being read; nothing was reported.", "page_changed");
  }
  const lines = summarizeAdminSnapshot(snapshot.stdout, PAGE_GUIDE[page].read);
  return {
    ok: true,
    text: [
      `${FIN_ADMIN_PAGES[page].label} — workspace "${profile.name}" (${region}, app verified). Text masked.`,
      ...lines.map((line) => `  ${line}`),
    ].join("\n"),
    details: { ...base, lines },
  };
}

function listPages(profile: WorkspaceProfile): AdminResult {
  const rows = FIN_ADMIN_PAGE_IDS.map(
    (id) =>
      `  ${id.padEnd(18)} ${PAGE_GUIDE[id].useFor}${FIN_ADMIN_PAGES[id].secret ? " (secret page: masked, no screenshots)" : ""}`,
  );
  return {
    ok: true,
    text: [
      `Verified Fin admin pages for workspace "${profile.name}":`,
      ...rows,
      "",
      profile.appId
        ? `Open one with sf_fin action='admin' operation='open' page=<id>.`
        : `Run /sf-fin setup first so the workspace's app id is verified.`,
    ].join("\n"),
    details: { pages: FIN_ADMIN_PAGE_IDS, appBound: Boolean(profile.appId) },
  };
}

async function signIn(region: FinAdminRegion, run: AdminRunner): Promise<AdminResult> {
  // Sign-in needs a visible window, and agent-browser only applies --headed
  // when it launches, so the shared session is relaunched once, headed. Its
  // files are created owner-only because they will hold the Fin login.
  await run(["close"], { timeoutMs: READ_TIMEOUT_MS });
  const opened = await run(["--headed", "open", finAdminSignInUrl(region)], {
    timeoutMs: OPEN_TIMEOUT_MS,
    ownerOnlyFiles: true,
  });
  if (opened.code !== 0) {
    return fail(
      `Could not open the Fin sign-in window: ${firstLine(opened.stderr || opened.stdout)}`,
      "open_failed",
    );
  }
  return {
    ok: true,
    text: [
      "Opened Fin sign-in in a browser window. Sign in yourself; SF Pi does not type passwords or read this page.",
      'Tick "Keep me signed in". When you are done, retry the admin action; the browser goes back to headless on its next restart.',
    ].join("\n"),
    details: { region, headed: true },
  };
}

function boundIdentity(
  profile: WorkspaceProfile,
): { ok: true; appId: string; region: FinAdminRegion } | { ok: false; result: AdminResult } {
  if (!profile.appId || !profile.region) {
    return {
      ok: false,
      result: fail(
        `Workspace "${profile.name}" has no verified app id yet. Run /sf-fin setup${profile.name === "default" ? "" : ` ${profile.name}`} first.`,
        "app_unbound",
      ),
    };
  }
  return { ok: true, appId: profile.appId, region: profile.region };
}

async function currentLocation(run: AdminRunner) {
  const result = await run(["get", "url"], { timeoutMs: READ_TIMEOUT_MS });
  if (result.code !== 0) return undefined;
  const line = result.stdout
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .find((value) => value.startsWith("https://"));
  return finAdminLocation(line);
}

/**
 * Compact, masked view: headings, buttons, links, switches, rows, and cells
 * from the main content, dropping the left navigation and the Messenger
 * widget. `focus` terms are kept even when deeper in the tree.
 */
export function summarizeAdminSnapshot(snapshot: string, focus: string[] = []): string[] {
  const NAV =
    /^- (?:generic|link) "(?:Get started|Connect|Operator|Train|Content|Attributes|Guidance|Data|Escalation|Procedures|Skills|Test|Batch Test|Evals|Deploy|Fin Agent API|Salesforce cases|Fin Messenger|Voice|Copilot|Analyze|Performance|Recommendations|Topics Explorer|Trends|Incidents|Custom Report|Monitors|Conversations|Changelog|Settings|Search ⌘ K)"/u;
  const KEEP = /^(?:heading|button|link|switch|checkbox|cell|textbox|dialog|combobox)\b/u;
  const out: string[] = [];
  for (const raw of maskFinSecrets(snapshot).split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || NAV.test(line) || /Intercom Messenger|Claim \d+% off/u.test(line)) continue;
    const body = line.replace(/^- /u, "");
    const focused = focus.some((term) => body.includes(term));
    if (!KEEP.test(body) && !focused) continue;
    const compact = body
      .replace(/\s*\[([^\]]*\bref=e\d+[^\]]*)\]/u, (_all, attrs: string) => {
        const flags = attrs
          .split(/,\s*/u)
          .filter((attr) => /^(?:expanded=true|disabled|checked=true)$/u.test(attr));
        return flags.length ? ` [${flags.join(", ")}]` : "";
      })
      .replace(/\s+/gu, " ")
      .trim();
    // Unlabelled controls (icon buttons, bare links) say nothing useful.
    if (/^(?:button|link)$/u.test(compact)) continue;
    if (!out.includes(compact)) out.push(compact);
    if (out.length >= 40) break;
  }
  return out;
}

/** A level-1 heading other than the Settings breadcrumb means content rendered. */
function pageRendered(snapshot: string): boolean {
  return /heading "(?!Settings")[^"]+" \[level=1/u.test(snapshot);
}

function fail(text: string, code: string, extra: Record<string, unknown> = {}): AdminResult {
  return { ok: false, text, details: { code, ...extra } };
}

function firstLine(value: string): string {
  return (value.split(/\r?\n/u).find((line) => line.trim()) ?? "unknown error")
    .trim()
    .slice(0, 200);
}
