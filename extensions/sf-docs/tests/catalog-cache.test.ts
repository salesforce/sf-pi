/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  return { ...actual, getAgentDir: () => tempAgentDir };
});

describe("sf-docs catalog cache", () => {
  let cache: typeof import("../lib/catalog-cache.ts");

  beforeEach(async () => {
    tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-docs-cache-"));
    vi.resetModules();
    cache = await import("../lib/catalog-cache.ts");
  });

  afterEach(() => rmSync(tempAgentDir, { recursive: true, force: true }));

  it("caches only allowlisted collection metadata and reports staleness", () => {
    expect(cache.readCatalogCache(1000)).toMatchObject({ hit: false, stale: true });
    cache.writeCatalogCache(
      [
        {
          collection: "legacydeveloper",
          status: "deprecating",
          versions: ["current"],
          landmarks: [
            {
              version: "current",
              landmarks: [{ slug: "_api_meta", members: ["_metadata"] }],
              localeDiffs: [{ locales: ["ja-jp"], removed: [{ slug: "_api_meta" }] }],
            },
          ],
          content: "must not persist",
          citations: [{ url: "https://example.test/private" }],
        } as never,
      ],
      1000,
    );
    expect(cache.readCatalogCache(1000)).toMatchObject({
      hit: true,
      stale: false,
      collections: [
        {
          collection: "legacydeveloper",
          status: "deprecating",
          versions: ["current"],
          landmarks: [
            {
              version: "current",
              landmarks: [{ slug: "_api_meta", members: ["_metadata"] }],
              localeDiffs: [{ locales: ["ja-jp"], removed: [{ slug: "_api_meta" }] }],
            },
          ],
        },
      ],
    });
    expect(cache.readCatalogCache(1000).collections?.[0]).not.toHaveProperty("content");
    expect(cache.readCatalogCache(1000).collections?.[0]).not.toHaveProperty("citations");
    expect(cache.readCatalogCache(1000 + 1000 * 60 * 60 * 25)).toMatchObject({
      hit: true,
      stale: true,
    });
  });

  it("scopes cached catalog metadata to a non-reversible endpoint identity", () => {
    cache.writeCatalogCache(
      [{ collection: "developer", versions: ["current"] }],
      1000,
      "https://first.example.test/",
    );

    expect(cache.readCatalogCache(1000, "https://first.example.test/")).toMatchObject({
      hit: true,
      stale: false,
    });
    expect(cache.readCatalogCache(1000, "https://second.example.test/")).toMatchObject({
      hit: false,
      stale: true,
    });
    expect(JSON.stringify(cache.readCatalogCache(1000))).not.toContain(
      "https://first.example.test/",
    );
  });

  it("drops malformed collection and nested landmark entries", () => {
    expect(() =>
      cache.writeCatalogCache(
        [
          null as never,
          {
            collection: "developer",
            landmarks: [
              null,
              {
                version: "current",
                landmarks: [null, { slug: "_lwc" }],
                localeDiffs: [null, { locales: ["ja-jp"], removed: [null, { slug: "_api" }] }],
              },
            ],
          } as never,
        ],
        1000,
      ),
    ).not.toThrow();

    expect(cache.readCatalogCache(1000).collections).toEqual([
      {
        collection: "developer",
        landmarks: [
          {
            version: "current",
            landmarks: [{ slug: "_lwc" }],
            localeDiffs: [{ locales: ["ja-jp"], removed: [{ slug: "_api" }] }],
          },
        ],
      },
    ]);
  });
});
