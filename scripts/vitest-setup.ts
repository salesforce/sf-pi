/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Vitest setup shared by every test file.
 *
 * Tests fake the home folder by assigning `process.env.HOME`. On Windows,
 * `os.homedir()` reads `USERPROFILE` instead, so those tests would read and
 * write the real profile. In tests only, make `os.homedir()` honor HOME on
 * Windows the same way it already does on macOS and Linux. No effect off
 * Windows, and production code is unchanged.
 */
import module from "node:module";
import os from "node:os";

if (process.platform === "win32") {
  const original = os.homedir;
  os.homedir = () => process.env.HOME || original();
  // Keep `import { homedir } from "node:os"` bindings in sync with the patch.
  module.syncBuiltinESMExports();
}
