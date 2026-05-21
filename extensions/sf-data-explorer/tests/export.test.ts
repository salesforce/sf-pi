/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resultToJsonEnvelope, rowsToCsv, saveResult } from "../lib/export.ts";
import type { RunResult } from "../lib/types.ts";

const sampleResult: RunResult = {
  mode: "soql",
  targetOrg: "my-org",
  apiVersion: "66.0",
  query: "SELECT Id, Name FROM Account LIMIT 1",
  totalReturned: 1,
  columns: ["Id", "Name", "Note"],
  rows: [{ Id: "001", Name: "Acme, Inc.", Note: 'He said "hi"\nagain' }],
  raw: {},
};

describe("exports", () => {
  it("escapes CSV cells", () => {
    expect(rowsToCsv(sampleResult.rows, sampleResult.columns)).toBe(
      'Id,Name,Note\n001,"Acme, Inc.","He said ""hi""\nagain"\n',
    );
  });

  it("wraps JSON with metadata", () => {
    const parsed = JSON.parse(resultToJsonEnvelope(sampleResult));
    expect(parsed.mode).toBe("soql");
    expect(parsed.targetOrg).toBe("my-org");
    expect(parsed.rows).toHaveLength(1);
  });

  it("saves under .sf-data-explorer/exports", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sf-data-explorer-test-"));
    const file = await saveResult({
      cwd,
      result: sampleResult,
      baseName: "Account",
      format: "json",
    });
    expect(file).toContain(path.join(".sf-data-explorer", "exports"));
    const text = await fs.readFile(file, "utf8");
    expect(JSON.parse(text).query).toBe(sampleResult.query);
  });
});
