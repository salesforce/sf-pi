/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Automatic Fin region discovery.
 *
 * A personal API token is accepted only by its workspace's regional API host.
 * SF Fin calls `GET /me` on the US, EU, and AU hosts with the token as a
 * Bearer header (HTTPS, redirects refused, short timeout), stops at the first
 * 200, and reads `app.region` and `app.id_code` from it. A 401 means "not this
 * region". The token never leaves those three fixed Intercom hosts.
 */
import type { FinRegion } from "./types.ts";

export const REGION_HOSTS: Record<FinRegion, string> = {
  us: "https://api.intercom.io",
  eu: "https://api.eu.intercom.io",
  au: "https://api.au.intercom.io",
};

const ORDER: FinRegion[] = ["us", "eu", "au"];
const TIMEOUT_MS = 10_000;

export interface DiscoveredIdentity {
  region: FinRegion;
  appId: string;
  workspaceName?: string;
  adminName?: string;
  adminEmail?: string;
}

export type RegionDiscovery =
  | { ok: true; identity: DiscoveredIdentity }
  | { ok: false; reason: "rejected_everywhere" | "network"; message: string };

export async function discoverRegion(
  token: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal; prefer?: FinRegion } = {},
): Promise<RegionDiscovery> {
  const doFetch = options.fetch ?? fetch;
  const order = options.prefer
    ? [options.prefer, ...ORDER.filter((r) => r !== options.prefer)]
    : ORDER;
  let networkError: string | undefined;
  for (const region of order) {
    try {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      const response = await doFetch(`${REGION_HOSTS[region]}/me`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "error",
        signal,
      });
      if (response.status === 401 || response.status === 403) continue;
      if (!response.ok) {
        networkError = `HTTP ${response.status} from the ${region.toUpperCase()} host`;
        continue;
      }
      const me = (await response.json().catch(() => ({}))) as {
        name?: unknown;
        email?: unknown;
        app?: { id_code?: unknown; name?: unknown; region?: unknown };
      };
      const appId = typeof me.app?.id_code === "string" ? me.app.id_code : undefined;
      if (!appId) {
        networkError = "the /me response had no workspace id";
        continue;
      }
      const reported = typeof me.app?.region === "string" ? me.app.region.toLowerCase() : undefined;
      return {
        ok: true,
        identity: {
          region: reported === "us" || reported === "eu" || reported === "au" ? reported : region,
          appId,
          workspaceName: typeof me.app?.name === "string" ? me.app.name : undefined,
          adminName: typeof me.name === "string" ? me.name : undefined,
          adminEmail: typeof me.email === "string" ? me.email : undefined,
        },
      };
    } catch (error) {
      networkError = error instanceof Error ? error.message : String(error);
    }
  }
  return networkError
    ? {
        ok: false,
        reason: "network",
        message: `Could not reach the Fin API to detect the region (${networkError}).`,
      }
    : {
        ok: false,
        reason: "rejected_everywhere",
        message:
          "The token was rejected by the US, EU, and AU Fin APIs. Create a new personal API token in Fin under Settings → Personal → API tokens.",
      };
}
