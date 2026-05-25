/* SPDX-License-Identifier: Apache-2.0 */
/** Command handlers for `/sf-pi doctor`. */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { applyDoctorFixes } from "../../../lib/common/doctor/fixes.ts";
import { runDoctorDiagnostics } from "../../../lib/common/doctor/diagnostics.ts";
import {
  runRegisteredDoctors,
  type RegisteredDoctorOutcome,
} from "../../../lib/common/doctor/registry.ts";
import type { DoctorIssue, DoctorReport } from "../../../lib/common/doctor/types.ts";
import { writeCachedRuntimeDiagnostics } from "../../../lib/common/doctor/runtime-cache.ts";

export type DoctorSubcommand = "status" | "fix" | "runtime";
export type DoctorFixTarget = "all" | "startup" | "skills";

export interface DoctorArgs {
  subcommand: DoctorSubcommand;
  target?: DoctorFixTarget;
}

const PREFIX = "/sf-pi doctor";

export function parseDoctorArgs(raw: string): DoctorArgs {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const sub = (tokens[0] ?? "").toLowerCase();
  const target = (tokens[1] ?? "").toLowerCase();

  if (sub === "runtime" || sub === "rt") {
    return { subcommand: "runtime" };
  }

  if (sub === "fix" || sub === "repair") {
    if (target === "startup" || target === "start") return { subcommand: "fix", target: "startup" };
    if (target === "skills" || target === "skill") return { subcommand: "fix", target: "skills" };
    return { subcommand: "fix", target: "all" };
  }
  return { subcommand: "status" };
}

export async function handleDoctor(ctx: ExtensionCommandContext, args: DoctorArgs): Promise<void> {
  if (args.subcommand === "fix") {
    await handleFix(ctx, args.target ?? "all");
    return;
  }
  if (args.subcommand === "runtime") {
    handleRuntime(ctx);
    return;
  }
  await handleStatus(ctx);
}

function handleRuntime(ctx: ExtensionCommandContext): void {
  const report = runDoctorDiagnostics({ cwd: ctx.cwd });
  writeCachedRuntimeDiagnostics(report.runtime);
  ctx.ui.notify(renderRuntimeReport(report), "info");
}

async function handleStatus(ctx: ExtensionCommandContext): Promise<void> {
  const report = runDoctorDiagnostics({ cwd: ctx.cwd });
  writeCachedRuntimeDiagnostics(report.runtime);
  // Aggregate every registered per-extension doctor with a small budget so
  // a slow network probe never blocks the report. Slow / failed providers
  // are surfaced inline as "timeout" / "error" rows.
  const extensionOutcomes = await runRegisteredDoctors({ cwd: ctx.cwd });

  const lines = [renderDoctorReport(report)];
  if (extensionOutcomes.length > 0) {
    lines.push("", renderExtensionOutcomes(extensionOutcomes));
  }

  const hasErrors =
    report.issues.some((i) => i.severity === "error") ||
    extensionOutcomes.some(
      (o) => o.status === "error" || o.report?.checks.some((c) => c.severity === "error"),
    );

  ctx.ui.notify(lines.join("\n"), hasErrors ? "warning" : "info");
}

async function handleFix(ctx: ExtensionCommandContext, target: DoctorFixTarget): Promise<void> {
  const report = runDoctorDiagnostics({ cwd: ctx.cwd });
  writeCachedRuntimeDiagnostics(report.runtime);
  const hasStartupFix = target === "all" || target === "startup";
  const hasSkillsFix = target === "all" || target === "skills";

  const planned: string[] = [];
  if (hasStartupFix) planned.push("set quietStartup=true and sfPi.welcome.mode=header");
  if (hasSkillsFix) {
    if (report.skillCollisions.length > 0) {
      planned.push(
        "move duplicate sf-* skills from pi-owned roots to a timestamped quarantine folder",
      );
    }
    if (report.staleSkillPaths.length > 0) planned.push("prune stale settings.skills[] paths");
    if (report.availableSkillRoots.length > 0) {
      planned.push("link available Claude/Codex/Cursor skill roots into settings.skills[]");
    }
  }

  if (planned.length === 0) {
    ctx.ui.notify("sf-pi doctor found no applicable fixes for this target.", "info");
    return;
  }

  if (ctx.hasUI) {
    const ok = await ctx.ui.confirm(
      "Apply sf-pi doctor fixes?",
      [
        "sf-pi will apply these non-destructive repairs:",
        "",
        ...planned.map((line) => `• ${line}`),
        "",
        "Duplicate skills are moved to quarantine, not deleted.",
        "Apply fixes and reload?",
      ].join("\n"),
    );
    if (!ok) {
      ctx.ui.notify("Doctor fix cancelled.", "info");
      return;
    }
  }

  const result = applyDoctorFixes({
    cwd: ctx.cwd,
    fixStartup: hasStartupFix,
    fixSkills: hasSkillsFix,
    fixStaleSkillPaths: hasSkillsFix,
    fixSkillLinks: hasSkillsFix,
  });

  const lines = ["sf-pi doctor fix result", "", ...result.messages];
  if (result.quarantineDir) lines.push("", `Quarantine: ${result.quarantineDir}`);
  if (result.quarantinedSkills.length > 0) {
    lines.push("", "Moved:");
    for (const moved of result.quarantinedSkills.slice(0, 12)) {
      lines.push(`  ${moved.name}: ${moved.from} → ${moved.to}`);
    }
    if (result.quarantinedSkills.length > 12) {
      lines.push(`  …and ${result.quarantinedSkills.length - 12} more`);
    }
  }

  if (result.changed) lines.push("", "Reloading…");
  ctx.ui.notify(lines.join("\n"), "info");
  if (result.changed) await ctx.reload();
}

function renderRuntimeReport(report: DoctorReport): string {
  const runtime = report.runtime;
  const lines = [
    "sf-pi Runtime Doctor",
    "",
    `Pi runtime:       ${runtime.piVersion ?? "unknown"}`,
    `Required pi:      >=${runtime.requiredPiVersion}`,
    `Node.js:          ${runtime.nodeVersion}`,
    `Node executable:  ${runtime.nodePath ?? "unknown"}`,
    `npm executable:   ${runtime.npmPath ?? "unknown"}`,
    `pi executable:    ${runtime.piPath ?? "unknown"}`,
    `npm global root:  ${runtime.npmGlobalRoot ?? "unknown"}`,
    `npm before:       ${runtime.npmBefore ?? "not set"}`,
    `npm min-release-age: ${runtime.npmMinReleaseAge ?? "not set"}`,
    `npm minimum-release-age: ${runtime.npmMinimumReleaseAge ?? "not set"}`,
    `Installed package: ${runtime.installedPiPackageVersion ? `@earendil-works/pi-coding-agent@${runtime.installedPiPackageVersion}` : "unknown"}`,
    `Latest package:    ${runtime.latestPiPackageVersion ? `@earendil-works/pi-coding-agent@${runtime.latestPiPackageVersion}` : "unknown"}`,
    "",
    "All pi executables:",
    ...(runtime.allPiPaths.length > 0
      ? runtime.allPiPaths.map((item) => `  ${item}`)
      : ["  none found"]),
    "",
    "Suggested repair:",
    ...runtime.updateAdvice.map((item) => `  ${item}`),
  ];
  return lines.join("\n");
}

function renderDoctorReport(report: DoctorReport): string {
  const lines = [
    "sf-pi Doctor",
    "",
    `Pi runtime:       ${report.piVersion ?? "unknown"}`,
    `Node.js:          ${report.nodeVersion}`,
    `Quiet startup:    ${report.quietStartup ? "yes" : "no"}`,
    `Welcome mode:     ${report.welcomeMode ?? "auto"}`,
    `Safe start env:   ${report.safeStartRequested ? "yes" : "no"}`,
    "",
  ];

  if (report.issues.length === 0) {
    lines.push("✓ No setup issues detected.");
  } else {
    lines.push("Issues:");
    for (const issue of report.issues) lines.push(...renderIssue(issue));
  }

  if (report.skillCollisions.length > 0) {
    lines.push("", "Skill collisions:");
    for (const collision of report.skillCollisions.slice(0, 10)) {
      lines.push(`  ${collision.name}:`);
      lines.push(`    keep: ${collision.preferred.file}`);
      for (const duplicate of collision.duplicates) lines.push(`    duplicate: ${duplicate.file}`);
    }
    if (report.skillCollisions.length > 10) {
      lines.push(`  …and ${report.skillCollisions.length - 10} more collision(s)`);
    }
  }

  if (report.staleSkillPaths.length > 0) {
    lines.push("", "Stale skills[] paths:");
    for (const stale of report.staleSkillPaths) lines.push(`  ${stale.raw} → ${stale.resolved}`);
  }

  if (report.availableSkillRoots.length > 0) {
    lines.push("", "Available external skill roots:");
    for (const root of report.availableSkillRoots) {
      lines.push(
        `  ${root.label}: ${root.settingsPath} (${root.skillCount} skill${root.skillCount === 1 ? "" : "s"})`,
      );
    }
  }

  lines.push("", `Runtime diagnostics: ${PREFIX} runtime`);
  lines.push(`Fix startup only: ${PREFIX} fix startup`);
  lines.push(`Fix skill wiring/collisions: ${PREFIX} fix skills`);
  lines.push(`Fix all safe issues: ${PREFIX} fix`);
  lines.push("Recovery launch: SF_PI_SAFE_START=1 pi");

  return lines.join("\n");
}

function renderIssue(issue: DoctorIssue): string[] {
  const icon = issue.severity === "error" ? "✗" : issue.severity === "warn" ? "!" : "•";
  const lines = [`  ${icon} ${issue.title}`, `    ${issue.detail}`];
  if (issue.fix) lines.push(`    Fix: ${issue.fix}`);
  return lines;
}

/**
 * Exported for unit tests so the manager's aggregated render shape is
 * pinned. Production callers go through `handleDoctor` which already wires
 * this into the registered providers.
 */
export function renderExtensionOutcomes(outcomes: RegisteredDoctorOutcome[]): string {
  const lines: string[] = ["Extension diagnostics:"];
  for (const outcome of outcomes) {
    if (outcome.status === "timeout") {
      lines.push("", `  ${outcome.extensionId} \u2014 timed out after ${outcome.durationMs}ms`);
      continue;
    }
    if (outcome.status === "error") {
      lines.push("", `  ${outcome.extensionId} \u2014 errored: ${outcome.error ?? "unknown"}`);
      continue;
    }
    const report = outcome.report;
    if (!report) continue;
    lines.push("", `  ${report.title}${report.summary ? `  ${report.summary}` : ""}`);
    for (const check of report.checks) {
      const icon =
        check.severity === "error"
          ? "\u2717"
          : check.severity === "warn"
            ? "!"
            : check.severity === "ok"
              ? "\u2713"
              : "\u2022";
      lines.push(`    ${icon} ${check.title}`);
      if (check.detail) lines.push(`      ${check.detail}`);
      if (check.fix) lines.push(`      Fix: ${check.fix}`);
    }
  }
  return lines.join("\n");
}
