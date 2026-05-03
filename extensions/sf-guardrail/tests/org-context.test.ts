/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Org context resolution — we want to verify:
 *   - `-o <alias>` wins over the default from the env cache
 *   - fall back to the default alias when unflagged
 *   - user-provided productionAliases always map to "production"
 *   - unknown aliases (no cache, no list) fail closed to "production"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";

// Mock the shared cache module. The returned `env` is set per-test via
// `setEnv(...)` so each scenario is explicit.
let mockedEnv: SfEnvironment | null = null;

vi.mock("../../../lib/common/sf-environment/shared-runtime.ts", () => ({
  getCachedSfEnvironment: () => mockedEnv,
}));

import { resolveOrgContext } from "../lib/org-context.ts";

function setEnv(env: SfEnvironment | null): void {
  mockedEnv = env;
}

function makeEnv(orgAlias: string, orgType: SfEnvironment["org"]["orgType"]): SfEnvironment {
  return {
    cli: { installed: true, version: "2.0.0" },
    project: { detected: false },
    config: { hasTargetOrg: true, targetOrg: orgAlias, location: "Global" },
    org: { detected: true, alias: orgAlias, orgType },
    detectedAt: Date.now(),
  };
}

beforeEach(() => setEnv(null));
afterEach(() => setEnv(null));

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

  it("alias differs from default and not in productionAliases → fail closed", () => {
    setEnv(makeEnv("DevInt", "sandbox"));
    const ctx = resolveOrgContext("sf apex run -f x.apex -o OtherOrg", "/tmp", []);
    expect(ctx.alias).toBe("OtherOrg");
    expect(ctx.type).toBe("production");
    expect(ctx.guessed).toBe(true);
  });
});
