/* SPDX-License-Identifier: Apache-2.0 */
/** Cache-first Code Analyzer readiness refresh owned by sf-code-analyzer. */
import type { ExecFn } from "../../../lib/common/sf-environment/detect.ts";
import {
  formatCodeAnalyzerReadinessLine,
  isCodeAnalyzerReadyForAutoScan,
  readCodeAnalyzerReadiness,
  writeCodeAnalyzerReadiness,
  type CodeAnalyzerReadinessState,
} from "../../../lib/common/code-analyzer-status/store.ts";
import { runCodeAnalyzerDoctor } from "./cli.ts";

export type { CodeAnalyzerReadinessState };
export { isCodeAnalyzerReadyForAutoScan, readCodeAnalyzerReadiness };

export async function refreshCodeAnalyzerReadiness(
  exec: ExecFn,
): Promise<CodeAnalyzerReadinessState> {
  const doctor = await runCodeAnalyzerDoctor(exec);
  return writeCodeAnalyzerReadiness({
    checkedAt: new Date().toISOString(),
    status:
      doctor.sf.ok && doctor.plugin.ok
        ? doctor.java.ok && doctor.python.ok
          ? "ready"
          : "partial"
        : "not_installed",
    summary: doctor.summary,
    pluginVersion: doctor.plugin.version,
    sfOk: doctor.sf.ok,
    pluginOk: doctor.plugin.ok,
    javaOk: doctor.java.ok,
    pythonOk: doctor.python.ok,
  });
}

export function formatReadinessLine(state = readCodeAnalyzerReadiness()): string {
  return formatCodeAnalyzerReadinessLine(state);
}
