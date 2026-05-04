/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Integration-ish tests for the announcements orchestrator.
 *
 * Exercises buildAnnouncementsSync end-to-end by feeding it a fake package
 * root, an injected state object, and an explicit `now`. Keeps the tests
 * filesystem-scoped to a tmp dir and network-free.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAnnouncementsSync, refreshAnnouncements } from "../lib/announcements.ts";

const tempDirs: string[] = [];

function makeRoot(
  opts: {
    version?: string;
    manifest?: unknown;
  } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), "ann-orch-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "catalog"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "sf-pi-test", version: opts.version ?? "0.16.0" }),
    "utf8",
  );
  if (opts.manifest !== undefined) {
    writeFileSync(
      join(dir, "catalog", "announcements.json"),
      JSON.stringify(opts.manifest),
      "utf8",
    );
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("buildAnnouncementsSync", () => {
  it("returns empty payload when feature is disabled via env", () => {
    const root = makeRoot({
      manifest: {
        schemaVersion: 1,
        revision: "r",
        announcements: [{ id: "n", kind: "note", title: "hi" }],
      },
    });
    const payload = buildAnnouncementsSync({
      packageRoot: root,
      env: { SF_PI_ANNOUNCEMENTS: "off" } as NodeJS.ProcessEnv,
      state: { acknowledgedRevision: "", dismissed: {} },
    });
    expect(payload.visible).toEqual([]);
  });

  it("returns empty payload when feature is disabled via settings", () => {
    const root = makeRoot({
      manifest: {
        schemaVersion: 1,
        revision: "r",
        announcements: [{ id: "n", kind: "note", title: "hi" }],
      },
    });
    const payload = buildAnnouncementsSync({
      packageRoot: root,
      settings: { enabled: false, feedEnabled: false },
      state: { acknowledgedRevision: "", dismissed: {} },
    });
    expect(payload.visible).toEqual([]);
  });

  it("surfaces a bundled announcement and respects dismissals", () => {
    const root = makeRoot({
      manifest: {
        schemaVersion: 1,
        revision: "r",
        announcements: [
          { id: "keep", kind: "note", title: "Keep me" },
          { id: "gone", kind: "note", title: "Dismissed" },
        ],
      },
    });
    const payload = buildAnnouncementsSync({
      packageRoot: root,
      env: {} as NodeJS.ProcessEnv,
      state: { acknowledgedRevision: "", dismissed: { gone: "2026-04-01T00:00:00Z" } },
    });
    expect(payload.visible.map((a) => a.id)).toEqual(["keep"]);
    expect(payload.hasUnacknowledged).toBe(true);
  });

  it("injects the update nudge when installed version < latestVersion", () => {
    const root = makeRoot({
      version: "0.15.0",
      manifest: {
        schemaVersion: 1,
        revision: "r",
        latestVersion: "0.17.0",
        announcements: [],
      },
    });
    const payload = buildAnnouncementsSync({
      packageRoot: root,
      env: {} as NodeJS.ProcessEnv,
      state: { acknowledgedRevision: "", dismissed: {} },
      now: new Date("2026-04-29T00:00:00Z"),
    });
    expect(payload.visible.length).toBe(1);
    const only = payload.visible[0];
    expect(only.kind).toBe("update");
    expect(only.severity).toBe("warn");
    expect(only.title).toContain("0.17.0");
  });

  it("does not inject update nudge when installed >= latest", () => {
    const root = makeRoot({
      version: "0.17.0",
      manifest: {
        schemaVersion: 1,
        revision: "r",
        latestVersion: "0.17.0",
        announcements: [],
      },
    });
    const payload = buildAnnouncementsSync({
      packageRoot: root,
      env: {} as NodeJS.ProcessEnv,
      state: { acknowledgedRevision: "", dismissed: {} },
    });
    expect(payload.visible).toEqual([]);
  });

  it("hasUnacknowledged is false when revision is already acknowledged", () => {
    const root = makeRoot({
      manifest: {
        schemaVersion: 1,
        revision: "r",
        announcements: [{ id: "n", kind: "note", title: "hi" }],
      },
    });
    const payload = buildAnnouncementsSync({
      packageRoot: root,
      env: {} as NodeJS.ProcessEnv,
      state: { acknowledgedRevision: "r", dismissed: {} },
    });
    expect(payload.visible.length).toBe(1);
    expect(payload.hasUnacknowledged).toBe(false);
  });
});

describe("refreshAnnouncements", () => {
  it("returns bundled-only payload when no feedUrl is configured", async () => {
    const root = makeRoot({
      manifest: {
        schemaVersion: 1,
        revision: "r",
        announcements: [{ id: "b", kind: "note", title: "bundled" }],
      },
    });
    const payload = await refreshAnnouncements({
      packageRoot: root,
      env: {} as NodeJS.ProcessEnv,
      state: { acknowledgedRevision: "", dismissed: {} },
    });
    expect(payload.visible.map((a) => a.id)).toEqual(["b"]);
  });

  it("skips remote feed when feedEnabled is false via settings", async () => {
    const root = makeRoot({
      manifest: {
        schemaVersion: 1,
        revision: "r",
        feedUrl: "https://example.com/feed.json",
        announcements: [{ id: "b", kind: "note", title: "bundled" }],
      },
    });
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response("{}", { status: 200 });
    };
    const payload = await refreshAnnouncements({
      packageRoot: root,
      env: {} as NodeJS.ProcessEnv,
      settings: { enabled: true, feedEnabled: false },
      state: { acknowledgedRevision: "", dismissed: {} },
      remote: fetchImpl,
    });
    expect(called).toBe(false);
    expect(payload.visible.map((a) => a.id)).toEqual(["b"]);
  });

  it("merges remote feed entries when feedUrl is set and fetch succeeds", async () => {
    const root = makeRoot({
      manifest: {
        schemaVersion: 1,
        revision: "r",
        feedUrl: "https://example.com/feed.json",
        announcements: [{ id: "b", kind: "note", title: "bundled" }],
      },
    });

    const remoteBody = JSON.stringify({
      schemaVersion: 1,
      revision: "remote-r",
      announcements: [{ id: "r", kind: "note", title: "from remote" }],
    });
    const fetchImpl: typeof fetch = async () =>
      new Response(remoteBody, {
        status: 200,
        headers: { "content-type": "application/json", etag: 'W/"x"' },
      });

    const payload = await refreshAnnouncements({
      packageRoot: root,
      env: {} as NodeJS.ProcessEnv,
      state: { acknowledgedRevision: "", dismissed: {} },
      remote: fetchImpl,
    });

    // Both bundled and remote entries should appear, after filter/sort.
    const ids = payload.visible.map((a) => a.id).sort();
    expect(ids).toContain("b");
    expect(ids).toContain("r");
  });

  it("does not send cached ETags when fetching the remote feed", async () => {
    const root = makeRoot({
      manifest: {
        schemaVersion: 1,
        revision: "r",
        feedUrl: "https://example.com/feed.json",
        announcements: [],
      },
    });

    let headers: HeadersInit | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      headers = init?.headers;
      return new Response(JSON.stringify({ schemaVersion: 1, revision: "r", announcements: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await refreshAnnouncements({
      packageRoot: root,
      env: {} as NodeJS.ProcessEnv,
      now: new Date("2026-05-04T00:00:00Z"),
      state: {
        acknowledgedRevision: "",
        dismissed: {},
        lastFetchAt: "2026-05-03T00:00:00Z",
        lastFetchEtag: 'safe"\r\nInjected: bad',
      },
      remote: fetchImpl,
    });

    expect(headers).toMatchObject({ Accept: "application/json" });
    expect((headers as Record<string, string>)["If-None-Match"]).toBeUndefined();
  });

  it("falls back to bundled-only when remote fetch fails", async () => {
    const root = makeRoot({
      manifest: {
        schemaVersion: 1,
        revision: "r",
        feedUrl: "https://example.com/feed.json",
        announcements: [{ id: "b", kind: "note", title: "bundled" }],
      },
    });
    const fetchImpl: typeof fetch = async () => {
      throw new Error("boom");
    };
    const payload = await refreshAnnouncements({
      packageRoot: root,
      env: {} as NodeJS.ProcessEnv,
      state: { acknowledgedRevision: "", dismissed: {} },
      remote: fetchImpl,
    });
    expect(payload.visible.map((a) => a.id)).toEqual(["b"]);
  });
});
