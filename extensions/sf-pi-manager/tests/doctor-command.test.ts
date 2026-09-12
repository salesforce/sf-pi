/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the per-extension doctor aggregation rendering inside
 * `/sf-pi doctor`. Pins the shape so future ADR-0006 follow-ups don't
 * accidentally drift the user-visible block.
 */
import { describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleDoctor, renderExtensionOutcomes } from "../lib/doctor-command.ts";
import type { RegisteredDoctorOutcome } from "../../../lib/common/doctor/registry.ts";

const SAMPLE_OUTCOMES: RegisteredDoctorOutcome[] = [
  {
    extensionId: "sf-alpha",
    status: "ok",
    durationMs: 12,
    report: {
      extensionId: "sf-alpha",
      title: "SF Alpha",
      summary: "✓ ok",
      durationMs: 12,
      checks: [
        {
          id: "alpha.basic",
          severity: "ok",
          title: "Alpha basic check",
          detail: "All good",
        },
        {
          id: "alpha.warn",
          severity: "warn",
          title: "Alpha needs attention",
          detail: "Token rotated less than 24h ago",
          fix: "Run /alpha refresh",
        },
      ],
    },
  },
  {
    extensionId: "sf-bad",
    status: "error",
    durationMs: 4,
    error: "kaboom",
  },
  {
    extensionId: "sf-slow",
    status: "timeout",
    durationMs: 5_001,
  },
];

vi.mock("../../../lib/common/doctor/diagnostics.ts", () => ({
  runDoctorDiagnostics: () => ({
    piVersion: "0.85.1",
    nodeVersion: "v22.19.0",
    runtime: {},
    quietStartup: true,
    welcomeMode: "header",
    safeStartRequested: false,
    welcomeDisabled: false,
    issues: [],
    skillCollisions: [],
    staleSkillPaths: [],
    availableSkillRoots: [],
    sfPiPackageDuplicates: [],
  }),
}));
vi.mock("../lib/pi-web-access-doctor.ts", () => ({
  runPiWebAccessDoctor: vi.fn().mockResolvedValue({
    extensionId: "sf-pi-manager",
    title: "pi-web-access compatibility",
    summary: "1 warning",
    durationMs: 3,
    checks: [
      {
        id: "pi-web-access.synthetic-dns",
        severity: "warn",
        title: "pi-web-access may reject public fetches behind synthetic DNS",
        detail: "github.com resolved into a reserved range.",
        fix: "Review web-search.json.",
      },
    ],
  }),
}));
vi.mock("../../../lib/common/doctor/runtime-cache.ts", () => ({
  writeCachedRuntimeDiagnostics: vi.fn(),
}));
vi.mock("../../../lib/common/doctor/fixes.ts", () => ({
  applyDoctorFixes: () => ({
    changed: true,
    messages: ["Updated startup settings."],
    quarantinedSkills: [],
  }),
}));

describe("handleDoctor", () => {
  it("reports that fix reloaded the runtime so callers do not reuse the stale ctx", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      cwd: "/tmp/sf-pi-doctor-test",
      hasUI: false,
      ui: { notify: vi.fn() },
      reload,
    };

    await expect(
      handleDoctor(ctx as unknown as ExtensionCommandContext, {
        subcommand: "fix",
        target: "startup",
      }),
    ).resolves.toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("includes recommended pi-web-access compatibility diagnostics in status", async () => {
    const notify = vi.fn();
    const ctx = {
      cwd: "/tmp/sf-pi-doctor-test",
      hasUI: false,
      ui: { notify },
      reload: vi.fn(),
    };

    await handleDoctor(ctx as unknown as ExtensionCommandContext, { subcommand: "status" });

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("pi-web-access may reject public fetches behind synthetic DNS"),
      "info",
    );
  });
});

describe("renderExtensionOutcomes", () => {
  it("renders OK outcomes with their per-check rows and summaries", () => {
    const text = renderExtensionOutcomes([SAMPLE_OUTCOMES[0]!]);
    expect(text).toContain("Extension diagnostics:");
    expect(text).toContain("SF Alpha");
    expect(text).toContain("✓ Alpha basic check");
    expect(text).toContain("! Alpha needs attention");
    expect(text).toContain("Fix: Run /alpha refresh");
  });

  it("surfaces error outcomes inline without blocking the rest of the report", () => {
    const text = renderExtensionOutcomes(SAMPLE_OUTCOMES);
    expect(text).toContain("sf-bad — errored: kaboom");
    expect(text).toContain("sf-slow — timed out after 5001ms");
    // OK outcomes still appear alongside failures.
    expect(text).toContain("SF Alpha");
  });

  it("returns just the heading when given an empty list", () => {
    const text = renderExtensionOutcomes([]);
    expect(text).toBe("Extension diagnostics:");
  });
});
