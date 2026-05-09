/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Adapter that contributes a small Data 360 health summary to the
 * aggregated `/sf-pi doctor` view.
 *
 * Why we don't just reuse `d360_probe`:
 *   - The full probe issues ~15 sf-CLI calls and can take >5 seconds.
 *   - `/sf-pi doctor` budgets each registered provider at 5 seconds total.
 * Instead, this adapter answers two cheap questions:
 *   1. Is the active sf-pi target org connected?
 *   2. Does the cheapest readiness probe (`/ssot/data-spaces`) return OK?
 * Users who want the full picture still run `d360_probe` directly.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionDoctorReport } from "../../../lib/common/doctor/registry.ts";
import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../../lib/common/sf-environment/shared-runtime.ts";
import { classifyProbeResult } from "./probe-tool.ts";

const QUICK_PROBE_PATH = "/ssot/data-spaces";
const QUICK_PROBE_TIMEOUT_MS = 4_000;

export function buildSfData360Doctor(pi: ExtensionAPI) {
  return async function runExtensionDoctor(cwd: string): Promise<ExtensionDoctorReport> {
    const exec = buildExecFn(pi);
    const env = getCachedSfEnvironment(cwd) ?? (await getSharedSfEnvironment(exec, cwd));

    const checks: ExtensionDoctorReport["checks"] = [];

    if (!env.cli.installed) {
      checks.push({
        id: "data360.sf-cli",
        severity: "error",
        title: "sf CLI not installed",
        detail: "Data 360 tools require the Salesforce CLI.",
        fix: "Install: brew install --cask salesforce-cli  (macOS)  or  npm install -g @salesforce/cli",
      });
      return {
        extensionId: "sf-data360",
        title: "SF Data 360",
        checks,
        summary: "✗ sf CLI missing",
      };
    }

    const targetOrg = env.org.alias ?? env.org.username;
    if (!env.org.detected || !targetOrg) {
      checks.push({
        id: "data360.org-connected",
        severity: "warn",
        title: "No connected default org",
        detail: env.org.error ?? "Run sf org login web --set-default --alias <alias>",
        fix: "sf org login web --set-default --alias <alias>",
      });
      return {
        extensionId: "sf-data360",
        title: "SF Data 360",
        checks,
        summary: "! org not connected",
      };
    }

    checks.push({
      id: "data360.org-connected",
      severity: "ok",
      title: `Default org connected (${targetOrg})`,
      detail: `${env.org.instanceUrl ?? "instance unknown"} — ${env.org.orgType ?? "type unknown"}`,
    });

    const apiVersion = env.org.apiVersion ?? env.project.sourceApiVersion ?? "66.0";
    const probePath = `/services/data/v${apiVersion}${QUICK_PROBE_PATH}`;

    try {
      const raw = await exec(
        "sf",
        ["api", "request", "rest", probePath, "--target-org", targetOrg, "--method", "GET"],
        { timeout: QUICK_PROBE_TIMEOUT_MS },
      );
      const probe = classifyProbeResult(
        "data_spaces",
        QUICK_PROBE_PATH,
        raw.code,
        raw.stdout,
        raw.stderr,
      );

      const severity =
        probe.state === "enabled_populated" ||
        probe.state === "enabled_empty" ||
        probe.state === "ok"
          ? "ok"
          : probe.state === "feature_gated" || probe.state === "tenant_missing"
            ? "warn"
            : "error";

      checks.push({
        id: "data360.data-spaces-probe",
        severity,
        title: `Data 360 readiness probe: ${probe.state}`,
        detail: probe.message ?? `${probePath} (${probe.exitCode ?? "?"})`,
        fix:
          severity === "warn"
            ? "Run `d360_probe` for the full readiness map and surface-level details."
            : undefined,
      });
    } catch (error) {
      checks.push({
        id: "data360.data-spaces-probe",
        severity: "warn",
        title: "Quick Data 360 probe failed",
        detail: error instanceof Error ? error.message : String(error),
        fix: "Run `d360_probe` for a full diagnostic; check sf org list and Data 360 entitlement.",
      });
    }

    const summary = checks.every((c) => c.severity === "ok") ? "✓ ready" : "! issues detected";
    return {
      extensionId: "sf-data360",
      title: "SF Data 360",
      checks,
      summary,
    };
  };
}
