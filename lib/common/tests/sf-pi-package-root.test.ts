/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSfPiPackageRoot, resolveSfPiPackageRootPath } from "../sf-pi-package-root.ts";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSettings(filePath: string, settings: Record<string, unknown>): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

afterEach(() => {
  process.env = { ...originalEnv };
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("resolveSfPiPackageRoot", () => {
  it("uses Pi's package manager for configured local package sources", () => {
    const agentDir = makeTempDir("sf-pi-package-root-agent-");
    const cwd = makeTempDir("sf-pi-package-root-project-");
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeSettings(path.join(cwd, ".pi", "settings.json"), {
      packages: [process.cwd()],
    });

    expect(resolveSfPiPackageRoot({ cwd })).toMatchObject({
      packageRoot: process.cwd(),
      source: "pi-package-manager",
    });
  });

  it("falls back to a bounded module walk for development runs without settings", () => {
    process.env.PI_CODING_AGENT_DIR = makeTempDir("sf-pi-package-root-agent-");
    const cwd = makeTempDir("sf-pi-package-root-project-");

    const result = resolveSfPiPackageRoot({ cwd, from: import.meta.url });

    expect(result).toMatchObject({ packageRoot: process.cwd(), source: "module-walk" });
    expect(resolveSfPiPackageRootPath({ cwd, from: import.meta.url })).toBe(process.cwd());
  });
});
