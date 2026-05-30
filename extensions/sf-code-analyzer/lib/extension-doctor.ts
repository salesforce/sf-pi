/* SPDX-License-Identifier: Apache-2.0 */
/** Aggregated `/sf-pi doctor` adapter for SF Code Analyzer. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionDoctorProvider } from "../../../lib/common/doctor/registry.ts";
import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import { runCodeAnalyzerDoctor } from "./cli.ts";

export function buildCodeAnalyzerDoctor(pi: ExtensionAPI): ExtensionDoctorProvider {
  const exec = buildExecFn(pi);
  return async () => {
    const report = await runCodeAnalyzerDoctor(exec);
    return {
      extensionId: "sf-code-analyzer",
      title: "SF Code Analyzer",
      summary: report.summary,
      checks: [
        {
          id: "code-analyzer.sf-cli",
          severity: report.sf.ok ? "ok" : "error",
          title: "Salesforce CLI",
          detail: report.sf.detail,
          fix: report.sf.ok ? undefined : "Install Salesforce CLI before using Code Analyzer.",
        },
        {
          id: "code-analyzer.plugin",
          severity: report.plugin.ok ? "ok" : "error",
          title: "Code Analyzer plugin",
          detail: report.plugin.detail,
          fix: report.plugin.ok ? undefined : "Run: sf plugins install code-analyzer",
        },
        {
          id: "code-analyzer.java",
          severity: report.java.ok ? "ok" : "warn",
          title: "Java prerequisite",
          detail: report.java.detail,
          fix: report.java.ok ? undefined : "Install Java 11+ for PMD, CPD, and SFGE engines.",
        },
        {
          id: "code-analyzer.python",
          severity: report.python.ok ? "ok" : "warn",
          title: "Python prerequisite",
          detail: report.python.detail,
          fix: report.python.ok ? undefined : "Install Python 3.10+ for the Flow Scanner engine.",
        },
      ],
    };
  };
}
