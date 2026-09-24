/* SPDX-License-Identifier: Apache-2.0 */
/** Native diagnostics adapter; the result formatter is shared with standalone callers. */
import { getLspDiagnosticsForFile } from "../../sf-lsp/lib/lsp-client.ts";
import * as diagnostics from "./diagnostic-result.ts";
import type { SfApexParams } from "./types.ts";
export { isApexFile, resolveToolPath } from "./diagnostic-result.ts";
export const nativeApexDiagnostics: diagnostics.ApexDiagnosticsProvider = (file, cwd, timeout) =>
  getLspDiagnosticsForFile("apex", file, cwd, timeout);
export const diagnoseFile = (params: SfApexParams, cwd: string) =>
  diagnostics.diagnoseFile(params, cwd, nativeApexDiagnostics);
export const diagnoseApexFile = (file: string, cwd: string) =>
  diagnostics.diagnoseApexFile(file, cwd, nativeApexDiagnostics);
