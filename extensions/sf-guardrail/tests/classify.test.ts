/* SPDX-License-Identifier: Apache-2.0 */
/**
 * End-to-end classification tests — wire the real config + bundled defaults
 * through classify() and assert on the decisions for representative tool
 * calls. These are the contract for the tool_call handler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";

let mockedEnv: SfEnvironment | null = null;

vi.mock("../../../lib/common/sf-environment/shared-runtime.ts", () => ({
  getCachedSfEnvironment: () => mockedEnv,
}));

// File-existence check path for policies.matchPath. onlyIfExists defaults true
// in bundled rules; force-resolve to true so we're testing path matching, not
// filesystem state.
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: () => true,
  };
});

import { classify } from "../lib/classify.ts";
import { readBundledConfig } from "../lib/config.ts";

function env(orgAlias: string, orgType: SfEnvironment["org"]["orgType"]): SfEnvironment {
  return {
    cli: { installed: true, version: "2.0.0" },
    project: { detected: false },
    config: { hasTargetOrg: true, targetOrg: orgAlias, location: "Global" },
    org: { detected: true, alias: orgAlias, orgType },
    detectedAt: Date.now(),
  };
}

beforeEach(() => {
  mockedEnv = null;
});
afterEach(() => {
  mockedEnv = null;
});

describe("classify — policies (Tier 1)", () => {
  it("blocks writes to destructiveChanges.xml", () => {
    const config = readBundledConfig();
    const decision = classify({
      toolName: "write",
      input: { path: "force-app/main/default/destructiveChanges.xml" },
      cwd: "/project",
      config,
    });
    expect(decision?.feature).toBe("policies");
    expect(decision?.action).toBe("block");
    expect(decision?.ruleId).toBe("sf-destructive-changes-xml");
  });

  it("blocks writes to .sf/**", () => {
    const config = readBundledConfig();
    const decision = classify({
      toolName: "write",
      input: { path: ".sf/orgs.json" },
      cwd: "/project",
      config,
    });
    expect(decision?.action).toBe("block");
    expect(decision?.ruleId).toBe("sf-cli-state");
  });

  it("allows reads to .forceignore (readOnly, not noAccess)", () => {
    const config = readBundledConfig();
    const decision = classify({
      toolName: "read",
      input: { path: ".forceignore" },
      cwd: "/project",
      config,
    });
    expect(decision).toBeUndefined();
  });

  it("blocks writes to .forceignore (readOnly)", () => {
    const config = readBundledConfig();
    const decision = classify({
      toolName: "write",
      input: { path: ".forceignore" },
      cwd: "/project",
      config,
    });
    expect(decision?.ruleId).toBe("sf-forceignore");
    expect(decision?.action).toBe("block");
  });

  it("allows reads to .env.example (allowedPatterns short-circuits)", () => {
    const config = readBundledConfig();
    const decision = classify({
      toolName: "read",
      input: { path: ".env.example" },
      cwd: "/project",
      config,
    });
    expect(decision).toBeUndefined();
  });
});

describe("classify — commandGate (Tier 2)", () => {
  it("confirms rm -rf", () => {
    const config = readBundledConfig();
    const decision = classify({
      toolName: "bash",
      input: { command: "rm -rf tmp/" },
      cwd: "/project",
      config,
    });
    expect(decision?.feature).toBe("commandGate");
    expect(decision?.action).toBe("confirm");
    expect(decision?.ruleId).toBe("rm-rf");
  });

  it("confirms sf org delete", () => {
    const config = readBundledConfig();
    const decision = classify({
      toolName: "bash",
      input: { command: "sf org delete scratch -o MyScratch" },
      cwd: "/project",
      config,
    });
    expect(decision?.ruleId).toBe("sf-org-delete");
  });

  it("ignores benign commands", () => {
    const config = readBundledConfig();
    const decision = classify({
      toolName: "bash",
      input: { command: "sf org list --all --json" },
      cwd: "/project",
      config,
    });
    expect(decision).toBeUndefined();
  });
});

describe("classify — orgAwareGate (Tier 2)", () => {
  it("confirms sf project deploy start against production", () => {
    mockedEnv = env("Prod", "production");
    const config = readBundledConfig();
    const decision = classify({
      toolName: "bash",
      input: { command: "sf project deploy start -o Prod" },
      cwd: "/project",
      config,
    });
    expect(decision?.feature).toBe("orgAwareGate");
    expect(decision?.ruleId).toBe("sf-deploy-prod");
    expect(decision?.orgAlias).toBe("Prod");
    expect(decision?.orgType).toBe("production");
  });

  it("does NOT fire for sandbox targets", () => {
    mockedEnv = env("DevInt", "sandbox");
    const config = readBundledConfig();
    const decision = classify({
      toolName: "bash",
      input: { command: "sf project deploy start -o DevInt" },
      cwd: "/project",
      config,
    });
    expect(decision).toBeUndefined();
  });

  it("confirms sf apex run on production", () => {
    mockedEnv = env("Prod", "production");
    const config = readBundledConfig();
    const decision = classify({
      toolName: "bash",
      input: { command: "sf apex run -f scripts/apex/check.apex -o Prod" },
      cwd: "/project",
      config,
    });
    expect(decision?.ruleId).toBe("sf-apex-run-prod");
  });

  it("confirms sf data upsert on production", () => {
    mockedEnv = env("Prod", "production");
    const config = readBundledConfig();
    const decision = classify({
      toolName: "bash",
      input: { command: "sf data upsert --file x.csv --sobject Account -o Prod" },
      cwd: "/project",
      config,
    });
    expect(decision?.ruleId).toBe("sf-data-mutate-prod");
  });

  it("confirms sf org api DELETE on production", () => {
    mockedEnv = env("Prod", "production");
    const config = readBundledConfig();
    const decision = classify({
      toolName: "bash",
      input: {
        command: "sf org api /services/data/v66.0/sobjects/Account/001x --method DELETE -o Prod",
      },
      cwd: "/project",
      config,
    });
    expect(decision?.ruleId).toBe("sf-org-api-destructive-prod");
  });

  it("does NOT fire for sf org api GET", () => {
    mockedEnv = env("Prod", "production");
    const config = readBundledConfig();
    const decision = classify({
      toolName: "bash",
      input: { command: "sf org api /services/data/v66.0/query --method GET -o Prod" },
      cwd: "/project",
      config,
    });
    expect(decision).toBeUndefined();
  });

  it("fails closed when alias is unknown and not in productionAliases", () => {
    mockedEnv = null;
    const config = readBundledConfig();
    const decision = classify({
      toolName: "bash",
      input: { command: "sf project deploy start -o SomeOrg" },
      cwd: "/project",
      config,
    });
    expect(decision?.feature).toBe("orgAwareGate");
    expect(decision?.orgType).toBe("production");
  });
});
