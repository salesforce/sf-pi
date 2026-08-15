/* SPDX-License-Identifier: Apache-2.0 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GENERATOR_PATH = path.join(ROOT, "scripts", "generate-catalog.mjs");
const ADR_LIFECYCLE_PATH = path.join(ROOT, "scripts", "lib", "adr-lifecycle.mjs");
const DOCUMENTATION_INVENTORIES_PATH = path.join(
  ROOT,
  "scripts",
  "lib",
  "documentation-inventories.mjs",
);
const CHECKER_PATH = path.join(ROOT, "scripts", "check-staged-catalog.mjs");
const PRETTIER_ROOT = path.dirname(createRequire(import.meta.url).resolve("prettier/package.json"));

type CommandResult = ReturnType<typeof spawnSync>;

const MAX_EXECUTION_MS = 120_000;
let repository: string;

function writeText(relativePath: string, contents: string): void {
  const absolutePath = path.join(repository, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
}

function writeJson(relativePath: string, value: unknown): void {
  writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function output(result: CommandResult): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function run(command: string, args: string[]): CommandResult {
  return spawnSync(command, args, {
    cwd: repository,
    encoding: "utf8",
    timeout: MAX_EXECUTION_MS,
  });
}

function git(...args: string[]): string {
  const result = run("git", args);
  expect(result.status, output(result)).toBe(0);
  return String(result.stdout).trimEnd();
}

function runGenerator(): CommandResult {
  return spawnSync(process.execPath, [path.join(repository, "scripts/generate-catalog.mjs")], {
    cwd: repository,
    encoding: "utf8",
    timeout: MAX_EXECUTION_MS,
    env: {
      ...process.env,
      NODE_ENV: "test",
      SF_PI_GENERATE_CATALOG_ROOT: repository,
    },
  });
}

function runChecker(): CommandResult {
  return spawnSync(process.execPath, [CHECKER_PATH], {
    cwd: repository,
    encoding: "utf8",
    timeout: MAX_EXECUTION_MS,
  });
}

function snapshotWorkingTree(): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(repository, absolutePath).split(path.sep).join("/");
      if (entry.isDirectory()) {
        snapshot[`${relativePath}/`] = "directory";
        walk(absolutePath);
      } else if (entry.isFile()) {
        snapshot[relativePath] = readFileSync(absolutePath).toString("base64");
      }
    }
  };
  walk(repository);
  return snapshot;
}

function createRepository(): void {
  writeJson("package.json", {
    scripts: {},
    pi: { extensions: ["./extensions/alpha/index.ts"] },
  });
  writeText(".gitignore", "node_modules/\n");
  writeText("extensions/alpha/index.ts", "export default function alpha() {}\n");
  writeJson("extensions/alpha/manifest.json", {
    id: "alpha",
    name: "Alpha",
    description: "A staged catalog fixture.",
    category: "ui",
    defaultEnabled: true,
    docs: {
      intentGroup: "Personalize pi",
      summary: "A staged catalog fixture.",
      primaryFiles: ["index.ts"],
    },
  });
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
  writeText("catalog/.keep", "fixture\n");
  writeText("docs/.vitepress/.keep", "fixture\n");
  writeText(
    "docs/adr/0001-fixture-decision.md",
    [
      "---",
      'id: "0001"',
      "status: accepted",
      "date: 2026-01-01",
      "---",
      "",
      "# Fixture decision",
      "",
      "Fixture rationale.",
      "",
    ].join("\n"),
  );
  mkdirSync(path.join(repository, "scripts/lib"), { recursive: true });
  cpSync(GENERATOR_PATH, path.join(repository, "scripts/generate-catalog.mjs"));
  cpSync(ADR_LIFECYCLE_PATH, path.join(repository, "scripts/lib/adr-lifecycle.mjs"));
  cpSync(
    DOCUMENTATION_INVENTORIES_PATH,
    path.join(repository, "scripts/lib/documentation-inventories.mjs"),
  );
  cpSync(CHECKER_PATH, path.join(repository, "scripts/check-staged-catalog.mjs"));

  mkdirSync(path.join(repository, "node_modules"), { recursive: true });
  symlinkSync(
    PRETTIER_ROOT,
    path.join(repository, "node_modules/prettier"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const generated = runGenerator();
  expect(generated.status, output(generated)).toBe(0);

  git("init", "--quiet");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture User");
  git("add", "--all");
  git("commit", "--quiet", "-m", "baseline");
}

beforeEach(() => {
  repository = mkdtempSync(path.join(tmpdir(), "sf-pi-staged-catalog-"));
  createRepository();
});

afterEach(() => {
  rmSync(repository, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
});

describe("staged catalog check", () => {
  it("passes a coherent staged snapshot without changing Git or working files", () => {
    const indexBefore = git("ls-files", "--stage");
    const statusBefore = git("status", "--porcelain=v1");
    const treeBefore = snapshotWorkingTree();

    const result = runChecker();

    expect(result.status, output(result)).toBe(0);
    expect(git("ls-files", "--stage")).toBe(indexBefore);
    expect(git("status", "--porcelain=v1")).toBe(statusBefore);
    expect(snapshotWorkingTree()).toEqual(treeBefore);
  });

  it("runs the generator implementation stored in the staged snapshot", () => {
    writeText(
      "scripts/generate-catalog.mjs",
      'console.error("STAGED_GENERATOR_SENTINEL"); process.exit(23);\n',
    );
    git("add", "scripts/generate-catalog.mjs");

    const indexBefore = git("ls-files", "--stage");
    const statusBefore = git("status", "--porcelain=v1");
    const treeBefore = snapshotWorkingTree();

    const result = runChecker();

    expect(result.status, output(result)).toBe(1);
    expect(output(result)).toContain("STAGED_GENERATOR_SENTINEL");
    expect(git("ls-files", "--stage")).toBe(indexBefore);
    expect(git("status", "--porcelain=v1")).toBe(statusBefore);
    expect(snapshotWorkingTree()).toEqual(treeBefore);
  });

  it("rejects staged input with generated repairs only unstaged and changes nothing", () => {
    const manifestPath = path.join(repository, "extensions/alpha/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    writeJson("extensions/alpha/manifest.json", {
      ...manifest,
      description: "A changed staged catalog fixture.",
    });
    const generated = runGenerator();
    expect(generated.status, output(generated)).toBe(0);
    git("add", "extensions/alpha/manifest.json");

    const statusBefore = git("status", "--porcelain=v1");
    expect(statusBefore).toContain("M  extensions/alpha/manifest.json");
    expect(statusBefore).toMatch(/ M (?:catalog|docs|README)/);
    const indexBefore = git("ls-files", "--stage");
    const treeBefore = snapshotWorkingTree();

    const result = runChecker();

    expect(result.status, output(result)).toBe(1);
    expect(output(result)).toContain("is out of date");
    expect(git("ls-files", "--stage")).toBe(indexBefore);
    expect(git("status", "--porcelain=v1")).toBe(statusBefore);
    expect(snapshotWorkingTree()).toEqual(treeBefore);
    expect(existsSync(path.join(repository, "docs/extensions/alpha.md"))).toBe(true);
  });
});
