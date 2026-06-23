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

  it("caches collection metadata and reports staleness", () => {
    expect(cache.readCatalogCache(1000)).toMatchObject({ hit: false, stale: true });
    cache.writeCatalogCache([{ collection: "developer", versions: ["current"] }], 1000);
    expect(cache.readCatalogCache(1000)).toMatchObject({
      hit: true,
      stale: false,
      collections: [{ collection: "developer", versions: ["current"] }],
    });
    expect(cache.readCatalogCache(1000 + 1000 * 60 * 60 * 25)).toMatchObject({
      hit: true,
      stale: true,
    });
  });
});
