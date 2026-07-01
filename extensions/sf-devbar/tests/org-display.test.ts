/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { extractSfEnvironmentEntries, selectDisplayOrgEnvironment } from "../lib/org-display.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";

function env(overrides: Partial<SfEnvironment> = {}): SfEnvironment {
  return {
    cli: { installed: true, version: "2.140.6" },
    project: {
      detected: true,
      projectRoot: "/tmp/project",
      projectPath: "/tmp/project/sfdx-project.json",
      name: "project",
    },
    config: { hasTargetOrg: true, targetOrg: "DemoOrg", location: "Global" },
    org: {
      detected: true,
      alias: "DemoOrg",
      orgId: "00D000000000001AAA",
      orgType: "sandbox",
      connectedStatus: "Connected",
    },
    detectedAt: 1,
    ...overrides,
  };
}

function failedEnv(error = "The org cannot be found"): SfEnvironment {
  return env({
    org: {
      detected: false,
      orgType: "unknown",
      error,
    },
    detectedAt: 2,
  });
}

describe("selectDisplayOrgEnvironment", () => {
  it("uses the current org when the current probe succeeded", () => {
    const current = env({ detectedAt: 3 });
    const selected = selectDisplayOrgEnvironment(current, [env({ detectedAt: 1 })], null);

    expect(selected.env).toBe(current);
    expect(selected.stale).toBe(false);
  });

  it("falls back to the latest matching successful branch environment", () => {
    const oldSuccess = env({ detectedAt: 1, org: { ...env().org, alias: "Old" } });
    const latestSuccess = env({ detectedAt: 2, org: { ...env().org, alias: "Latest" } });
    const selected = selectDisplayOrgEnvironment(failedEnv(), [oldSuccess, latestSuccess], null);

    expect(selected.env?.org.alias).toBe("Latest");
    expect(selected.stale).toBe(true);
    expect(selected.currentError).toBe("The org cannot be found");
  });

  it("falls back to matching successful persisted environment when branch has no success", () => {
    const persisted = env({ detectedAt: 1 });
    const selected = selectDisplayOrgEnvironment(failedEnv(), [], persisted);

    expect(selected.env).toBe(persisted);
    expect(selected.stale).toBe(true);
  });

  it("does not use an alias-only successful environment as fallback", () => {
    const { orgId: _orgId, ...aliasOnlyOrg } = env().org;
    const aliasOnly = env({ org: aliasOnlyOrg });
    const current = failedEnv();
    const selected = selectDisplayOrgEnvironment(current, [aliasOnly], null);

    expect(selected.env).toBe(current);
    expect(selected.stale).toBe(false);
  });

  it("does not use a successful environment from another target org", () => {
    const otherTarget = env({
      config: { hasTargetOrg: true, targetOrg: "Other", location: "Global" },
    });
    const current = failedEnv();
    const selected = selectDisplayOrgEnvironment(current, [otherTarget], null);

    expect(selected.env).toBe(current);
    expect(selected.stale).toBe(false);
  });
});

describe("extractSfEnvironmentEntries", () => {
  it("extracts sf-environment custom entries in order", () => {
    const first = env({ detectedAt: 1 });
    const second = env({ detectedAt: 2 });
    const entries = [
      { type: "message", message: { role: "user", content: "ignore" } },
      { type: "custom", customType: "sf-environment", data: { env: first } },
      { type: "custom", customType: "other", data: { env: failedEnv() } },
      { type: "custom", customType: "sf-environment", data: { env: second } },
    ];

    expect(extractSfEnvironmentEntries(entries)).toEqual([first, second]);
  });
});
