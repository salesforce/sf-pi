/* SPDX-License-Identifier: Apache-2.0 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeFlowSource } from "../lib/analyzer.ts";
import { applyFlowQuickFix, listFlowQuickFixes, sourceVersion } from "../lib/quick-fixes.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "sf-flow-fix-"));
  roots.push(root);
  await mkdir(path.join(root, "force-app", "main", "default", "flows"), { recursive: true });
  await writeFile(
    path.join(root, "sfdx-project.json"),
    JSON.stringify({ packageDirectories: [{ path: "force-app" }], sourceApiVersion: "68.0" }),
  );
  const file = path.join(
    root,
    "force-app",
    "main",
    "default",
    "flows",
    "Fix_Example.flow-meta.xml",
  );
  await writeFile(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>49.0</apiVersion>
  <assignments>
    <name>Set_Result</name><label>Set Result</label><locationX>176</locationX><locationY>158</locationY>
    <assignmentItems><assignToReference>resultValue</assignToReference><operator>Assign</operator><value><stringValue>Ready</stringValue></value></assignmentItems>
  </assignments>
  <description>Fresh quick-fix fixture.</description>
  <label>Fix Example</label>
  <processType>AutoLaunchedFlow</processType>
  <start><connector><targetReference>Set_Result</targetReference></connector></start>
  <status>Draft</status>
  <variables>
    <name>resultValue</name><dataType>String</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>true</isOutput>
  </variables>
  <variables>
    <name>unusedValue</name><dataType>String</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>false</isOutput>
  </variables>
</Flow>`,
  );
  return { root, file };
}

describe("SF Flow safe quick fixes", () => {
  it("offers only API version, Auto-Layout, and unused-variable fixes", async () => {
    const { root, file } = await fixture();
    const source = await readFile(file, "utf8");
    const analysis = analyzeFlowSource(source, path.relative(root, file), { profile: "review" });
    const fixes = await listFlowQuickFixes(source, analysis, root);

    expect(fixes.map((fix) => fix.rule_id).sort()).toEqual([
      "invalid-api-version",
      "missing-auto-layout",
      "unused-variable",
    ]);
    expect(new Set(fixes.map((fix) => fix.source_version))).toEqual(
      new Set([sourceVersion(source)]),
    );
  });

  it("applies each safe fix and re-diagnoses the new source", async () => {
    const { root, file } = await fixture();

    for (const ruleId of ["invalid-api-version", "missing-auto-layout", "unused-variable"]) {
      const source = await readFile(file, "utf8");
      const analysis = analyzeFlowSource(source, path.relative(root, file), { profile: "review" });
      const fix = (await listFlowQuickFixes(source, analysis, root)).find(
        (candidate) => candidate.rule_id === ruleId,
      );
      expect(fix, ruleId).toBeDefined();
      if (!fix) throw new Error(`Missing quick fix for ${ruleId}`);

      const result = await applyFlowQuickFix(
        {
          action: "fix.apply",
          file: path.relative(root, file),
          fix_id: fix.id,
          source_version: fix.source_version,
          quality_profile: "review",
        },
        root,
      );
      expect(result.details.ok, ruleId).toBe(true);
    }

    const updated = await readFile(file, "utf8");
    expect(updated).toContain("<apiVersion>68.0</apiVersion>");
    expect(updated).toContain("<stringValue>AUTO_LAYOUT_CANVAS</stringValue>");
    expect(updated).not.toContain("<name>unusedValue</name>");
  });

  it("refuses a stale source-bound fix", async () => {
    const { root, file } = await fixture();
    const source = await readFile(file, "utf8");
    const analysis = analyzeFlowSource(source, path.relative(root, file), { profile: "review" });
    const fix = (await listFlowQuickFixes(source, analysis, root))[0];
    if (!fix) throw new Error("Expected at least one quick fix");
    await writeFile(file, `${source}\n<!-- changed -->\n`);

    await expect(
      applyFlowQuickFix(
        {
          action: "fix.apply",
          file: path.relative(root, file),
          fix_id: fix.id,
          source_version: fix.source_version,
        },
        root,
      ),
    ).rejects.toThrow(/stale/i);
  });
});
