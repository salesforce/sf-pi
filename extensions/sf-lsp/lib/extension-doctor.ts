/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Adapter that converts sf-lsp's per-language `LspDoctorStatus[]` into the
 * shared `ExtensionDoctorReport` shape consumed by `/sf-pi doctor`.
 *
 * The standalone `/sf-lsp doctor` command keeps using `doctorLsp()` and
 * `renderDoctorReport()` directly so its UI stays unchanged. This file
 * exists only to bridge into the aggregated manager view.
 */
import type { ExtensionDoctorReport } from "../../../lib/common/doctor/registry.ts";
import { doctorLsp } from "./lsp-client.ts";

const LANGUAGE_LABELS: Record<string, string> = {
  apex: "Apex LSP",
  lwc: "LWC LSP",
  agentscript: "Agent Script LSP",
};

export async function runExtensionDoctor(cwd: string): Promise<ExtensionDoctorReport> {
  const statuses = await doctorLsp(cwd);
  const checks: ExtensionDoctorReport["checks"] = statuses.map((status) => ({
    id: `lsp.${status.language}`,
    severity: status.available ? "ok" : "warn",
    title: `${LANGUAGE_LABELS[status.language] ?? status.language}: ${status.available ? "available" : "unavailable"}`,
    detail: status.detail,
    fix: status.available
      ? undefined
      : `See /sf-lsp doctor for the discovered command + repair advice for ${status.language}.`,
  }));

  const ok = statuses.every((s) => s.available);
  return {
    extensionId: "sf-lsp",
    title: "SF LSP",
    checks,
    summary: ok ? "✓ All LSPs available" : "! Some LSPs unavailable",
  };
}
