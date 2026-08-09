/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proofs for the shared Salesforce Connection Module. */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const configGetInfoMock = vi.fn<(key: string) => unknown>();
const configCreateMock = vi.fn();
const configClearMock = vi.fn();
const orgCreateMock = vi.fn();

vi.mock("@salesforce/core", () => ({
  ConfigAggregator: {
    create: (options?: unknown) => configCreateMock(options),
    clearInstance: (projectPath?: string) => configClearMock(projectPath),
  },
  Org: { create: (options?: unknown) => orgCreateMock(options) },
}));

import {
  SalesforceApiVersionDiscoveryError,
  SalesforceConnectionAbortedError,
  SalesforceConnectionTimeoutError,
  SalesforceRequestError,
  clearSalesforceConnectionCache,
  connectSalesforce,
} from "../sf-conn/index.ts";

interface FakeConnection {
  accessToken: string;
  instanceUrl: string;
  version: string;
  getApiVersion: ReturnType<typeof vi.fn>;
  setApiVersion: ReturnType<typeof vi.fn>;
  getAuthInfoFields: ReturnType<typeof vi.fn>;
  getConnectionOptions: ReturnType<typeof vi.fn>;
  getUsername: ReturnType<typeof vi.fn>;
  refreshAuth: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
}

function fakeConnection(initialVersion = "50.0"): FakeConnection {
  const conn: FakeConnection = {
    accessToken: "TOKEN",
    instanceUrl: "https://example.sandbox.my.salesforce.com",
    version: initialVersion,
    getApiVersion: vi.fn(() => conn.version),
    setApiVersion: vi.fn((version: string) => {
      conn.version = version;
    }),
    getAuthInfoFields: vi.fn(() => ({
      alias: "ExampleOrg",
      username: "user@example.invalid",
      orgId: "00D000000000001AAA",
      instanceUrl: conn.instanceUrl,
      isSandbox: true,
    })),
    getConnectionOptions: vi.fn(() => ({
      accessToken: conn.accessToken,
      instanceUrl: conn.instanceUrl,
    })),
    getUsername: vi.fn(() => "user@example.invalid"),
    refreshAuth: vi.fn(async () => undefined),
    request: vi.fn(),
  };
  return conn;
}

function fakeOrg(conn: FakeConnection) {
  return { getConnection: () => conn };
}

function mockConfig(targetOrg?: string, apiVersion?: string): void {
  configGetInfoMock.mockImplementation((key) => {
    if (key === "target-org") return { value: targetOrg, location: "Global" };
    if (key === "org-api-version") return { value: apiVersion, location: "Global" };
    return { value: undefined };
  });
}

function versionsResponse(...versions: string[]): Response {
  return new Response(
    JSON.stringify(versions.map((version) => ({ version, label: `API ${version}` }))),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  clearSalesforceConnectionCache();
  configGetInfoMock.mockReset();
  configCreateMock.mockReset();
  configClearMock.mockReset();
  configClearMock.mockResolvedValue(undefined);
  configCreateMock.mockResolvedValue({ getInfo: configGetInfoMock });
  orgCreateMock.mockReset();
  mockConfig("ExampleOrg");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearSalesforceConnectionCache();
});

describe("connectSalesforce version selection", () => {
  test("selects the highest numeric API version advertised by the target org", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    const fetchMock = vi.fn().mockResolvedValue(versionsResponse("66.0", "9.0", "67.0", "60.0"));
    vi.stubGlobal("fetch", fetchMock);

    const sf = await connectSalesforce({ cwd: "/workspace" });

    expect(sf.target).toMatchObject({
      targetOrg: "ExampleOrg",
      apiVersion: "67.0",
      maxApiVersion: "67.0",
      versionSource: "org-latest",
      configuredFallback: undefined,
      orgType: "sandbox",
    });
    expect(conn.setApiVersion).toHaveBeenCalledWith("67.0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://example.sandbox.my.salesforce.com/services/data",
    );
  });

  test("prefers org latest over a configured org-api-version", async () => {
    mockConfig("ExampleOrg", "62.0");
    const conn = fakeConnection("62.0");
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(versionsResponse("62.0", "67.0")));

    const sf = await connectSalesforce({ cwd: "/workspace" });

    expect(sf.target).toMatchObject({
      apiVersion: "67.0",
      maxApiVersion: "67.0",
      versionSource: "org-latest",
      configuredFallback: "62.0",
    });
    expect(conn.setApiVersion).toHaveBeenCalledWith("67.0");
  });

  test("uses configured org-api-version only when latest discovery fails", async () => {
    mockConfig("ExampleOrg", "62.0");
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const sf = await connectSalesforce({ cwd: "/workspace" });

    expect(sf.target).toMatchObject({
      apiVersion: "62.0",
      maxApiVersion: undefined,
      versionSource: "configured-fallback",
      configuredFallback: "62.0",
    });
    expect(sf.target.versionDiscoveryWarning).toMatch(/HTTP 503/);
    expect(conn.setApiVersion).toHaveBeenCalledWith("62.0");
  });

  test("fails closed when discovery fails and no configured fallback exists", async () => {
    const conn = fakeConnection("50.0");
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(connectSalesforce({ cwd: "/workspace" })).rejects.toMatchObject({
      name: "SalesforceApiVersionDiscoveryError",
      targetOrg: "ExampleOrg",
    });
    expect(conn.setApiVersion).not.toHaveBeenCalled();
    expect(conn.getApiVersion()).toBe("50.0");
  });

  test("treats malformed or empty discovery output as failure", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(versionsResponse("invalid")));

    await expect(connectSalesforce({ cwd: "/workspace" })).rejects.toBeInstanceOf(
      SalesforceApiVersionDiscoveryError,
    );
  });

  test("explicit target_org wins over configured target-org", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(versionsResponse("67.0")));

    const sf = await connectSalesforce({ cwd: "/workspace", targetOrg: "ExplicitOrg" });

    expect(sf.target.targetOrg).toBe("ExplicitOrg");
    expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername: "ExplicitOrg" });
  });

  test("fails clearly when no explicit or configured target org exists", async () => {
    mockConfig(undefined);

    await expect(connectSalesforce({ cwd: "/workspace" })).rejects.toMatchObject({
      name: "SalesforceTargetOrgError",
    });
    expect(orgCreateMock).not.toHaveBeenCalled();
  });

  test("caller cancellation bounds configuration resolution", async () => {
    let resolveConfig: ((value: { getInfo: typeof configGetInfoMock }) => void) | undefined;
    configCreateMock.mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = resolve;
      }),
    );
    const controller = new AbortController();
    const pending = connectSalesforce({
      cwd: "/workspace",
      signal: controller.signal,
      timeoutMs: 5_000,
    }).catch((error: unknown) => error);
    controller.abort();

    await expect(pending).resolves.toBeInstanceOf(SalesforceConnectionAbortedError);
    resolveConfig?.({ getInfo: configGetInfoMock });
    expect(orgCreateMock).not.toHaveBeenCalled();
  });

  test("caller timeout bounds configuration resolution", async () => {
    vi.useFakeTimers();
    configCreateMock.mockReturnValue(new Promise(() => undefined));
    const pending = connectSalesforce({ cwd: "/workspace", timeoutMs: 25 }).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toBeInstanceOf(SalesforceConnectionTimeoutError);
    expect(orgCreateMock).not.toHaveBeenCalled();
  });

  test("normalizes explicit configured version syntax and rejects malformed values", async () => {
    mockConfig("ExampleOrg", " v62.0 ");
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));

    const configured = await connectSalesforce({ cwd: "/workspace" });
    expect(configured.target.apiVersion).toBe("62.0");

    clearSalesforceConnectionCache();
    mockConfig("ExampleOrg", "not-a-version");
    await expect(connectSalesforce({ cwd: "/workspace" })).rejects.toMatchObject({
      name: "SalesforceConnectionConfigError",
    });
  });
});

describe("Salesforce connection cache and refresh", () => {
  test("shares one initialization across concurrent callers", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    const fetchMock = vi.fn().mockResolvedValue(versionsResponse("67.0"));
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      connectSalesforce({ cwd: "/workspace" }),
      connectSalesforce({ cwd: "/workspace" }),
    ]);

    expect(first).toBe(second);
    expect(orgCreateMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("one caller aborting does not cancel shared initialization for another caller", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    let resolveDiscovery: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveDiscovery = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const firstController = new AbortController();

    const first = connectSalesforce({
      cwd: "/workspace",
      signal: firstController.signal,
      timeoutMs: 5_000,
    });
    const second = connectSalesforce({ cwd: "/workspace", timeoutMs: 5_000 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    firstController.abort();

    await expect(first).rejects.toBeInstanceOf(SalesforceConnectionAbortedError);
    resolveDiscovery?.(versionsResponse("67.0"));
    await expect(second).resolves.toMatchObject({ target: { apiVersion: "67.0" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a later caller can abort its wait without poisoning shared initialization", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    let resolveDiscovery: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveDiscovery = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const secondController = new AbortController();

    const first = connectSalesforce({ cwd: "/workspace", timeoutMs: 5_000 });
    const second = connectSalesforce({
      cwd: "/workspace",
      signal: secondController.signal,
      timeoutMs: 5_000,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    secondController.abort();

    await expect(second).rejects.toBeInstanceOf(SalesforceConnectionAbortedError);
    resolveDiscovery?.(versionsResponse("67.0"));
    await expect(first).resolves.toMatchObject({ target: { apiVersion: "67.0" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("caller-specific timeout does not cancel shared initialization", async () => {
    vi.useFakeTimers();
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    let resolveDiscovery: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveDiscovery = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const short = connectSalesforce({ cwd: "/workspace", timeoutMs: 25 }).catch(
      (error: unknown) => error,
    );
    const patient = connectSalesforce({ cwd: "/workspace", timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25);

    await expect(short).resolves.toBeInstanceOf(SalesforceConnectionTimeoutError);
    resolveDiscovery?.(versionsResponse("67.0"));
    await expect(patient).resolves.toMatchObject({ target: { apiVersion: "67.0" } });
  });

  test("fresh connection replaces only the matching cwd and target", async () => {
    const oldConn = fakeConnection();
    const freshConn = fakeConnection();
    orgCreateMock.mockResolvedValueOnce(fakeOrg(oldConn)).mockResolvedValueOnce(fakeOrg(freshConn));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(versionsResponse("66.0"))
      .mockResolvedValueOnce(versionsResponse("67.0"));
    vi.stubGlobal("fetch", fetchMock);

    const first = await connectSalesforce({ cwd: "/workspace" });
    const refreshed = await connectSalesforce({ cwd: "/workspace", fresh: true });

    expect(first.target.apiVersion).toBe("66.0");
    expect(refreshed.target.apiVersion).toBe("67.0");
    expect(orgCreateMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("fresh connection reloads target and API fallback configuration", async () => {
    let targetOrg = "FirstOrg";
    let configuredVersion = "61.0";
    configGetInfoMock.mockImplementation((key) => {
      if (key === "target-org") return { value: targetOrg, location: "Global" };
      if (key === "org-api-version") return { value: configuredVersion, location: "Global" };
      return { value: undefined };
    });
    orgCreateMock
      .mockResolvedValueOnce(fakeOrg(fakeConnection()))
      .mockResolvedValueOnce(fakeOrg(fakeConnection()));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));

    const first = await connectSalesforce({ cwd: "/workspace" });
    targetOrg = "SecondOrg";
    configuredVersion = "62.0";
    const refreshed = await connectSalesforce({ cwd: "/workspace", fresh: true });

    expect(first.target).toMatchObject({ targetOrg: "FirstOrg", apiVersion: "61.0" });
    expect(refreshed.target).toMatchObject({ targetOrg: "SecondOrg", apiVersion: "62.0" });
    expect(configClearMock).toHaveBeenCalledWith("/workspace");
  });

  test("failed initialization is evicted so the next call can retry", async () => {
    const firstConn = fakeConnection();
    const secondConn = fakeConnection();
    orgCreateMock
      .mockResolvedValueOnce(fakeOrg(firstConn))
      .mockResolvedValueOnce(fakeOrg(secondConn));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(versionsResponse("67.0"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(connectSalesforce({ cwd: "/workspace" })).rejects.toBeInstanceOf(
      SalesforceApiVersionDiscoveryError,
    );
    const retried = await connectSalesforce({ cwd: "/workspace" });

    expect(retried.target.apiVersion).toBe("67.0");
    expect(orgCreateMock).toHaveBeenCalledTimes(2);
  });
});

describe("SalesforceSession request and query", () => {
  test("builds versioned REST paths from versionless resources", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(versionsResponse("67.0"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ totalSize: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const sf = await connectSalesforce({ cwd: "/workspace" });
    const response = await sf.request<{ totalSize: number }>({
      method: "GET",
      path: "/tooling/query",
      query: { q: "SELECT Id FROM ApexClass", include: ["a", "b"] },
    });

    expect(response.status).toBe(200);
    expect(response.path).toContain("/services/data/v67.0/tooling/query?");
    expect(response.path).toContain("include=a&include=b");
    expect(response.target.versionSource).toBe("org-latest");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/services/data/v67.0/tooling/query?");
  });

  test("caller mutation cannot change the selected request version", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(versionsResponse("67.0"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const sf = await connectSalesforce({ cwd: "/workspace" });
    try {
      (sf.target as { apiVersion: string }).apiVersion = "50.0";
    } catch {
      // A frozen public target is the preferred implementation.
    }
    await sf.request({ method: "GET", path: "/limits" });

    expect(fetchMock.mock.calls[1]?.[0]).toContain("/services/data/v67.0/limits");
  });

  test("rejects caller-supplied versioned business paths", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(versionsResponse("67.0")));

    const sf = await connectSalesforce({ cwd: "/workspace" });

    await expect(
      sf.request({ method: "GET", path: "/services/data/v50.0/limits" }),
    ).rejects.toThrow(/versionless/i);
    await expect(sf.request({ method: "GET", path: "services/data/v50.0/limits" })).rejects.toThrow(
      /versionless/i,
    );
    await expect(
      sf.request({ method: "GET", path: "/../../../services/data/v50.0/limits" }),
    ).rejects.toThrow(/traversal/i);
    await expect(
      sf.request({
        method: "GET",
        path: "/query/%2e%2e/%2e%2e/services/data/v50.0/limits",
      }),
    ).rejects.toThrow(/traversal/i);
  });

  test("does not retry a failed business request using the configured fallback", async () => {
    mockConfig("ExampleOrg", "62.0");
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(versionsResponse("62.0", "67.0"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ errorCode: "SERVER_ERROR", message: "boom" }]), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const sf = await connectSalesforce({ cwd: "/workspace" });
    const response = await sf.request({ method: "POST", path: "/example", body: { x: 1 } });

    expect(sf.target.apiVersion).toBe("67.0");
    expect(response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/services/data/v67.0/example");
  });

  test("query paginates through the shared request seam and enforces maxRows", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(versionsResponse("67.0"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            totalSize: 3,
            done: false,
            nextRecordsUrl: "/services/data/v67.0/query/next-1",
            records: [{ Id: "1" }, { Id: "2" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ totalSize: 3, done: true, records: [{ Id: "3" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const sf = await connectSalesforce({ cwd: "/workspace" });
    const result = await sf.query<{ Id: string }>({
      soql: "SELECT Id FROM Account",
      api: "rest",
      maxRows: 3,
    });

    expect(result.records).toEqual([{ Id: "1" }, { Id: "2" }, { Id: "3" }]);
    expect(result.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/services/data/v67.0/query/next-1");
  });

  test("query truncates at maxRows without requesting another page", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(versionsResponse("67.0"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            totalSize: 3,
            done: false,
            nextRecordsUrl: "/services/data/v67.0/query/next-1",
            records: [{ Id: "1" }, { Id: "2" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const sf = await connectSalesforce({ cwd: "/workspace" });
    const result = await sf.query<{ Id: string }>({
      soql: "SELECT Id FROM Account",
      maxRows: 2,
    });

    expect(result.records).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test.each([
    { body: { records: [], nextRecordsUrl: undefined }, label: "missing done" },
    { body: { records: [], done: false }, label: "missing continuation" },
    {
      body: { records: [], done: false, nextRecordsUrl: "https://evil.invalid/query/next" },
      label: "absolute continuation",
    },
    {
      body: {
        records: [],
        done: false,
        nextRecordsUrl: "/services/data/v67.0/query/../../limits",
      },
      label: "path traversal continuation",
    },
    {
      body: {
        records: [],
        done: false,
        nextRecordsUrl: "/services/data/v67.0/query/%2e%2e/limits",
      },
      label: "encoded traversal continuation",
    },
    {
      body: {
        records: [],
        done: false,
        nextRecordsUrl: "/services/data/v67.0/tooling/query/next",
      },
      label: "endpoint-switching continuation",
    },
  ])("query rejects malformed protocol pages: $label", async ({ body }) => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(versionsResponse("67.0"))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    );

    const sf = await connectSalesforce({ cwd: "/workspace" });

    await expect(sf.query({ soql: "SELECT Id FROM Account", maxRows: 10 })).rejects.toBeInstanceOf(
      SalesforceRequestError,
    );
  });

  test("query fails when pagination exceeds the shared page bound", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return versionsResponse("67.0");
      return new Response(
        JSON.stringify({
          totalSize: 1_000,
          done: false,
          nextRecordsUrl: `/services/data/v67.0/query/page-${calls}`,
          records: [{ Id: String(calls) }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const sf = await connectSalesforce({ cwd: "/workspace" });

    await expect(sf.query({ soql: "SELECT Id FROM Account", maxRows: 1_000 })).rejects.toThrow(
      /exceeded 100 pages/i,
    );
    expect(fetchMock).toHaveBeenCalledTimes(101);
  });

  test("queryAll uses the data API and rejects Tooling mode", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(versionsResponse("67.0"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ totalSize: 0, done: true, records: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const sf = await connectSalesforce({ cwd: "/workspace" });
    await sf.query({ soql: "SELECT Id FROM Account", queryAll: true, maxRows: 10 });
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/services/data/v67.0/queryAll/");
    await expect(
      sf.query({ soql: "SELECT Id FROM ApexClass", api: "tooling", queryAll: true, maxRows: 10 }),
    ).rejects.toThrow(/queryAll.*REST/i);
  });

  test("query errors omit SOQL literals, raw bodies, and target identity", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(versionsResponse("67.0"))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([{ errorCode: "MALFORMED_QUERY", message: "secret@example.invalid" }]),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ),
        ),
    );

    const sf = await connectSalesforce({ cwd: "/workspace" });
    const error = await sf
      .query({
        soql: "SELECT Id FROM Contact WHERE Email = 'secret@example.invalid'",
        maxRows: 10,
      })
      .catch((caught: unknown) => caught);
    const serialized = JSON.stringify(error);

    expect(error).toBeInstanceOf(SalesforceRequestError);
    expect(String((error as Error).message)).not.toContain("secret@example.invalid");
    expect(serialized).not.toContain("secret@example.invalid");
    expect(serialized).not.toContain("00D000000000001AAA");
    expect(serialized).not.toContain("user@example.invalid");
  });

  test("query timeout bounds the entire pagination operation", async () => {
    vi.useFakeTimers();
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    let calls = 0;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return Promise.resolve(versionsResponse("67.0"));
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            resolve(
              new Response(
                JSON.stringify({
                  totalSize: 10,
                  done: false,
                  nextRecordsUrl: `/services/data/v67.0/query/page-${calls}`,
                  records: [{ Id: String(calls) }],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            ),
          60,
        );
        init?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sf = await connectSalesforce({ cwd: "/workspace" });
    const pending = sf
      .query({ soql: "SELECT Id FROM Account", maxRows: 10, timeoutMs: 100 })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(60);
    await vi.advanceTimersByTimeAsync(40);

    await expect(pending).resolves.toMatchObject({
      name: "SalesforceRequestError",
      status: 408,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("query surfaces HTTP failures without changing versions", async () => {
    const conn = fakeConnection();
    orgCreateMock.mockResolvedValue(fakeOrg(conn));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(versionsResponse("67.0"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ errorCode: "MALFORMED_QUERY" }]), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const sf = await connectSalesforce({ cwd: "/workspace" });

    await expect(sf.query({ soql: "bad query", api: "rest", maxRows: 10 })).rejects.toBeInstanceOf(
      SalesforceRequestError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(conn.setApiVersion).toHaveBeenCalledTimes(1);
  });
});
