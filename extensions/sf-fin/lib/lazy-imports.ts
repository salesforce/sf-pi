/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Lazy Salesforce module loaders for SF Fin.
 *
 * SF Fin loads the Salesforce connection and org modules on first use, so
 * Pi's boot stays free of the Salesforce SDK. Pi loads extensions through
 * jiti. Under jiti, a second `import()` of a module that is still being
 * evaluated returns that module part-way through, and its first call can
 * throw "Cannot access … before initialization". Two sf_fin salesforce calls
 * in one parallel batch did exactly that.
 *
 * Each loader therefore shares one import promise across callers. A failed
 * load is not cached, so the next call retries it.
 */

/** Share one in-flight or finished `load()` across callers; retry after a failure. */
export function lazyOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let shared: Promise<T> | undefined;
  return () => {
    shared ??= load().catch((error: unknown) => {
      shared = undefined;
      throw error;
    });
    return shared;
  };
}

export const loadSfConn = lazyOnce(() => import("../../../lib/common/sf-conn/index.ts"));
export const loadFinSalesforceOrg = lazyOnce(() => import("./salesforce/org.ts"));
export const loadTokenTransfer = lazyOnce(() => import("./salesforce/token-transfer.ts"));
export const loadTokenTransferBrowser = lazyOnce(
  () => import("./salesforce/token-transfer-browser.ts"),
);
