/* SPDX-License-Identifier: Apache-2.0 */
/** Shared per-Connection authentication refresh coordination. */

import type { Connection } from "@salesforce/core";

const authRefreshes = new WeakMap<Connection, Promise<void>>();

export function getSalesforceConnectionAccessToken(connection: Connection): string | undefined {
  return (
    (connection as unknown as { accessToken?: string }).accessToken ??
    (connection.getConnectionOptions?.() as { accessToken?: string } | undefined)?.accessToken
  );
}

/**
 * Return the one in-flight refresh for this Connection, starting it when
 * necessary. Callers own their timeout/cancellation while waiting; one caller
 * must never cancel the refresh needed by another.
 */
export function refreshSalesforceConnectionAuth(
  connection: Connection,
  failedAccessToken: string | undefined,
): Promise<void> | undefined {
  let pending = authRefreshes.get(connection);
  if (pending) return pending;

  const currentAccessToken = getSalesforceConnectionAccessToken(connection);
  if (failedAccessToken && currentAccessToken && currentAccessToken !== failedAccessToken) {
    return Promise.resolve();
  }

  const refreshAuth = (connection as unknown as { refreshAuth?: () => Promise<unknown> })
    .refreshAuth;
  if (typeof refreshAuth !== "function") return undefined;

  pending = Promise.resolve()
    .then(() => refreshAuth.call(connection))
    .then(() => undefined);
  authRefreshes.set(connection, pending);
  void pending.then(
    () => {
      if (authRefreshes.get(connection) === pending) authRefreshes.delete(connection);
    },
    () => {
      if (authRefreshes.get(connection) === pending) authRefreshes.delete(connection);
    },
  );
  return pending;
}
