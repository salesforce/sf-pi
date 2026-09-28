/* SPDX-License-Identifier: Apache-2.0 */
/** Pinned official Plannotator TUI release and managed-runtime integrity.
 * Digests from https://github.com/plannotator/plannotator-tui/releases/download/v0.9.4/SHA256SUMS
 * (manifest SHA-256: 8419d45e5b4fdaef8d03f4a51725f619013d4d44448eb771fdfc8c4f8352c5ec).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { globalAgentPath } from "./pi-paths.ts";

export const TUI_VERSION = "0.9.4";
export type PinnedAsset = { name: string; sha256: string };
const ASSETS: Record<string, PinnedAsset> = {
  "darwin/arm64": {
    name: "plannotator-tui-aarch64-apple-darwin",
    sha256: "a9da49dd6a44d3494fed0e8366ca32996ecdf40e0271fced410cec3c8839175d",
  },
  "darwin/x64": {
    name: "plannotator-tui-x86_64-apple-darwin",
    sha256: "5d19683d6f90a4249ffaf3a6a7ed0ba1325a136a795c7b11a8ba1fb16fe8d14f",
  },
  "linux/arm64": {
    name: "plannotator-tui-aarch64-unknown-linux-gnu",
    sha256: "e39077aac2e1e77ed798d2590f845cf998e456fa2a212fe7cae2e25febf62082",
  },
  "linux/x64": {
    name: "plannotator-tui-x86_64-unknown-linux-gnu",
    sha256: "d54dc603c95f710677bc13ebe6b24b2e6eb10ce761577af8a95a05002862b74d",
  },
  "win32/arm64": {
    name: "plannotator-tui-aarch64-pc-windows-msvc.exe",
    sha256: "12589a353339a97d5ecca2a5275b87313a5199787b2bd500b68660c8836afc20",
  },
  "win32/x64": {
    name: "plannotator-tui-x86_64-pc-windows-msvc.exe",
    sha256: "0611f6276cf1f3a1a1f29834e117ab2789d610095e9b3062d76dfa9673eee9f3",
  },
};

export function resolvePinnedAsset(
  platform = process.platform,
  arch = process.arch,
): PinnedAsset | null {
  return ASSETS[`${platform}/${arch}`] ?? null;
}

export function managedTuiPath(): string {
  return globalAgentPath(
    "sf-pi",
    "sf-planreview",
    "bin",
    process.platform === "win32" ? "plannotator-tui.exe" : "plannotator-tui",
  );
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function managedTuiIntegrity(
  file: string = managedTuiPath(),
  asset: PinnedAsset | null = resolvePinnedAsset(),
): "missing" | "verified" | "damaged" | "unsupported" {
  if (!asset) return "unsupported";
  if (!existsSync(file)) return "missing";
  try {
    return sha256(readFileSync(file)) === asset.sha256 ? "verified" : "damaged";
  } catch {
    return "damaged";
  }
}
