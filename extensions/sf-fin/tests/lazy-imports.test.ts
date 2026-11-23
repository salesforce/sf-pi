/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SF Fin loads its Salesforce modules lazily, so boot stays free of the
 * Salesforce SDK. Pi loads extensions through jiti, where two concurrent
 * `import()` calls of a module still being evaluated can hand the second
 * caller a partly initialized module ("Cannot access … before
 * initialization"). Parallel sf_fin salesforce calls (readiness and observe
 * in one batch) hit exactly that. These tests load the module the way Pi
 * does and call the lazy loaders at the same time.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("SF Fin lazy Salesforce imports under Pi's loader", () => {
  it("give every concurrent caller a fully initialized module", async () => {
    // A fresh jiti instance with Pi's loader options (no shared module cache).
    const jiti = createJiti(import.meta.url, { moduleCache: false });
    const lazy = (await jiti.import(path.join(here, "../lib/lazy-imports.ts"))) as {
      loadSfConn: () => Promise<{ connectSalesforce: unknown }>;
      loadFinSalesforceOrg: () => Promise<{ createFinSalesforceOrg: unknown }>;
    };
    const results = await Promise.allSettled([
      lazy.loadSfConn(),
      lazy.loadSfConn(),
      lazy.loadSfConn(),
      lazy.loadFinSalesforceOrg(),
      lazy.loadFinSalesforceOrg(),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(5).fill("fulfilled"));
    const [a, b, c] = results.slice(0, 3).map((r) => (r as PromiseFulfilledResult<unknown>).value);
    // One shared module, not three partly evaluated copies.
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("let concurrent callers use the module right away (the parallel readiness + observe bug)", async () => {
    const jiti = createJiti(import.meta.url, { moduleCache: false });
    const lazy = (await jiti.import(path.join(here, "../lib/lazy-imports.ts"))) as {
      loadSfConn: () => Promise<{
        connectSalesforce: (input: { cwd: string; targetOrg: string }) => Promise<unknown>;
      }>;
    };
    // connectSalesforce reads module constants on its first line. On a partly
    // initialized module that throws "Cannot access … before initialization"
    // before any org lookup; a whole module gets as far as "no such org".
    const results = await Promise.allSettled(
      [1, 2, 3].map(() =>
        lazy
          .loadSfConn()
          .then((m) => m.connectSalesforce({ cwd: here, targetOrg: "sf-fin-no-such-org-alias" })),
      ),
    );
    const messages = results.map((r) =>
      r.status === "rejected" ? String((r.reason as Error).message) : "connected",
    );
    expect(messages.filter((m) => /before initialization/u.test(m))).toEqual([]);
  });

  it("start the import once and let a failed import be retried", async () => {
    const jiti = createJiti(import.meta.url, { moduleCache: false });
    const { lazyOnce } = (await jiti.import(path.join(here, "../lib/lazy-imports.ts"))) as {
      lazyOnce: <T>(load: () => Promise<T>) => () => Promise<T>;
    };
    let calls = 0;
    const flaky = lazyOnce(async () => {
      calls += 1;
      if (calls === 1) throw new Error("first load failed");
      return { ok: true };
    });
    await expect(Promise.all([flaky(), flaky()])).rejects.toThrow("first load failed");
    expect(calls).toBe(1);
    await expect(flaky()).resolves.toEqual({ ok: true });
    await expect(flaky()).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });
});
