/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared filesystem layout for the first-boot LSP installer.
 *
 * All installer artifacts live under `~/.pi/agent/lsp/` so sf-lsp's
 * existing discovery chain picks them up without further wiring. Each
 * component writes a sibling `VERSION` file that pins the exact version
 * currently on disk — that's how `detectComponentStates()` compares
 * local vs. upstream without re-parsing vsix manifests every session.
 */
import path from "node:path";
import { globalAgentPath } from "../../../../lib/common/pi-paths.ts";

/** Global directory root for managed LSP assets. */
export function lspRootDir(): string {
  return globalAgentPath("lsp");
}

// -------------------------------------------------------------------------------------------------
// Apex
// -------------------------------------------------------------------------------------------------

export function apexDir(): string {
  return path.join(lspRootDir(), "apex");
}

export function apexJarPath(): string {
  return path.join(apexDir(), "apex-jorje-lsp.jar");
}

/** Tiny plain-text file that records the installed Apex vsix version. */
export function apexVersionPath(): string {
  return path.join(apexDir(), "VERSION");
}

// -------------------------------------------------------------------------------------------------
// LWC
// -------------------------------------------------------------------------------------------------

export function lwcDir(): string {
  return path.join(lspRootDir(), "lwc");
}

/** The npm-installed language server entry point after `npm install`. */
export function lwcServerJsPath(): string {
  return path.join(
    lwcDir(),
    "node_modules",
    "@salesforce",
    "lwc-language-server",
    "bin",
    "lwc-language-server.js",
  );
}

export function lwcPackageJsonPath(): string {
  return path.join(lwcDir(), "node_modules", "@salesforce", "lwc-language-server", "package.json");
}

// -------------------------------------------------------------------------------------------------
// Persistent install state
// -------------------------------------------------------------------------------------------------

export function lspInstallStatePath(): string {
  return globalAgentPath("sf-lsp-install-state.json");
}
