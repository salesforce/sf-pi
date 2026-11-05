/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fin admin guard for SF Browser image and editor reads.
 *
 * Text that agent-browser returns is always masked (`runAgentBrowser`), but a
 * screenshot or a raw editor read cannot be masked reliably. So on a Fin
 * admin page that can show a secret, or while a secret-bearing dialog is
 * open, those reads are refused. The page is identified from the URL the
 * browser reports, never from model input.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  FIN_ADMIN_PAGES,
  finAdminLocation,
  snapshotShowsFinSecretSurface,
} from "../../../lib/common/fin-admin-surface.ts";
import { runAgentBrowser } from "./agent-browser.ts";

export interface FinSecretSurfaceCheck {
  blocked: boolean;
  reason?: string;
}

export const FIN_SECRET_SURFACE_MESSAGE =
  "Refused on a Fin admin page that can show a secret. Text from this page is masked, but screenshots and editor reads are not taken here. Copy any key yourself and paste it into the masked /login prompt.";

/**
 * Checks the current page. `currentUrl` may be passed when already known.
 * A page that is not a Fin admin page is never blocked. On a Fin admin page,
 * an unreadable dialog state is treated as blocked.
 */
export async function checkFinSecretSurface(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal | undefined,
  currentUrl?: string,
): Promise<FinSecretSurfaceCheck> {
  const url = currentUrl ?? (await readUrl(pi, cwd, signal));
  const location = finAdminLocation(url);
  if (!location) return { blocked: false };
  if (location.page && FIN_ADMIN_PAGES[location.page].secret) {
    return { blocked: true, reason: `${FIN_ADMIN_PAGES[location.page].label} page` };
  }
  try {
    const snapshot = await runAgentBrowser(pi, ["snapshot", "-i", "-c"], {
      cwd,
      signal,
      timeoutMs: 15_000,
    });
    if (snapshotShowsFinSecretSurface(snapshot.stdout)) {
      return { blocked: true, reason: "secret-bearing dialog open" };
    }
    return { blocked: false };
  } catch {
    // Unknown dialog state on a Fin admin page: refuse rather than guess.
    return { blocked: true, reason: "page state could not be checked" };
  }
}

async function readUrl(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const result = await runAgentBrowser(pi, ["get", "url"], { cwd, signal, timeoutMs: 15_000 });
    return result.stdout.trim();
  } catch {
    return undefined;
  }
}
