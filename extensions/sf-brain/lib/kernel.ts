/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Kernel body loader + CLI-missing stub.
 *
 * The full Salesforce operator kernel lives in SF_KERNEL.md next to index.ts.
 * Users can override it by dropping their own file at
 * `<globalAgentDir>/sf-brain/SF_KERNEL.md`. When the override is present, it
 * replaces the bundled kernel verbatim. If it cannot be read for any reason,
 * we fall back silently to the bundled version so sessions never start without
 * a kernel.
 *
 * When the sf CLI is not installed, the full kernel is replaced by a short
 * install stub. Rule 11 in the full kernel still covers this for sessions that
 * somehow get the full kernel despite a missing CLI, but the stub keeps the
 * common case tight.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { globalAgentPath } from "../../../lib/common/pi-paths.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Header used for both kernel variants so extensions / tests can match on it. */
export const KERNEL_HEADER = "[Salesforce Operator Kernel]";
export const KERNEL_MISSING_CLI_HEADER = "[Salesforce Operator Kernel — sf CLI not detected]";

/** customType used when persisting the kernel into the session. */
export const KERNEL_ENTRY_TYPE = "sf-brain-kernel";

const BUNDLED_KERNEL_PATH = path.resolve(__dirname, "..", "SF_KERNEL.md");

const INSTALL_STUB = `${KERNEL_MISSING_CLI_HEADER}
Do not fabricate sf command output. Install first:
  macOS:    brew install --cask salesforce-cli
  Linux:    npm install -g @salesforce/cli
  Windows:  https://developer.salesforce.com/tools/salesforcecli
Verify:     sf --version
Login:      sf org login web --set-default --alias MyOrg
`;

/**
 * Resolve the override kernel path, honoring Pi SDK agent-dir overrides.
 * Exposed for tests.
 */
export function overrideKernelPath(): string {
  return globalAgentPath("sf-brain", "SF_KERNEL.md");
}

/**
 * Read the bundled kernel from SF_KERNEL.md. Exposed for tests.
 * Throws if the bundled file is missing, which only happens if the extension
 * is installed incorrectly.
 */
export function readBundledKernel(): string {
  return readFileSync(BUNDLED_KERNEL_PATH, "utf8").trimEnd() + "\n";
}

/**
 * Load the kernel body for a given CLI state.
 * - CLI missing → short install stub, regardless of override.
 * - CLI installed → user override if present and non-empty, else bundled kernel.
 */
export function loadKernel(options: { cliInstalled: boolean }): string {
  if (!options.cliInstalled) {
    return INSTALL_STUB;
  }

  const overridePath = overrideKernelPath();
  try {
    if (existsSync(overridePath)) {
      const text = readFileSync(overridePath, "utf8").trimEnd();
      if (text.length > 0) {
        return text + "\n";
      }
    }
  } catch {
    // Fall through to bundled kernel.
  }

  return readBundledKernel();
}
