/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SOQL Artifact Export path confinement. */
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { exportQueryResult, resolveExportTarget } from "../lib/export.ts";
import type { SfSoqlSessionState } from "../lib/types.ts";

describe("resolveExportTarget", () => {
  it("confines relative output paths to the workspace SOQL export directory", () => {
    const target = resolveExportTarget("/workspace", "reports/accounts.csv");
    expect(target).toBe(
      path.join("/workspace", ".sf-pi", "exports", "soql", "reports", "accounts.csv"),
    );
  });

  it("rejects absolute and parent-traversal output paths", () => {
    expect(() => resolveExportTarget("/workspace", "/tmp/accounts.csv")).toThrow(/relative/);
    expect(() => resolveExportTarget("/workspace", "../accounts.csv")).toThrow(/path segments/);
    expect(() => resolveExportTarget("/workspace", "reports/../accounts.csv")).toThrow(
      /path segments/,
    );
    expect(() => resolveExportTarget("/workspace", "reports//accounts.csv")).toThrow(
      /path segments/,
    );
  });

  it("sanitizes path segments that stay inside the export directory", () => {
    const target = resolveExportTarget("/workspace", "reports/account list.csv");
    expect(target).toBe(
      path.join("/workspace", ".sf-pi", "exports", "soql", "reports", "account_list.csv"),
    );
  });
});

describe("exportQueryResult", () => {
  it("rejects symlink targets and symlink parent directories", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "sf-soql-export-symlink-test-"));
    const source = path.join(cwd, "source.csv");
    await writeFile(source, "Id,Name\n001,Acme\n", "utf8");
    const state: SfSoqlSessionState = {
      lastDigest: {
        artifacts: [{ path: source, kind: "flattened-csv" }],
      } as NonNullable<SfSoqlSessionState["lastDigest"]>,
    };

    try {
      const exportRoot = path.join(cwd, ".sf-pi", "exports", "soql");
      await mkdir(path.join(exportRoot, "reports"), { recursive: true });
      const outsideTarget = path.join(cwd, "outside.csv");
      await writeFile(outsideTarget, "outside", "utf8");
      await symlink(outsideTarget, path.join(exportRoot, "reports", "accounts.csv"));

      await expect(
        exportQueryResult(
          { action: "query.export", output_file: "reports/accounts.csv", format: "csv" },
          state,
          cwd,
        ),
      ).rejects.toThrow(/symlink/);
      await expect(readFile(outsideTarget, "utf8")).resolves.toBe("outside");

      await rm(path.join(exportRoot, "reports"), { recursive: true, force: true });
      const outsideDir = path.join(cwd, "outside-dir");
      await mkdir(outsideDir);
      await symlink(outsideDir, path.join(exportRoot, "reports"), "dir");

      await expect(
        exportQueryResult(
          { action: "query.export", output_file: "reports/accounts.csv", format: "csv" },
          state,
          cwd,
        ),
      ).rejects.toThrow(/symlinks/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("copies the selected artifact only into the confined export directory", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "sf-soql-export-test-"));
    const source = path.join(cwd, "source.csv");
    await writeFile(source, "Id,Name\n001,Acme\n", "utf8");
    const state: SfSoqlSessionState = {
      lastDigest: {
        artifacts: [{ path: source, kind: "flattened-csv" }],
      } as NonNullable<SfSoqlSessionState["lastDigest"]>,
    };

    try {
      const result = await exportQueryResult(
        { action: "query.export", output_file: "reports/accounts.csv", format: "csv" },
        state,
        cwd,
      );
      const target = path.join(cwd, ".sf-pi", "exports", "soql", "reports", "accounts.csv");
      await expect(readFile(target, "utf8")).resolves.toBe("Id,Name\n001,Acme\n");
      expect(result.details.digest).toMatchObject({ action: "query.export", status: "pass" });
      expect(JSON.stringify(result.details)).toContain(".sf-pi/exports/soql/reports/accounts.csv");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
