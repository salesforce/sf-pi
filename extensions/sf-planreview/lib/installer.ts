/* SPDX-License-Identifier: Apache-2.0 */
/** Explicit, version-pinned installer for the official standalone Plannotator TUI. */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  managedTuiPath,
  resolvePinnedAsset,
  sha256,
  TUI_VERSION,
  type PinnedAsset,
} from "../../../lib/common/plannotator-release.ts";

export {
  resolvePinnedAsset,
  managedTuiPath,
  managedTuiIntegrity,
  TUI_VERSION,
} from "../../../lib/common/plannotator-release.ts";

const MAX_BYTES = 20 * 1024 * 1024;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface InstallManagedTuiOptions {
  target?: string;
  asset?: PinnedAsset;
  fetcher?: Fetcher;
}

export async function installManagedTui(
  options: InstallManagedTuiOptions = {},
): Promise<{ ok: boolean; message: string }> {
  const asset = options.asset ?? resolvePinnedAsset();
  if (!asset)
    return {
      ok: false,
      message: "No managed Plannotator TUI build is available for this platform.",
    };
  const target = options.target ?? managedTuiPath();
  const url = `https://github.com/plannotator/plannotator-tui/releases/download/v${TUI_VERSION}/${asset.name}`;
  const dir = path.dirname(target);
  let staging: string | undefined;
  try {
    const response = await (options.fetcher ?? fetch)(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !response.body) throw new Error("download unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error("download exceeds 20 MB limit");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    if (sha256(bytes) !== asset.sha256) throw new Error("checksum mismatch");

    mkdirSync(dir, { recursive: true, mode: 0o700 });
    staging = mkdtempSync(path.join(dir, ".install-"));
    const staged = path.join(staging, path.basename(target));
    writeFileSync(staged, bytes, { flag: "wx", mode: 0o700 });
    chmodSync(staged, 0o700);
    const previous = `${staged}.previous`;
    if (existsSync(target)) renameSync(target, previous);
    try {
      renameSync(staged, target);
    } catch (error) {
      if (existsSync(previous)) renameSync(previous, target);
      throw error;
    }
    return {
      ok: true,
      message: `Plannotator TUI v${TUI_VERSION} installed and checksum verified.`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown failure";
    return {
      ok: false,
      message: `Plannotator TUI setup failed (${reason}). Any existing installation was left intact.`,
    };
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
}
