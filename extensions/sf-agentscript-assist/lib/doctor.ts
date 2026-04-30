/* SPDX-License-Identifier: Apache-2.0 */
/**
 * `/sf-agentscript-assist` command renderer.
 *
 * Produces the doctor report (SDK load status, vendored bundle path, dialect
 * probe) and a usage hint when the user passes an unknown subcommand.
 */

import path from "node:path";
import { loadAgentforceSDK, VENDORED_SDK_PATH } from "./sdk.ts";

// -------------------------------------------------------------------------------------------------
// Status shape
// -------------------------------------------------------------------------------------------------

export interface DoctorStatus {
  sdkLoaded: boolean;
  vendoredSdkPath: string;
  dialectsProbed: string[];
  loadError?: string;
  upstreamNote: string;
}

// -------------------------------------------------------------------------------------------------
// Probe
// -------------------------------------------------------------------------------------------------

export async function probeDoctor(_cwd: string): Promise<DoctorStatus> {
  const sdk = await loadAgentforceSDK();

  const dialectsProbed: string[] = [];
  let loadError: string | undefined;
  let sdkLoaded = false;

  if (sdk) {
    sdkLoaded = true;
    try {
      // The vendored agentforce bundle exposes the agentforce dialect; probe
      // it so the doctor report confirms basic SDK health, not just a load.
      const resolved = sdk.resolveDialect("", { dialects: [sdk.agentforceDialect] });
      dialectsProbed.push(resolved.dialect.name);
    } catch (error) {
      loadError = `Dialect probe threw: ${error instanceof Error ? error.message : String(error)}`;
      sdkLoaded = false;
    }
  } else {
    loadError = "Vendored SDK failed to import.";
  }

  // Source the upstream pin from the committed UPSTREAM.md so the doctor
  // report shows the same commit CI synced.
  let upstreamNote = "Pinned via scripts/sync-agentforce-sdk.mjs";
  try {
    const upstreamMdPath = path.join(path.dirname(VENDORED_SDK_PATH), "UPSTREAM.md");
    const fs = await import("node:fs/promises");
    const contents = await fs.readFile(upstreamMdPath, "utf8");
    const commitLine = contents.match(/^- Commit: `([^`]+)`/m);
    const versionLine = contents.match(/^- Package version: `([^`]+)`/m);
    if (commitLine && versionLine) {
      upstreamNote = `${versionLine[1]} @ ${commitLine[1].slice(0, 10)}`;
    }
  } catch {
    // Ignore — we just fall back to the default note.
  }

  return {
    sdkLoaded,
    vendoredSdkPath: VENDORED_SDK_PATH,
    dialectsProbed,
    loadError,
    upstreamNote,
  };
}

// -------------------------------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------------------------------

export function renderDoctorReport(status: DoctorStatus): string {
  const lines = ["Agent Script Assist — doctor", ""];

  if (status.sdkLoaded) {
    lines.push(`✅ SDK: loaded (${status.upstreamNote})`);
    lines.push(`   source: ${status.vendoredSdkPath}`);
    if (status.dialectsProbed.length > 0) {
      lines.push(`   dialects: ${status.dialectsProbed.join(", ")}`);
    }
  } else {
    lines.push(`❌ SDK: not loaded`);
    lines.push(`   source: ${status.vendoredSdkPath}`);
    if (status.loadError) lines.push(`   reason: ${status.loadError}`);
    lines.push(`   tip: re-run scripts/sync-agentforce-sdk.mjs or reinstall sf-pi.`);
  }

  return lines.join("\n");
}
