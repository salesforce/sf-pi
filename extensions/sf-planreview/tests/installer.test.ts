/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installManagedTui, managedTuiIntegrity, resolvePinnedAsset } from "../lib/installer.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-planreview-installer-"));
  dirs.push(dir);
  return dir;
}

const good = Buffer.from("fixture TUI executable");
const hash = createHash("sha256").update(good).digest("hex");
const asset = { name: "plannotator-tui-fixture", sha256: hash };

function fakeFetch(bytes: Buffer): typeof fetch {
  return (async () => new Response(new Uint8Array(bytes).buffer)) as typeof fetch;
}

describe("managed Plannotator TUI installation", () => {
  it("resolves only published target platforms and pinned release assets", () => {
    expect(resolvePinnedAsset("darwin", "arm64")).toMatchObject({
      name: "plannotator-tui-aarch64-apple-darwin",
      sha256: "a9da49dd6a44d3494fed0e8366ca32996ecdf40e0271fced410cec3c8839175d",
    });
    expect(resolvePinnedAsset("freebsd", "x64")).toBeNull();
  });

  it("installs a verified executable and refuses corrupted replacement", async () => {
    const dir = fixture();
    const target = path.join(dir, "bin", "plannotator-tui");
    const success = await installManagedTui({ target, asset, fetcher: fakeFetch(good) });
    expect(success.ok).toBe(true);
    expect(readFileSync(target)).toEqual(good);
    expect(managedTuiIntegrity(target, asset)).toBe("verified");
    chmodSync(target, 0o700);

    const failed = await installManagedTui({
      target,
      asset: { ...asset, sha256: "0".repeat(64) },
      fetcher: fakeFetch(Buffer.from("bad executable")),
    });
    expect(failed.ok).toBe(false);
    expect(readFileSync(target)).toEqual(good);
    expect(managedTuiIntegrity(target, asset)).toBe("verified");
  });

  it("refuses oversized downloads without creating an executable", async () => {
    const dir = fixture();
    const target = path.join(dir, "bin", "plannotator-tui");
    const result = await installManagedTui({
      target,
      asset,
      fetcher: fakeFetch(Buffer.alloc(21 * 1024 * 1024)),
    });
    expect(result.ok).toBe(false);
    expect(() => readFileSync(target)).toThrow();
  });
});
