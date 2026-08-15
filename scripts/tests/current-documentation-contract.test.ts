/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("current documentation authority", () => {
  it("leaves shipped release history to release-please", () => {
    const changelog = read("CHANGELOG.md");
    const unreleased = changelog.match(/^## Unreleased\s*\n([\s\S]*?)(?=^## \[|$)/m)?.[1] ?? "";

    expect(unreleased.trim()).toBe("");
    expect(read(".github/PULL_REQUEST_TEMPLATE.md")).not.toContain(
      "I added a `CHANGELOG.md` entry under `[Unreleased]`",
    );
  });

  it("requires non-release announcements to expire, target a version, or be evergreen", () => {
    const manifest = JSON.parse(read("catalog/announcements.json")) as {
      feedUrl?: string;
      announcements: Array<{
        id: string;
        expiresAt?: string;
        maxVersion?: string;
        evergreen?: boolean;
      }>;
    };

    expect(manifest.feedUrl).toBeUndefined();
    for (const announcement of manifest.announcements) {
      if (announcement.id.startsWith("release-")) continue;
      expect(
        Boolean(announcement.expiresAt || announcement.maxVersion || announcement.evergreen),
        `${announcement.id} must expire, declare maxVersion, or set evergreen=true`,
      ).toBe(true);
    }
  });

  it("keeps vulnerability reporting delegated to SECURITY.md", () => {
    expect(read("GOVERNANCE.md")).not.toContain("GitHub Private Vulnerability Reporting");

    const bugTemplate = read(".github/ISSUE_TEMPLATE/bug_report.yml");
    expect(bugTemplate).toContain("SECURITY.md");
    expect(bugTemplate).not.toContain("Security tab");
  });

  it("collects runtime versions without stale numeric placeholders", () => {
    const bugTemplate = read(".github/ISSUE_TEMPLATE/bug_report.yml");

    expect(bugTemplate).toContain("`/sf-pi doctor`");
    expect(bugTemplate).toContain("`pi --version`");
    expect(bugTemplate).toContain("`node --version`");
    expect(bugTemplate).not.toMatch(/placeholder:\s+(?:0\.|v20)/);
  });

  it("keeps contributor policy aligned with repository editing rules", () => {
    const contributing = read("CONTRIBUTING.md");
    const topLevelHeadings = contributing.match(/^# [^#].*$/gm) ?? [];

    expect(topLevelHeadings).toHaveLength(1);
    expect(contributing).not.toMatch(/^- \[x\]/m);
    expect(contributing).not.toContain("Module-level & function-level comments");
  });

  it("does not present proposed setting-scope terminology as current", () => {
    expect(read("CONTEXT.md")).not.toContain("**Setting Scope Policy**:");
  });

  it("keeps architecture guidance on the current extension README contract", () => {
    expect(read("ARCHITECTURE.md")).not.toMatch(/behavior matrix/i);
  });

  it("documents the active Guardrail headless path for Data 360", () => {
    const readme = read("extensions/sf-data360/README.md");

    expect(readme).not.toContain("SF_D360_ALLOW_HEADLESS_WRITE");
    expect(readme).toContain("SF_GUARDRAIL_ALLOW_HEADLESS");
  });

  it("grounds npm and operating-system support claims in maintained proof", () => {
    const pkg = JSON.parse(read("package.json")) as {
      engines?: { node?: string };
      peerDependencies?: Record<string, string>;
    };
    const install = read("docs/install.md");

    expect(install).toContain(`Node.js \`${pkg.engines?.node}\``);
    expect(install).toContain(
      `pi coding agent \`${pkg.peerDependencies?.["@earendil-works/pi-coding-agent"]}\``,
    );
    expect(install).toContain("SF Pi declares\n  no separate npm floor");
    expect(install).toContain("Required CI continuously proves Ubuntu with Node 22");
    expect(install).not.toContain("- npm 11");
    expect(install).not.toContain("Native Windows is supported");
  });

  it("lists every configurable extension exactly once in the settings audit", () => {
    const catalog = JSON.parse(read("catalog/index.json")) as Array<{
      id: string;
      configurable: boolean;
    }>;
    const expected = catalog
      .filter((extension) => extension.configurable)
      .map((extension) => extension.id)
      .sort();
    const documented = [...read("docs/settings-surfaces.md").matchAll(/^\| `(sf-[^`]+)`\s+\|/gm)]
      .map((match) => match[1]!)
      .sort();

    expect(documented).toEqual(expected);
    expect(new Set(documented).size).toBe(documented.length);
  });
});
