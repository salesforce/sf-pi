/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Config loader tests — bundled defaults load, user override merges by id,
 * unknown fields are sanitized away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, readBundledConfig } from "../lib/config.ts";

let tempAgentDir: string;

vi.mock("@mariozechner/pi-coding-agent", () => ({
  getAgentDir: () => tempAgentDir,
}));

beforeEach(() => {
  tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-guardrail-test-"));
});

afterEach(() => {
  rmSync(tempAgentDir, { recursive: true, force: true });
});

describe("bundled defaults", () => {
  it("parse without error and ship the expected rules", () => {
    const config = readBundledConfig();
    expect(config.enabled).toBe(true);
    const policyIds = config.policies.rules.map((r) => r.id);
    expect(policyIds).toContain("sf-destructive-changes-xml");
    expect(policyIds).toContain("sf-forceignore");
    expect(policyIds).toContain("sf-cli-state");
    expect(policyIds).toContain("secret-files");
    const cmdIds = config.commandGate.patterns.map((p) => p.id);
    expect(cmdIds).toEqual(
      expect.arrayContaining(["rm-rf", "sudo", "sf-org-delete", "git-force-push"]),
    );
    const orgRuleIds = config.orgAwareGate.rules.map((r) => r.id);
    expect(orgRuleIds).toEqual(
      expect.arrayContaining([
        "sf-deploy-prod",
        "sf-apex-run-prod",
        "sf-data-mutate-prod",
        "sf-org-api-destructive-prod",
      ]),
    );
  });
});

describe("loadConfig with user override", () => {
  function writeOverride(content: unknown): void {
    const dir = path.join(tempAgentDir, "sf-guardrail");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "rules.json"), JSON.stringify(content), "utf8");
  }

  it("returns bundled when no override is present", () => {
    const { source, config } = loadConfig();
    expect(source).toBe("bundled");
    expect(config.policies.rules.length).toBeGreaterThan(0);
  });

  it("replaces a bundled rule by id (last wins)", () => {
    writeOverride({
      policies: {
        rules: [
          {
            id: "sf-forceignore",
            patterns: [{ pattern: "**/.forceignore" }],
            protection: "none",
          },
        ],
      },
    });
    const { source, config } = loadConfig();
    expect(source).toBe("override");
    const rule = config.policies.rules.find((r) => r.id === "sf-forceignore");
    expect(rule?.protection).toBe("none");
    // Other bundled rules remain intact.
    expect(config.policies.rules.find((r) => r.id === "sf-destructive-changes-xml")).toBeDefined();
  });

  it("disables a bundled rule when override sets enabled: false", () => {
    writeOverride({
      policies: {
        rules: [
          {
            id: "secret-files",
            patterns: [{ pattern: ".env" }],
            protection: "noAccess",
            enabled: false,
          },
        ],
      },
    });
    const { config } = loadConfig();
    const rule = config.policies.rules.find((r) => r.id === "secret-files");
    expect(rule?.enabled).toBe(false);
  });

  it("merges scalar fields (productionAliases) from override", () => {
    writeOverride({ productionAliases: ["prod", "production"] });
    const { config } = loadConfig();
    expect(config.productionAliases).toEqual(["prod", "production"]);
  });

  it("ignores malformed JSON silently (fails safe to bundled)", () => {
    const dir = path.join(tempAgentDir, "sf-guardrail");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "rules.json"), "{ not json", "utf8");
    const { source } = loadConfig();
    expect(source).toBe("bundled");
  });

  it("adds new rules that do not collide with bundled ids", () => {
    writeOverride({
      policies: {
        rules: [
          {
            id: "custom-certs",
            patterns: [{ pattern: "*.pem" }],
            protection: "noAccess",
          },
        ],
      },
    });
    const { config } = loadConfig();
    expect(config.policies.rules.find((r) => r.id === "custom-certs")).toBeDefined();
    // Plus bundled rules are still present.
    expect(config.policies.rules.find((r) => r.id === "sf-destructive-changes-xml")).toBeDefined();
  });
});
