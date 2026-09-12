/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPiWebAccessDoctor } from "../lib/pi-web-access-doctor.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-web-access-doctor-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("runPiWebAccessDoctor", () => {
  it("skips DNS and config inspection when pi-web-access is not installed", async () => {
    const lookup = vi.fn();

    const report = await runPiWebAccessDoctor({
      cwd: "/tmp/project",
      packageSources: ["npm:some-other-package"],
      configPath: path.join(makeTempDir(), "web-search.json"),
      lookup,
    });

    expect(report).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("reports a healthy public DNS result", async () => {
    const report = await runPiWebAccessDoctor({
      cwd: "/tmp/project",
      packageSources: ["npm:pi-web-access@0.29.0"],
      configPath: path.join(makeTempDir(), "web-search.json"),
      lookup: async () => [{ address: "140.82.112.3", family: 4 }],
    });

    expect(report?.checks).toContainEqual(
      expect.objectContaining({
        id: "pi-web-access.synthetic-dns",
        severity: "ok",
      }),
    );
  });

  it("warns with a narrow opt-in when a public hostname resolves into CGNAT space", async () => {
    const configPath = path.join(makeTempDir(), "web-search.json");
    const report = await runPiWebAccessDoctor({
      cwd: "/tmp/project",
      packageSources: ["npm:pi-web-access"],
      configPath,
      lookup: async () => [{ address: "100.64.1.24", family: 4 }],
    });

    const check = report?.checks.find((item) => item.id === "pi-web-access.synthetic-dns");
    expect(check).toMatchObject({ severity: "warn" });
    expect(check?.detail).toContain("100.64.1.24");
    expect(check?.detail).toContain("VPN or TUN");
    expect(check?.fix).toContain(configPath);
    expect(check?.fix).toContain('"100.64.1.0/24"');
    expect(check?.fix).toContain("Do not allow 100.64.0.0/10 wholesale");
  });

  it("respects an existing allowRanges entry that contains the synthetic address", async () => {
    const configPath = path.join(makeTempDir(), "web-search.json");
    writeFileSync(
      configPath,
      `${JSON.stringify({ ssrf: { allowRanges: ["100.64.1.0/24"] } }, null, 2)}\n`,
      "utf8",
    );

    const report = await runPiWebAccessDoctor({
      cwd: "/tmp/project",
      packageSources: ["npm:pi-web-access"],
      configPath,
      lookup: async () => [{ address: "100.64.1.24", family: 4 }],
    });

    expect(report?.checks).toContainEqual(
      expect.objectContaining({
        id: "pi-web-access.synthetic-dns",
        severity: "ok",
        detail: expect.stringContaining("already covered"),
      }),
    );
  });

  it("surfaces malformed third-party configuration without rewriting it", async () => {
    const configPath = path.join(makeTempDir(), "web-search.json");
    const original = "{ invalid\n";
    writeFileSync(configPath, original, "utf8");

    const report = await runPiWebAccessDoctor({
      cwd: "/tmp/project",
      packageSources: ["npm:pi-web-access"],
      configPath,
      lookup: async () => [{ address: "140.82.112.3", family: 4 }],
    });

    expect(report?.checks).toContainEqual(
      expect.objectContaining({
        id: "pi-web-access.config",
        severity: "warn",
        fix: expect.stringContaining(configPath),
      }),
    );
    expect(readFileSync(configPath, "utf8")).toBe(original);
  });

  it("bounds DNS inspection and reports an informational result on timeout", async () => {
    const report = await runPiWebAccessDoctor({
      cwd: "/tmp/project",
      packageSources: ["npm:pi-web-access"],
      configPath: path.join(makeTempDir(), "web-search.json"),
      lookup: () => new Promise(() => undefined),
      timeoutMs: 5,
    });

    expect(report?.checks).toContainEqual(
      expect.objectContaining({
        id: "pi-web-access.synthetic-dns",
        severity: "info",
        detail: expect.stringContaining("timed out"),
      }),
    );
  });
});
