/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the named-user JWT bootstrap required by /einstein/ai-agent/* routes. */

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearAgentApiAuthCache,
  upgradeConnectionToNamedUserJwt,
  validateNamedUserJwt,
} from "../lib/agent-api-auth.ts";

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url").replace(/=/g, "");
  return `${encode({ alg: "RS256" })}.${encode(payload)}.signature`;
}

const JWT = makeJwt({
  sub: "uid:005",
  iss: "https://example.my.salesforce.com",
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000) - 60,
  sfdc_app_id: "app",
  scope: "chatbot_api sfap_api web",
});

beforeEach(() => {
  clearAgentApiAuthCache();
});

function fakeConn(opts?: { token?: string; instanceUrl?: string; response?: unknown }) {
  const conn = {
    accessToken: opts?.token ?? "00Dxx!opaque-org-token",
    refreshed: false,
    calls: [] as Array<{ url: string; headers?: Record<string, string> }>,
    getAuthInfoFields: () => ({ refreshToken: "refresh" }),
    refreshAuth: vi.fn(async () => {
      conn.refreshed = true;
    }),
    getConnectionOptions: () => ({
      accessToken: conn.accessToken,
      instanceUrl: opts?.instanceUrl ?? "https://example.my.salesforce.com",
    }),
    request: vi.fn(async (req: { url: string; headers?: Record<string, string> }) => {
      conn.calls.push(req);
      return opts?.response ?? { access_token: JWT };
    }),
  };
  return conn;
}

describe("validateNamedUserJwt", () => {
  test("validates required claims and exposes diagnostics", () => {
    const result = validateNamedUserJwt(JWT);
    expect(result.isValid).toBe(true);
    expect(result.subject).toBe("uid:005");
    expect(result.issuer).toBe("https://example.my.salesforce.com");
    expect(result.scopes).toEqual(["chatbot_api", "sfap_api", "web"]);
  });

  test("rejects non-three-part tokens", () => {
    expect(validateNamedUserJwt("not-a-jwt")).toMatchObject({
      isValid: false,
      missingFields: ["invalid JWT format - expected 3 parts"],
    });
  });

  test("rejects expired and missing-claim tokens", () => {
    const expired = makeJwt({ sub: "uid:005", iss: "issuer", exp: 1 });
    expect(validateNamedUserJwt(expired)).toMatchObject({ isValid: false, isExpired: true });

    const missingIssuer = makeJwt({ sub: "uid:005" });
    expect(validateNamedUserJwt(missingIssuer)).toMatchObject({
      isValid: false,
      missingFields: ["iss"],
    });
  });
});

describe("upgradeConnectionToNamedUserJwt", () => {
  test("calls /agentforce/bootstrap/nameduser with sid cookie and installs returned JWT", async () => {
    const conn = fakeConn();
    await upgradeConnectionToNamedUserJwt(conn as never);

    expect(conn.refreshAuth).toHaveBeenCalledTimes(1);
    expect(conn.calls).toHaveLength(1);
    expect(conn.calls[0].url).toBe(
      "https://example.my.salesforce.com/agentforce/bootstrap/nameduser",
    );
    expect(conn.calls[0].headers?.Cookie).toBe("sid=00Dxx!opaque-org-token");
    expect(conn.accessToken).toBe(JWT);
  });

  test("rejects non-JWT bootstrap responses with a scopes hint", async () => {
    const conn = fakeConn({ response: { access_token: "not-a-jwt" } });
    await expect(upgradeConnectionToNamedUserJwt(conn as never)).rejects.toThrow(/sfap_api/);
  });

  test("fails fast when the org connection has no access token", async () => {
    const conn = fakeConn({ token: "" });
    await expect(upgradeConnectionToNamedUserJwt(conn as never)).rejects.toThrow(
      /missing org access token/,
    );
  });
});

describe("connForAgentApi isolation", () => {
  test("uses fresh connections so the normal org connection token is not clobbered", async () => {
    vi.resetModules();
    const baseConn = {
      accessToken: "ORG-TOKEN",
      getUsername: () => "agent@example.com",
      getApiVersion: () => "67.0",
    };
    const created: Array<
      ReturnType<typeof fakeConn> & { setApiVersion: ReturnType<typeof vi.fn> }
    > = [];

    vi.doMock("../../../lib/common/sf-conn/connection.ts", () => ({
      connFromAlias: vi.fn(async () => baseConn),
    }));
    vi.doMock("@salesforce/core", () => ({
      AuthInfo: { create: vi.fn(async () => ({ username: "agent@example.com" })) },
      Connection: {
        create: vi.fn(async () => {
          const conn = Object.assign(fakeConn({ token: "FRESH-ORG-TOKEN" }), {
            setApiVersion: vi.fn(),
          });
          created.push(conn);
          return conn;
        }),
      },
    }));

    const { connForAgentApi } = await import("../lib/agent-api-auth.ts");
    const [one, two] = await Promise.all([connForAgentApi("org"), connForAgentApi("org")]);
    const three = await connForAgentApi("org");

    expect(baseConn.accessToken).toBe("ORG-TOKEN");
    expect(one.conn).not.toBe(baseConn);
    expect(two.conn).not.toBe(baseConn);
    expect(three.conn).not.toBe(baseConn);
    expect(one.conn).toBe(two.conn);
    expect(two.conn).toBe(three.conn);
    expect(created).toHaveLength(1);
    expect(created.every((c) => c.accessToken === JWT)).toBe(true);
    expect(one.cache).toBe("miss");
    expect(two.cache).toBe("hit");
    expect(three.cache).toBe("hit");

    vi.doUnmock("../../../lib/common/sf-conn/connection.ts");
    vi.doUnmock("@salesforce/core");
  });

  test("refreshes the cache when the cached JWT is near expiry", async () => {
    vi.resetModules();
    const nearExpiryJwt = makeJwt({
      sub: "uid:005",
      iss: "https://example.my.salesforce.com",
      exp: Math.floor(Date.now() / 1000) + 10,
    });
    const longLivedJwt = makeJwt({
      sub: "uid:005",
      iss: "https://example.my.salesforce.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const baseConn = {
      accessToken: "ORG-TOKEN",
      getUsername: () => "agent@example.com",
      getApiVersion: () => "67.0",
    };
    const created: Array<ReturnType<typeof fakeConn>> = [];

    vi.doMock("../../../lib/common/sf-conn/connection.ts", () => ({
      connFromAlias: vi.fn(async () => baseConn),
    }));
    vi.doMock("@salesforce/core", () => ({
      AuthInfo: { create: vi.fn(async () => ({ username: "agent@example.com" })) },
      Connection: {
        create: vi.fn(async () => {
          const response = { access_token: created.length === 0 ? nearExpiryJwt : longLivedJwt };
          const conn = Object.assign(fakeConn({ token: "FRESH-ORG-TOKEN", response }), {
            setApiVersion: vi.fn(),
          });
          created.push(conn);
          return conn;
        }),
      },
    }));

    const { connForAgentApi } = await import("../lib/agent-api-auth.ts");
    const one = await connForAgentApi("org");
    const two = await connForAgentApi("org");

    expect(one.cache).toBe("miss");
    expect(two.cache).toBe("miss");
    expect(one.conn).not.toBe(two.conn);
    expect(created).toHaveLength(2);

    vi.doUnmock("../../../lib/common/sf-conn/connection.ts");
    vi.doUnmock("@salesforce/core");
  });
});
