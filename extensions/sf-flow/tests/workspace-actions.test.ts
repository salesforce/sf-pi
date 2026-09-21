/* SPDX-License-Identifier: Apache-2.0 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diagnoseFile, flowInspect } from "../lib/operations.ts";
import { applyFlowQuickFix } from "../lib/quick-fixes.ts";
import { validateFlowCheck, type FlowValidationAdapter } from "../lib/validation.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "sf-flow-workspace-"));
  roots.push(root);
  const relativeFile = path.join(
    "force-app",
    "main",
    "default",
    "flows",
    "Workspace_Example.flow-meta.xml",
  );
  const file = path.join(root, relativeFile);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    path.join(root, "sfdx-project.json"),
    JSON.stringify({ packageDirectories: [{ path: "force-app" }], sourceApiVersion: "67.0" }),
  );
  await writeFile(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>67.0</apiVersion>
  <assignments>
    <name>Set_Result</name><label>Set Result</label><locationX>176</locationX><locationY>158</locationY>
    <assignmentItems><assignToReference>resultText</assignToReference><operator>Assign</operator><value><stringValue>Ready</stringValue></value></assignmentItems>
  </assignments>
  <description>Explicit workspace lifecycle fixture.</description>
  <label>Workspace Example</label>
  <processType>AutoLaunchedFlow</processType>
  <start><connector><targetReference>Set_Result</targetReference></connector></start>
  <status>Draft</status>
  <variables><name>resultText</name><dataType>String</dataType><isCollection>false</isCollection><isInput>false</isInput><isOutput>true</isOutput></variables>
</Flow>`,
  );
  return { root, relativeFile, file };
}

describe("SF Flow explicit workspace file actions", () => {
  it("inspects and diagnoses files relative to params.workspace", async () => {
    const { root, relativeFile } = await fixture();
    const params = { workspace: root, file: relativeFile };

    const inspection = await flowInspect({ action: "flow.inspect", ...params }, process.cwd());
    const diagnosis = await diagnoseFile(
      { action: "diagnose.file", quality_profile: "review", ...params },
      process.cwd(),
    );

    expect(inspection.details).toMatchObject({ ok: true, file: relativeFile });
    expect(diagnosis.details).toMatchObject({ ok: true, file: relativeFile });
  });

  it("exposes asynchronous paths through flow.inspect model and topology", async () => {
    const { root, relativeFile, file } = await fixture();
    const source = await readFile(file, "utf8");
    await writeFile(
      file,
      source.replace(
        "<start><connector><targetReference>Set_Result</targetReference></connector></start>",
        "<start><connector><targetReference>Set_Result</targetReference></connector><doesRequireRecordChangedToMeetCriteria>true</doesRequireRecordChangedToMeetCriteria><filterLogic>and</filterLogic><filters><field>Name</field><operator>IsNull</operator><value><booleanValue>false</booleanValue></value></filters><object>Account</object><recordTriggerType>Update</recordTriggerType><scheduledPaths><name>After_Commit</name><connector><targetReference>Set_Result</targetReference></connector><pathType>AsyncAfterCommit</pathType></scheduledPaths><triggerType>RecordAfterSave</triggerType></start>",
      ),
    );

    const inspection = await flowInspect(
      { action: "flow.inspect", workspace: root, file: relativeFile },
      process.cwd(),
    );
    const model = inspection.details.model as {
      elements: Array<{ name: string; kind: string }>;
    };
    const digest = inspection.details.digest as { topology?: { mermaid: string } };

    expect(model.elements).toContainEqual(
      expect.objectContaining({ name: "After_Commit", kind: "scheduledPaths" }),
    );
    expect(digest.topology?.mermaid).toContain("ASYNC · After Commit · after commit");
  });

  it("check-only validates a file relative to params.workspace", async () => {
    const { root, relativeFile } = await fixture();
    const run = vi.fn<FlowValidationAdapter["run"]>().mockResolvedValue({
      id: "0Af000000000001",
      success: true,
      status: "Succeeded",
      component_failures: [],
      raw: { success: true },
    });

    const result = await validateFlowCheck(
      {
        action: "validate.check",
        workspace: root,
        file: relativeFile,
        target_org: "developer-org",
      },
      process.cwd(),
      {} as never,
      {
        adapter: { run },
        writeArtifact: async (kind, filename) => ({ path: `/tmp/${filename}`, kind }),
      },
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ file: expect.stringContaining(relativeFile) }),
    );
    expect(result.details.ok).toBe(true);
  });

  it("applies a source-bound quick fix relative to params.workspace", async () => {
    const { root, relativeFile, file } = await fixture();
    const diagnosis = await diagnoseFile(
      {
        action: "diagnose.file",
        workspace: root,
        file: relativeFile,
        quality_profile: "review",
      },
      process.cwd(),
    );
    const fix = (
      diagnosis.details.quick_fixes as Array<{
        id: string;
        source_version: string;
        rule_id: string;
      }>
    ).find((candidate) => candidate.rule_id === "missing-auto-layout");
    expect(fix).toBeDefined();
    if (!fix) throw new Error("Expected missing-auto-layout quick fix");

    const result = await applyFlowQuickFix(
      {
        action: "fix.apply",
        workspace: root,
        file: relativeFile,
        fix_id: fix.id,
        source_version: fix.source_version,
        quality_profile: "review",
      },
      process.cwd(),
    );

    expect(result.details.ok).toBe(true);
    expect(await readFile(file, "utf8")).toContain("AUTO_LAYOUT_CANVAS");
  });
});
