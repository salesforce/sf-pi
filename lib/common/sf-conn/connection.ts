/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Cached `@salesforce/core` Org / Connection lookup.
 *
 * Replaces the `sf api request rest` subprocess path. Authentication context
 * comes from the same auth files the `sf` CLI writes — no second login,
 * automatic token refresh, ~30× lower per-call latency than shelling.
 *
 * Cache lifecycle:
 *  - One Org promise per alias (or one for the default org with key "<default>").
 *  - `clearConnectionCache()` should be called from each consumer's
 *    `session_start` / `session_shutdown` so resumed sessions re-auth cleanly.
 *  - On Org.create() failure the entry is removed so the next call can retry.
 *
 * History: the original lived in `extensions/sf-agentscript/lib/connection.ts`.
 * Lifted into `lib/common/sf-conn/` once a second extension (sf-data360) needed
 * the same cached Connection — matches the lib/common Q2 rule.
 */

// Lazy-import `@salesforce/core` so just *referencing* this module from an
// extension's `index.ts` (e.g. `import { clearConnectionCache } from ...`)
// doesn't drag the entire `@salesforce/core` tree (and its transitive
// `keytar`, `jsforce`, crypto-bindings, etc.) into the boot path. The value
// import only fires when a function below is actually invoked — by then we're
// past `session_start` and the user is interacting. The type-only `Connection`
// import is erased at TS compile time and costs nothing at runtime.
import type { Org as OrgType, Connection } from "@salesforce/core";

let orgCtor: typeof OrgType | undefined;
async function getOrgCtor(): Promise<typeof OrgType> {
  if (orgCtor) return orgCtor;
  // Single dynamic import — Node's ES module cache memoizes the SDK across
  // every call here and across every other lazy importer in this repo.
  const mod = await import("@salesforce/core");
  orgCtor = mod.Org;
  return orgCtor;
}

// -------------------------------------------------------------------------------------------------
// Cache
// -------------------------------------------------------------------------------------------------

const orgCache = new Map<string, Promise<OrgType>>();
const DEFAULT_KEY = "<default>";

/**
 * Resolve a target-org alias (or the project/global default) to a cached Org.
 *
 * Pass `undefined` to use the default org chain (project default → global
 * default), matching `sf` CLI behavior.
 */
export interface OrgFromAliasOptions {
  /** Optional timeout for resolving the Salesforce Org from local auth state. */
  timeoutMs?: number;
  /** Optional caller cancellation signal. */
  signal?: AbortSignal;
}

export class OrgConnectionTimeoutError extends Error {
  readonly timedOutAfterMs: number;

  constructor(timeoutMs: number) {
    super(`Org.create() timed out after ${timeoutMs}ms.`);
    this.name = "OrgConnectionTimeoutError";
    this.timedOutAfterMs = timeoutMs;
  }
}

export class OrgConnectionAbortedError extends Error {
  constructor() {
    super("Org.create() aborted.");
    this.name = "OrgConnectionAbortedError";
  }
}

export async function orgFromAlias(
  targetOrg?: string,
  options: OrgFromAliasOptions = {},
): Promise<OrgType> {
  if (options.signal?.aborted) throw new OrgConnectionAbortedError();
  const key = targetOrg ?? DEFAULT_KEY;
  let pending = orgCache.get(key);
  if (!pending) {
    pending = (async () => {
      const Org = await getOrgCtor();
      return Org.create({ aliasOrUsername: targetOrg });
    })().catch((err: unknown) => {
      orgCache.delete(key);
      throw err;
    });
    orgCache.set(key, pending);
  }

  if (!options.timeoutMs && !options.signal) return pending;
  try {
    return await boundOrgCreate(pending, options);
  } catch (err) {
    orgCache.delete(key);
    throw err;
  }
}

/** Convenience: `orgFromAlias().getConnection()`. */
export async function connFromAlias(
  targetOrg?: string,
  options: OrgFromAliasOptions = {},
): Promise<Connection> {
  return (await orgFromAlias(targetOrg, options)).getConnection();
}

async function boundOrgCreate<T>(promise: Promise<T>, options: OrgFromAliasOptions): Promise<T> {
  if (options.signal?.aborted) throw new OrgConnectionAbortedError();

  const races: Promise<T>[] = [promise];
  let timer: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined;

  if (options.timeoutMs) {
    races.push(
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new OrgConnectionTimeoutError(options.timeoutMs as number)),
          options.timeoutMs,
        );
      }),
    );
  }

  if (options.signal) {
    races.push(
      new Promise<T>((_resolve, reject) => {
        abortHandler = () => reject(new OrgConnectionAbortedError());
        options.signal?.addEventListener("abort", abortHandler, { once: true });
      }),
    );
  }

  try {
    return await Promise.race(races);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortHandler) options.signal?.removeEventListener("abort", abortHandler);
  }
}

/**
 * Drop all cached Orgs. Call from `session_start` / `session_shutdown` so
 * resumed sessions re-auth and pick up any token refresh that happened
 * outside this process.
 */
export function clearConnectionCache(): void {
  orgCache.clear();
}

/** Test/debug helper. */
export function cacheSize(): number {
  return orgCache.size;
}

// -------------------------------------------------------------------------------------------------
// Org identity (org_id, instance_url, user_id) for SFAP headers
// -------------------------------------------------------------------------------------------------

export interface OrgIdentity {
  org_id: string;
  instance_url: string;
  user_id: string;
}

export interface ResolveOrgIdentityOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_ORG_IDENTITY_TIMEOUT_MS = 10_000;

export class OrgIdentityTimeoutError extends Error {
  readonly timedOutAfterMs: number;

  constructor(timeoutMs: number) {
    super(`conn.identity() timed out after ${timeoutMs}ms.`);
    this.name = "OrgIdentityTimeoutError";
    this.timedOutAfterMs = timeoutMs;
  }
}

export class OrgIdentityAbortedError extends Error {
  constructor() {
    super("conn.identity() aborted.");
    this.name = "OrgIdentityAbortedError";
  }
}

function getAccessToken(conn: Connection): string | undefined {
  return (
    (conn as unknown as { accessToken?: string }).accessToken ??
    (conn.getConnectionOptions?.() as { accessToken?: string } | undefined)?.accessToken
  );
}

async function boundedOrgIdentity<T>(
  promise: Promise<T>,
  opts: ResolveOrgIdentityOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_ORG_IDENTITY_TIMEOUT_MS;
  if (opts.signal?.aborted) throw new OrgIdentityAbortedError();

  let timer: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new OrgIdentityTimeoutError(timeoutMs)), timeoutMs);
  });
  const abort = opts.signal
    ? new Promise<T>((_resolve, reject) => {
        abortHandler = () => reject(new OrgIdentityAbortedError());
        opts.signal?.addEventListener("abort", abortHandler, { once: true });
      })
    : undefined;

  try {
    return await Promise.race(abort ? [promise, timeout, abort] : [promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortHandler) opts.signal?.removeEventListener("abort", abortHandler);
  }
}

async function fetchOrgIdentity(
  conn: Connection,
  opts: ResolveOrgIdentityOptions,
): Promise<{ user_id?: string; organization_id?: string }> {
  const accessToken = getAccessToken(conn);
  if (!accessToken) throw new Error("Connection has no access token for bounded userinfo fetch.");
  if (!conn.instanceUrl)
    throw new Error("Connection has no instanceUrl for bounded userinfo fetch.");
  if (opts.signal?.aborted) throw new OrgIdentityAbortedError();

  const timeoutMs = opts.timeoutMs ?? DEFAULT_ORG_IDENTITY_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = (): void => controller.abort();
  opts.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const resp = await fetchImpl(`${conn.instanceUrl}/services/oauth2/userinfo`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`userinfo request failed with HTTP ${resp.status}.`);
    return (await resp.json()) as { user_id?: string; organization_id?: string };
  } catch (err) {
    if (opts.signal?.aborted) throw new OrgIdentityAbortedError();
    if (timedOut) throw new OrgIdentityTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * Resolve org_id + user_id once per run for SFAP headers.
 *
 * Uses `conn.identity()` which hits `/services/oauth2/userinfo` under the
 * hood. The call is bounded so a slow auth/userinfo request cannot block
 * long-running Agent Script eval workflows forever.
 */
export async function resolveOrgIdentity(
  conn: Connection,
  opts: ResolveOrgIdentityOptions = {},
): Promise<OrgIdentity> {
  if (opts.signal?.aborted) throw new OrgIdentityAbortedError();
  const userInfo = getAccessToken(conn)
    ? await fetchOrgIdentity(conn, opts)
    : ((await boundedOrgIdentity(conn.identity(), opts)) as {
        user_id?: string;
        organization_id?: string;
      });
  if (!userInfo.user_id || !userInfo.organization_id) {
    throw new Error(
      "conn.identity() returned no user_id/organization_id. " +
        "Suggested fix: re-auth with `sf org login web -a <alias>`.",
    );
  }
  return {
    org_id: userInfo.organization_id,
    instance_url: conn.instanceUrl,
    user_id: userInfo.user_id,
  };
}
