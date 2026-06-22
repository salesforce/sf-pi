/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the cached Org/Connection lookup.
 *
 * We mock @salesforce/core's Org so the suite stays in-process — no real
 * sf-CLI auth files, no network. The contract we pin:
 *   - Two calls with the same alias share one promise (single Org.create).
 *   - Different aliases get different promises.
 *   - clearConnectionCache drops the cache.
 *   - A failing Org.create does NOT poison the cache; the next call retries.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import type { Connection } from "@salesforce/core";

const createMock = vi.fn();

vi.mock("@salesforce/core", () => ({
  Org: {
    create: (opts: unknown) => createMock(opts),
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  createMock.mockReset();
});

describe("orgFromAlias", () => {
  test("caches the same Org promise across calls for the same alias", async () => {
    const fakeOrg = { id: "fake" };
    createMock.mockResolvedValue(fakeOrg);

    const mod = await import("../sf-conn/connection.ts");
    mod.clearConnectionCache();

    const a = await mod.orgFromAlias("vivint-devint");
    const b = await mod.orgFromAlias("vivint-devint");

    expect(a).toBe(fakeOrg);
    expect(b).toBe(fakeOrg);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(mod.cacheSize()).toBe(1);
  });

  test("caches separately per alias and uses <default> for undefined", async () => {
    createMock.mockResolvedValueOnce({ tag: "default" });
    createMock.mockResolvedValueOnce({ tag: "explicit" });

    const mod = await import("../sf-conn/connection.ts");
    mod.clearConnectionCache();

    await mod.orgFromAlias();
    await mod.orgFromAlias("explicit");

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(mod.cacheSize()).toBe(2);
  });

  test("clearConnectionCache drops every entry", async () => {
    createMock.mockResolvedValue({ id: "x" });

    const mod = await import("../sf-conn/connection.ts");
    mod.clearConnectionCache();

    await mod.orgFromAlias("a");
    await mod.orgFromAlias("b");
    expect(mod.cacheSize()).toBe(2);

    mod.clearConnectionCache();
    expect(mod.cacheSize()).toBe(0);
  });

  test("a failing Org.create does NOT poison the cache", async () => {
    createMock.mockRejectedValueOnce(new Error("auth expired")).mockResolvedValueOnce({ id: "ok" });

    const mod = await import("../sf-conn/connection.ts");
    mod.clearConnectionCache();

    await expect(mod.orgFromAlias("bad")).rejects.toThrow(/auth expired/);
    // The failed promise should have been removed from the cache, so a retry
    // re-invokes Org.create.
    const second = await mod.orgFromAlias("bad");
    expect(second).toEqual({ id: "ok" });
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});

describe("resolveOrgIdentity", () => {
  test("uses bounded native userinfo fetch when an access token is available", async () => {
    const mod = await import("../sf-conn/connection.ts");
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user_id: "005000000000001",
          organization_id: "00D000000000001",
        }),
        { status: 200 },
      ),
    );
    const conn = {
      accessToken: "JWT",
      instanceUrl: "https://example.my.salesforce.com",
      identity: vi.fn().mockResolvedValue({}),
    } as unknown as Connection;

    await expect(mod.resolveOrgIdentity(conn, { fetchImpl })).resolves.toEqual({
      org_id: "00D000000000001",
      instance_url: "https://example.my.salesforce.com",
      user_id: "005000000000001",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.my.salesforce.com/services/oauth2/userinfo",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer JWT" },
      }),
    );
    expect(conn.identity).not.toHaveBeenCalled();
  });

  test("falls back to bounded conn.identity when no access token is available", async () => {
    const mod = await import("../sf-conn/connection.ts");
    const conn = {
      instanceUrl: "https://example.my.salesforce.com",
      identity: vi.fn().mockResolvedValue({
        user_id: "005000000000001",
        organization_id: "00D000000000001",
      }),
    } as unknown as Connection;

    await expect(mod.resolveOrgIdentity(conn)).resolves.toEqual({
      org_id: "00D000000000001",
      instance_url: "https://example.my.salesforce.com",
      user_id: "005000000000001",
    });
  });

  test("times out a never-resolving conn.identity", async () => {
    vi.useFakeTimers();
    const mod = await import("../sf-conn/connection.ts");
    const conn = {
      instanceUrl: "https://example.my.salesforce.com",
      identity: vi.fn(() => new Promise(() => undefined)),
    } as unknown as Connection;

    const caught = mod.resolveOrgIdentity(conn, { timeoutMs: 100 }).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(100);

    await expect(caught).resolves.toMatchObject({
      name: "OrgIdentityTimeoutError",
      timedOutAfterMs: 100,
    });
  });

  test("pre-aborted signal rejects without starting conn.identity", async () => {
    const mod = await import("../sf-conn/connection.ts");
    const controller = new AbortController();
    controller.abort();
    const conn = {
      instanceUrl: "https://example.my.salesforce.com",
      identity: vi.fn().mockResolvedValue({}),
    } as unknown as Connection;

    await expect(mod.resolveOrgIdentity(conn, { signal: controller.signal })).rejects.toMatchObject(
      {
        name: "OrgIdentityAbortedError",
      },
    );
    expect(conn.identity).not.toHaveBeenCalled();
  });
});
