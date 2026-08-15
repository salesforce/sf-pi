/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverRunnableE2EEntries,
  loadDocumentationInventories,
  renderCommonModuleInventory,
  renderContributorScriptInventory,
  renderE2EHarnessInventory,
} from "../lib/documentation-inventories.mjs";

let root: string;

function write(relativePath: string, contents: string): void {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, "utf8");
}

function writeJson(relativePath: string, value: unknown): void {
  write(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "sf-pi-doc-inventory-"));
  write("scripts/e2e/local.ts", "export {};\n");
  write("scripts/e2e/model/run.ts", "export {};\n");
  write("lib/common/alpha.ts", "export {};\n");
  write("lib/common/cache/index.ts", "export {};\n");
  write("lib/common/cache/tests/cache.test.ts", "export {};\n");
  writeJson("package.json", {
    scripts: {
      "generate-catalog": "node scripts/generate-catalog.mjs",
      "e2e:local": "node scripts/e2e/local.ts",
      "e2e:model": "node scripts/e2e/model/run.ts",
    },
  });
  writeJson("scripts/e2e/harnesses.json", {
    schemaVersion: 1,
    harnesses: [
      {
        script: "e2e:local",
        entry: "scripts/e2e/local.ts",
        title: "Local proof",
        summary: "Exercises a local fixture.",
        target: "Generated local workspace",
        posture: "read-only",
        artifacts: "Temporary files",
      },
      {
        script: "e2e:model",
        entry: "scripts/e2e/model/run.ts",
        title: "Model proof",
        summary: "Exercises model routing.",
        target: "Explicit model",
        posture: "model-only",
        artifacts: "JSON and Markdown report",
        arguments: "--model <model>",
      },
    ],
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("documentation structural inventories", () => {
  it("renders complete package, E2E, and shared-module inventories", () => {
    const inventory = loadDocumentationInventories(root);

    expect(discoverRunnableE2EEntries(root)).toEqual([
      "scripts/e2e/local.ts",
      "scripts/e2e/model/run.ts",
    ]);
    expect(renderContributorScriptInventory(inventory.scripts)).toContain(
      "`npm run generate-catalog`",
    );
    expect(renderE2EHarnessInventory(inventory.harnesses)).toContain(
      "`npm run e2e:model -- --model <model>`",
    );
    const common = renderCommonModuleInventory(root);
    expect(common).toContain("| `alpha.ts` | module | 1 | 0 |");
    expect(common).toContain("| `cache/` | directory | 1 | 1 |");
  });

  it("fails when a runnable E2E entry is not declared", () => {
    write("scripts/e2e/undeclared.ts", "export {};\n");
    expect(() => loadDocumentationInventories(root)).toThrow(
      /runnable scripts\/e2e entries must equal scripts\/e2e\/harnesses\.json entries/,
    );
  });

  it("fails when an E2E npm script has no safety record", () => {
    const pkg = {
      scripts: {
        "generate-catalog": "node scripts/generate-catalog.mjs",
        "e2e:local": "node scripts/e2e/local.ts",
        "e2e:model": "node scripts/e2e/model/run.ts",
        "e2e:missing": "node scripts/e2e/missing.ts",
      },
    };
    write("scripts/e2e/missing.ts", "export {};\n");
    writeJson("package.json", pkg);
    expect(() => loadDocumentationInventories(root)).toThrow(
      /package\.json e2e:\* scripts must equal scripts\/e2e\/harnesses\.json scripts/,
    );
  });
});
