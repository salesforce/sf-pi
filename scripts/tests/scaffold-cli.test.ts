/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCAFFOLD_PATH = path.join(ROOT, "scripts", "scaffold.mjs");
let fixtureRoot: string;

function writeText(relativePath: string, contents: string): void {
  const filePath = path.join(fixtureRoot, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function writeJson(relativePath: string, value: unknown): void {
  writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture(): void {
  writeJson("package.json", { scripts: {}, pi: { extensions: [] } });
  writeText("README.md", "# Fixture\n");
  writeText(
    "CONTRIBUTING.md",
    "# Contributing\n\n<!-- GENERATED:contributor-scripts:start -->\nstale\n<!-- GENERATED:contributor-scripts:end -->\n",
  );
  writeText(
    "lib/common/README.md",
    "# Common\n\n<!-- GENERATED:common-modules:start -->\nstale\n<!-- GENERATED:common-modules:end -->\n",
  );
  writeText(
    "scripts/e2e/README.md",
    "# E2E\n\n<!-- GENERATED:e2e-harnesses:start -->\nstale\n<!-- GENERATED:e2e-harnesses:end -->\n",
  );
  writeJson("scripts/e2e/harnesses.json", { schemaVersion: 1, harnesses: [] });
  writeText(
    "ARCHITECTURE.md",
    "# Architecture\n\n<!-- GENERATED:folder-layout:start -->\nstale\n<!-- GENERATED:folder-layout:end -->\n",
  );
  writeText(
    "docs/troubleshooting.md",
    "# Troubleshooting\n\n<!-- GENERATED:extension-troubleshooting-index:start -->\nstale\n<!-- GENERATED:extension-troubleshooting-index:end -->\n",
  );
  writeText(
    "docs/adr/0001-fixture.md",
    '---\nid: "0001"\nstatus: accepted\ndate: 2026-01-01\n---\n\n# Fixture decision\n\nRationale.\n',
  );
  writeText("catalog/.keep", "fixture\n");
  writeText("docs/.vitepress/.keep", "fixture\n");
}

function runScaffold(args: string[]) {
  return spawnSync(process.execPath, [SCAFFOLD_PATH, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      NODE_ENV: "test",
      SF_PI_SCAFFOLD_ROOT: fixtureRoot,
    },
  });
}

function snapshot(): Record<string, string> {
  const files: Record<string, string> = {};
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else files[path.relative(fixtureRoot, absolute)] = readFileSync(absolute, "utf8");
    }
  }
  walk(fixtureRoot);
  return files;
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "sf-pi-scaffold-"));
  createFixture();
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe("extension scaffold CLI", () => {
  it("creates a generator-valid Manager-first extension and package entry", () => {
    const result = runScaffold([
      "--id",
      "sf-example",
      "--category",
      "agent-tool",
      "--intent",
      "Build apps",
      "--name",
      "SF Example",
    ]);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const extensionRoot = path.join(fixtureRoot, "extensions", "sf-example");
    const source = readFileSync(path.join(extensionRoot, "index.ts"), "utf8");
    const manifest = JSON.parse(readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));
    const pkg = JSON.parse(readFileSync(path.join(fixtureRoot, "package.json"), "utf8"));

    expect(source).toContain("openExtensionInManager");
    expect(source).toContain('view: "detail"');
    expect(source).not.toContain("openCommandPanel");
    expect(manifest.docs.intentGroup).toBe("Build apps");
    expect(pkg.pi.extensions).toContain("./extensions/sf-example/index.ts");
    const readme = readFileSync(path.join(extensionRoot, "README.md"), "utf8");
    expect(readme).toContain("## Commands");
    expect(readme).not.toContain("## Runtime Flow");
    expect(readme).not.toContain("## Settings and Safety");
    expect(readFileSync(path.join(fixtureRoot, "catalog/index.json"), "utf8")).toContain(
      '"id": "sf-example"',
    );
  });

  it("rejects an unknown intent before changing the fixture", () => {
    const before = snapshot();
    const result = runScaffold(["--id", "sf-example", "--category", "ui", "--intent", "Unknown"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid intent");
    expect(snapshot()).toEqual(before);
  });
});
