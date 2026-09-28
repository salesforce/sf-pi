/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only readiness report shared by /sf-planreview doctor and /sf-pi doctor. */
import type { ExtensionDoctorReport } from "../../../lib/common/doctor/registry.ts";
import type { PlannotatorRuntimeStatus } from "../../../lib/common/plannotator-runtime.ts";

export function buildPlanReviewDoctor(
  status: PlannotatorRuntimeStatus,
  savedReviews = 0,
): ExtensionDoctorReport {
  const standalone =
    status.managedState === "damaged"
      ? {
          severity: "error" as const,
          title: "Managed TUI needs repair",
          detail: "The managed binary failed checksum or version verification.",
          fix: "Run /sf-planreview setup to reinstall the pinned binary.",
        }
      : status.standaloneReady
        ? {
            severity: "ok" as const,
            title: "Standalone TUI ready",
            detail:
              status.managedState === "verified"
                ? "Pinned, checksum-verified binary is available."
                : "An existing plannotator-tui command is available.",
          }
        : status.managedState === "unsupported"
          ? {
              severity: "info" as const,
              title: "Managed TUI not supported on this platform",
              detail: "No pinned binary is published for this platform.",
              fix: "Use the official Plannotator TUI release or Cargo installation instructions.",
            }
          : status.herdrReady
            ? {
                severity: "info" as const,
                title: "TUI available via Herdr plugin",
                detail:
                  "Document review works on this host, but the standalone TUI is Herdr-owned.",
                fix: "Run /sf-planreview setup tui for an independent installation.",
              }
            : {
                severity: "info" as const,
                title: "Standalone TUI not installed",
                detail: "Optional outside Herdr.",
                fix: "Run /sf-planreview setup for explicit installation.",
              };
  const herdr =
    status.herdrState === "ready"
      ? {
          severity: "ok" as const,
          title: "Herdr Annotate Full ready",
          detail: "The official Full plugin and its TUI are available.",
        }
      : status.herdrState === "broken" || status.herdrState === "unverified"
        ? {
            severity: "error" as const,
            title: "Herdr review needs repair",
            detail:
              status.herdrState === "broken"
                ? "The Full plugin is missing a working TUI."
                : "The plugin source is not the official Herdr Annotate package.",
            fix: "Inspect the Herdr plugin, then run /sf-planreview setup herdr if appropriate.",
          }
        : status.herdrState === "lite" || status.herdrState === "disabled"
          ? {
              severity: "warn" as const,
              title: "Herdr document review unavailable",
              detail:
                status.herdrState === "lite"
                  ? "The Lite plugin cannot review documents or replies."
                  : "The Full plugin is disabled.",
              fix: "Use /sf-planreview setup herdr to install Full, or enable the existing plugin.",
            }
          : {
              severity: "info" as const,
              title: "Herdr plugin not installed",
              detail:
                status.herdrState === "unavailable"
                  ? "Herdr is not available in this runtime."
                  : "Optional when using the standalone TUI.",
              fix: "Inside Herdr, run /sf-planreview setup herdr to install Full explicitly.",
            };
  return {
    extensionId: "sf-planreview",
    title: "SF Plan Review",
    summary: status.installed ? "Plannotator TUI available" : "Plannotator TUI setup needed",
    checks: [
      {
        id: "planreview.runtime",
        severity: status.installed ? "ok" : "warn",
        title: status.installed ? "Document review available" : "No document-review TUI available",
        detail: status.installed
          ? `Plannotator TUI${status.version ? ` v${status.version}` : ""} is available.`
          : "Install the official standalone TUI or Herdr Annotate Full.",
      },
      { id: "planreview.standalone", ...standalone },
      { id: "planreview.herdr", ...herdr },
      ...(savedReviews > 0
        ? [
            {
              id: "planreview.retention",
              severity: "info" as const,
              title: `${savedReviews} private review snapshot(s) retained`,
              detail: "Herdr reviews can remain open after feedback is sent.",
              fix: "Close open reviews, then run /sf-planreview cleanup to clear their private copies.",
            },
          ]
        : []),
    ],
  };
}

export function renderPlanReviewDoctor(report: ExtensionDoctorReport): string {
  return [
    report.title,
    ...report.checks.map(
      (check) =>
        `${check.severity === "ok" ? "✓" : check.severity === "info" ? "○" : "!"} ${check.title}: ${check.detail}${check.fix ? `\n  → ${check.fix}` : ""}`,
    ),
  ].join("\n");
}
