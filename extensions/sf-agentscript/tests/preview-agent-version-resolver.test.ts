/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the `agentDefinition.agentVersion.developerName` resolver used by
 * v1.1 preview/sessions starts. Locks in the priority order:
 *   override > bundle-meta `<target>vN</target>` > latest BotVersion SOQL > "v0".
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  findLatestBotVersionDeveloperName,
  parseTargetFromBundleMeta,
  resolveAgentVersionDeveloperName,
} from "../lib/preview/resolve-agent-version.ts";

describe("parseTargetFromBundleMeta", () => {
  test("extracts vN from <target>X.vN</target>", () => {
    expect(parseTargetFromBundleMeta("<target>Hello_Bot.v3</target>")).toBe("v3");
    expect(parseTargetFromBundleMeta("<target>  My_Agent.v12  </target>")).toBe("v12");
  });

  test("accepts a bare <target>vN</target> as fallback", () => {
    expect(parseTargetFromBundleMeta("<target>v7</target>")).toBe("v7");
  });

  test("returns undefined when no recognizable target is present", () => {
    expect(parseTargetFromBundleMeta("<bundleType>AGENT</bundleType>")).toBeUndefined();
    expect(parseTargetFromBundleMeta("<target>not-a-version</target>")).toBeUndefined();
    expect(parseTargetFromBundleMeta("")).toBeUndefined();
  });

  test("rejects malformed version-like strings", () => {
    expect(parseTargetFromBundleMeta("<target>X.v</target>")).toBeUndefined();
    expect(parseTargetFromBundleMeta("<target>X.va</target>")).toBeUndefined();
    // Server convention is lowercase `vN`. Uppercase `VN` is rejected.
    expect(parseTargetFromBundleMeta("<target>X.V3</target>")).toBeUndefined();
  });
});

function fakeConn() {
  return {
    instanceUrl: "https://example.my.salesforce.com",
    accessToken: "00D.fake-token",
    getApiVersion: () => "67.0",
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("findLatestBotVersionDeveloperName", () => {
  test("returns DeveloperName from the latest BotVersion via bounded fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ records: [{ BotVersions: { records: [{ DeveloperName: "v4" }] } }] }),
    );
    const r = await findLatestBotVersionDeveloperName(fakeConn() as never, "Hello_Bot", {
      fetchImpl,
    });
    expect(r.developerName).toBe("v4");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(decodeURIComponent(url)).toContain("BotVersions");
    expect(decodeURIComponent(url)).toContain("DeveloperName='Hello_Bot'");
  });

  test("escapes single quotes in the agent name", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ records: [] }));
    await findLatestBotVersionDeveloperName(fakeConn() as never, "weird'name", { fetchImpl });
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(decodeURIComponent(url)).toContain("DeveloperName='weird''name'");
  });

  test("returns no developerName when the agent has no BotVersions yet", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ records: [{ BotVersions: null }] }),
    );
    expect(
      (await findLatestBotVersionDeveloperName(fakeConn() as never, "X", { fetchImpl }))
        .developerName,
    ).toBeUndefined();
  });

  test("returns a warning when bounded fetch fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse([{ message: "bad" }], { status: 500 }),
    );
    const r = await findLatestBotVersionDeveloperName(fakeConn() as never, "X", { fetchImpl });
    expect(r.developerName).toBeUndefined();
    expect(r.warning).toMatch(/HTTP 500/);
  });

  test("rejects non-vN DeveloperName values", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ records: [{ BotVersions: { records: [{ DeveloperName: "draft-7" }] } }] }),
    );
    expect(
      (await findLatestBotVersionDeveloperName(fakeConn() as never, "X", { fetchImpl }))
        .developerName,
    ).toBeUndefined();
  });
});

describe("resolveAgentVersionDeveloperName", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-resolver-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("override beats every other source", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ records: [{ BotVersions: { records: [{ DeveloperName: "v9" }] } }] }),
    );
    await writeFile(path.join(dir, "X.bundle-meta.xml"), "<target>X.v3</target>");
    await writeFile(path.join(dir, "X.agent"), "");
    const r = await resolveAgentVersionDeveloperName({
      override: "v42",
      agentFilePath: path.join(dir, "X.agent"),
      conn: fakeConn() as never,
      agentName: "X",
      fetchImpl,
    });
    expect(r).toEqual({ developerName: "v42", source: "override" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("ignores malformed override and falls through", async () => {
    await writeFile(path.join(dir, "X.bundle-meta.xml"), "<target>X.v3</target>");
    await writeFile(path.join(dir, "X.agent"), "");
    const r = await resolveAgentVersionDeveloperName({
      override: "draft",
      agentFilePath: path.join(dir, "X.agent"),
    });
    expect(r).toEqual({ developerName: "v3", source: "bundle-meta" });
  });

  test("bundle-meta beats SOQL", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ records: [{ BotVersions: { records: [{ DeveloperName: "v9" }] } }] }),
    );
    await writeFile(path.join(dir, "X.bundle-meta.xml"), "<target>X.v3</target>");
    await writeFile(path.join(dir, "X.agent"), "");
    const r = await resolveAgentVersionDeveloperName({
      agentFilePath: path.join(dir, "X.agent"),
      conn: fakeConn() as never,
      agentName: "X",
      fetchImpl,
    });
    expect(r).toEqual({ developerName: "v3", source: "bundle-meta" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("bounded SOQL takes over when bundle-meta is missing or has no <target>", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ records: [{ BotVersions: { records: [{ DeveloperName: "v5" }] } }] }),
    );
    await writeFile(path.join(dir, "X.bundle-meta.xml"), "<bundleType>AGENT</bundleType>");
    await writeFile(path.join(dir, "X.agent"), "");
    const r = await resolveAgentVersionDeveloperName({
      agentFilePath: path.join(dir, "X.agent"),
      conn: fakeConn() as never,
      agentName: "X",
      fetchImpl,
    });
    expect(r).toEqual({ developerName: "v5", source: "soql" });
  });

  test("defaults to v0 when bounded SOQL lookup fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse([], { status: 500 }));
    await writeFile(path.join(dir, "X.bundle-meta.xml"), "<bundleType>AGENT</bundleType>");
    await writeFile(path.join(dir, "X.agent"), "");
    const r = await resolveAgentVersionDeveloperName({
      agentFilePath: path.join(dir, "X.agent"),
      conn: fakeConn() as never,
      agentName: "X",
      fetchImpl,
    });
    expect(r.developerName).toBe("v0");
    expect(r.source).toBe("default");
    expect(r.lookup_warning).toMatch(/HTTP 500/);
  });

  test("defaults to v0 when nothing else resolves", async () => {
    const r = await resolveAgentVersionDeveloperName({});
    expect(r).toEqual({ developerName: "v0", source: "default" });
  });

  test("defaults to v0 when bundle-meta is unreadable AND SOQL returns nothing", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ records: [] }));
    const r = await resolveAgentVersionDeveloperName({
      agentFilePath: path.join(dir, "missing.agent"),
      conn: fakeConn() as never,
      agentName: "Nope",
      fetchImpl,
    });
    expect(r).toEqual({ developerName: "v0", source: "default" });
  });
});
