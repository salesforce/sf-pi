/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Org context resolution — we want to verify:
 *   - `-o <alias>` wins over the default from the env cache
 *   - fall back to the default alias when unflagged
 *   - user-provided productionAliases always map to "production"
 *   - unknown aliases (no cache, no list) fail closed to "production"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgInfo, SfEnvironment } from "../../../lib/common/sf-environment/types.ts";

// Mock the shared cache module. The returned `env` is set per-test via
// `setEnv(...)` so each scenario is explicit.
let mockedEnv: SfEnvironment | null = null;
let mockedLookup: Record<string, OrgInfo> = {};
let mockedDefaultTargetOrg: string | undefined;

vi.mock("../../../lib/common/sf-environment/shared-runtime.ts", () => ({
  getCachedSfEnvironment: () => mockedEnv,
}));

vi.mock("../../../lib/common/sf-environment/detect.ts", () => ({
  detectConfig: async () =>
    mockedDefaultTargetOrg
      ? { hasTargetOrg: true, targetOrg: mockedDefaultTargetOrg, location: "Global" }
      : { hasTargetOrg: false },
  detectOrg: async (targetOrg: string) =>
    mockedLookup[targetOrg] ?? { detected: false, orgType: "unknown" },
}));

import { resolveOrgContext, resolveOrgContextWithLookup } from "../lib/org-context.ts";

function setEnv(env: SfEnvironment | null): void {
  mockedEnv = env;
}

function makeEnv(orgAlias: string, orgType: SfEnvironment["org"]["orgType"]): SfEnvironment {
  return {
    cli: { installed: true, version: "2.0.0" },
    project: { detected: false },
    config: { hasTargetOrg: true, targetOrg: orgAlias, location: "Global" },
    org: {
      detected: true,
      alias: orgAlias,
      username: `${orgAlias}@example.test`,
      orgId: `00D${orgAlias}`,
      orgType,
    },
    detectedAt: Date.now(),
  };
}

beforeEach(() => {
  setEnv(null);
  mockedLookup = {};
  mockedDefaultTargetOrg = undefined;
});
afterEach(() => {
  setEnv(null);
  mockedLookup = {};
  mockedDefaultTargetOrg = undefined;
});

describe("resolveOrgContext", () => {
  it("prefers -o alias from the command over default", () => {
    setEnv(makeEnv("DevInt", "sandbox"));
    const ctx = resolveOrgContext("sf project deploy start -o Prod", "/tmp", ["Prod"]);
    expect(ctx.alias).toBe("Prod");
    expect(ctx.type).toBe("production");
  });

  it("falls back to default alias when no -o flag is present", () => {
    setEnv(makeEnv("DevInt", "sandbox"));
    const ctx = resolveOrgContext("sf project deploy start", "/tmp", []);
    expect(ctx.alias).toBe("DevInt");
    expect(ctx.type).toBe("sandbox");
    expect(ctx.guessed).toBe(false);
  });

  it("user productionAliases override cached type", () => {
    setEnv(makeEnv("DevInt", "sandbox"));
    const ctx = resolveOrgContext("sf project deploy start -o DevInt", "/tmp", ["DevInt"]);
    expect(ctx.type).toBe("production");
  });

  it("unknown alias with no cache info fails closed to production", () => {
    setEnv(null);
    const ctx = resolveOrgContext("sf project deploy start -o SomethingNew", "/tmp", []);
    expect(ctx.type).toBe("production");
    expect(ctx.guessed).toBe(true);
  });

  it("no alias at all (unflagged, no default) fails closed to production", () => {
    setEnv(null);
    const ctx = resolveOrgContext("sf project deploy start", "/tmp", []);
    expect(ctx.alias).toBeUndefined();
    expect(ctx.type).toBe("production");
    expect(ctx.guessed).toBe(true);
  });

  it("alias matches default → uses cached org type", () => {
    setEnv(makeEnv("Prod", "production"));
    const ctx = resolveOrgContext("sf apex run -f x.apex -o Prod", "/tmp", []);
    expect(ctx.type).toBe("production");
    expect(ctx.guessed).toBe(false);
  });

  it("username matching cached org uses cached org type", () => {
    setEnv(makeEnv("DevInt", "sandbox"));
    const ctx = resolveOrgContext("sf apex run -f x.apex -o DevInt@example.test", "/tmp", []);
    expect(ctx.type).toBe("sandbox");
    expect(ctx.guessed).toBe(false);
  });

  it("unknown cached default org type fails closed to production", () => {
    setEnv(makeEnv("Mystery", "unknown"));
    const ctx = resolveOrgContext("sf apex run -f x.apex -o Mystery", "/tmp", []);
    expect(ctx.type).toBe("production");
    expect(ctx.guessed).toBe(true);
  });

  it("bounded lookup resolves explicit scratch aliases", async () => {
    setEnv(makeEnv("DevInt", "sandbox"));
    mockedLookup.Scratch = {
      detected: true,
      alias: "Scratch",
      username: "scratch@example.test",
      orgId: "00DScratch",
      orgType: "scratch",
    };
    const ctx = await resolveOrgContextWithLookup("sf project deploy start -o Scratch", "/tmp", []);
    expect(ctx.type).toBe("scratch");
    expect(ctx.source).toBe("lookup");
    expect(ctx.guessed).toBe(false);
    expect(ctx.explicit).toBe(true);
  });

  it("bounded lookup resolves the unflagged default scratch org when the cache is missing", async () => {
    mockedDefaultTargetOrg = "Scratch";
    mockedLookup.Scratch = {
      detected: true,
      alias: "Scratch",
      username: "scratch@example.test",
      orgId: "00DScratch",
      orgType: "scratch",
    };

    const ctx = await resolveOrgContextWithLookup("sf project deploy start", "/tmp", []);

    expect(ctx.alias).toBe("Scratch");
    expect(ctx.type).toBe("scratch");
    expect(ctx.source).toBe("lookup");
    expect(ctx.guessed).toBe(false);
    expect(ctx.explicit).toBe(false);
  });

  it("prefers live default config over a guessed cached default", async () => {
    setEnv(makeEnv("StaleDefault", "unknown"));
    mockedDefaultTargetOrg = "Scratch";
    mockedLookup.Scratch = {
      detected: true,
      alias: "Scratch",
      username: "scratch@example.test",
      orgId: "00DScratch",
      orgType: "scratch",
    };

    const ctx = await resolveOrgContextWithLookup("sf project deploy start", "/tmp", []);

    expect(ctx.alias).toBe("Scratch");
    expect(ctx.type).toBe("scratch");
    expect(ctx.source).toBe("lookup");
    expect(ctx.guessed).toBe(false);
  });

  it("alias differs from default and not in productionAliases → fail closed", () => {
    setEnv(makeEnv("DevInt", "sandbox"));
    const ctx = resolveOrgContext("sf apex run -f x.apex -o OtherOrg", "/tmp", []);
    expect(ctx.alias).toBe("OtherOrg");
    expect(ctx.type).toBe("production");
    expect(ctx.guessed).toBe(true);
  });
});
