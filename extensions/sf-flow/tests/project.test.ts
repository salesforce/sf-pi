/* SPDX-License-Identifier: Apache-2.0 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectScan } from "../lib/project.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SF Flow project scan", () => {
  it("scans only package directories declared by sfdx-project.json", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sf-flow-project-"));
    roots.push(root);
    await mkdir(path.join(root, "force-app", "main", "default", "flows"), { recursive: true });
    await mkdir(path.join(root, "outside"), { recursive: true });
    await writeFile(
      path.join(root, "sfdx-project.json"),
      JSON.stringify({ packageDirectories: [{ path: "force-app" }], sourceApiVersion: "68.0" }),
    );
    await writeFile(
      path.join(root, "force-app", "main", "default", "flows", "Included.flow-meta.xml"),
      "<Flow/>",
    );
    await writeFile(path.join(root, "outside", "Excluded.flow-meta.xml"), "<Flow/>");

    const result = await projectScan({ action: "project.scan" }, root, {
      writeArtifact: async (kind, filename) => ({ kind, path: `/tmp/${filename}` }),
    });

    expect(result.details.flows).toEqual([
      path.join("force-app", "main", "default", "flows", "Included.flow-meta.xml"),
    ]);
    expect(result.details.total).toBe(1);
  });
});
