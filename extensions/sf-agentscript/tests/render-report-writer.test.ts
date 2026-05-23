/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the report-writer module.
 *
 * Uses a temp directory under os.tmpdir() to avoid touching the real
 * `.sfdx/agents` tree under the project. The writer is responsible for
 * creating parent directories and writing atomically; we assert both.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  agentReportPath,
  evalReportPath,
  previewReportPath,
  reportHeader,
  writeMarkdownReport,
} from "../lib/render/report-writer.ts";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "sf-agentscript-report-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("writeMarkdownReport", () => {
  it("writes the file and returns its path + byte count", async () => {
    const target = path.join(tmp, "deep", "nested", "report.md");
    const written = await writeMarkdownReport(target, "# Hello\n\nworld");
    expect(written.path).toBe(target);
    expect(written.bytes).toBeGreaterThan(0);
    const body = await readFile(target, "utf-8");
    expect(body).toBe("# Hello\n\nworld");
  });

  it("creates parent directories if missing", async () => {
    const target = path.join(tmp, "a", "b", "c", "out.md");
    await writeMarkdownReport(target, "x");
    const dir = await stat(path.dirname(target));
    expect(dir.isDirectory()).toBe(true);
  });

  it("overwrites existing files atomically", async () => {
    const target = path.join(tmp, "out.md");
    await writeMarkdownReport(target, "v1");
    await writeMarkdownReport(target, "v2");
    expect(await readFile(target, "utf-8")).toBe("v2");
  });

  it("does not leave a .tmp sibling on success", async () => {
    const target = path.join(tmp, "out.md");
    await writeMarkdownReport(target, "ok");
    let tmpExists = false;
    try {
      await stat(`${target}.tmp`);
      tmpExists = true;
    } catch {
      /* expected: no temp left */
    }
    expect(tmpExists).toBe(false);
  });
});

describe("path helpers", () => {
  it("evalReportPath joins runDir + report.md", () => {
    expect(evalReportPath("/runs/r1")).toBe(path.join("/runs/r1", "report.md"));
  });

  it("previewReportPath joins sessionDir + reports/<plan>.md", () => {
    expect(previewReportPath("/sess/abc", "plan-99")).toBe(
      path.join("/sess/abc", "reports", "plan-99.md"),
    );
  });

  it("agentReportPath sanitizes the agent name + appends .md", () => {
    const out = agentReportPath("/cwd", "Some Agent / weird", "summary");
    expect(out.endsWith(".md")).toBe(true);
    expect(out).toMatch(/Some_Agent.*weird/);
    expect(out).toMatch(/\.sfdx\/agents/);
  });

  it("agentReportPath preserves an explicit .md suffix", () => {
    const out = agentReportPath("/cwd", "Bot", "summary.md");
    expect(out).toMatch(/summary\.md$/);
    expect(out).not.toMatch(/summary\.md\.md$/);
  });
});

describe("reportHeader", () => {
  it("includes title, kind, and a generated timestamp", () => {
    const md = reportHeader({ kind: "eval", title: "Eval run abc" });
    expect(md).toMatch(/^# Eval run abc/m);
    expect(md).toMatch(/_Generated: \d{4}-\d{2}-\d{2}T/);
    expect(md).toMatch(/_Kind: eval_/);
    expect(md).toMatch(/^---$/m);
  });

  it("includes meta key/value pairs and skips empty values", () => {
    const md = reportHeader({
      kind: "eval",
      title: "x",
      meta: { run_id: "abc", org: "Example", empty: "", undef: undefined },
    });
    expect(md).toMatch(/_run_id: abc_/);
    expect(md).toMatch(/_org: Example_/);
    expect(md).not.toMatch(/_empty:/);
    expect(md).not.toMatch(/_undef:/);
  });
});
