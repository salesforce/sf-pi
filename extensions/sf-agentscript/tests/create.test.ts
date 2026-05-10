/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for create.ts — scaffold a new .agent bundle.
 *
 * Real SDK runs the local-validate pass; if the template ever generates
 * something that doesn't compile, this suite catches it immediately.
 */

import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createBundle } from "../lib/create.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-create-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("createBundle", () => {
  test("default agentforce-default template produces a bundle that compiles clean", async () => {
    const result = await createBundle({
      cwd: workDir,
      bundle_name: "Billing_Bot",
    });
    if (result.ok === false) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    expect(existsSync(result.agent_path)).toBe(true);
    expect(existsSync(result.meta_path)).toBe(true);
    expect(result.next_steps.length).toBeGreaterThan(0);
    const source = await readFile(result.agent_path, "utf8");
    expect(source).toContain("Billing_Bot");
    expect(source).toContain("system:");
    expect(source).toContain("topic ");
  });

  test("minimal template also compiles clean", async () => {
    const result = await createBundle({
      cwd: workDir,
      bundle_name: "Tiny_Bot",
      template: "minimal",
    });
    if (result.ok === false) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    const source = await readFile(result.agent_path, "utf8");
    expect(source).toContain("Tiny_Bot");
  });

  test("seeds topics and variables from the job spec", async () => {
    const result = await createBundle({
      cwd: workDir,
      bundle_name: "Seeded_Bot",
      job_spec: {
        description: "Custom seed.",
        topics: [{ name: "billing", description: "Handle billing" }],
        variables: [{ name: "is_verified", type: "boolean", mutable: true, default: false }],
      },
    });
    if (result.ok === false) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    const source = await readFile(result.agent_path, "utf8");
    expect(source).toContain("Custom seed.");
    expect(source).toContain("topic billing:");
    expect(source).toContain("is_verified");
  });

  test("refuses to overwrite by default and returns reason='exists'", async () => {
    const first = await createBundle({ cwd: workDir, bundle_name: "B" });
    if (first.ok === false) {
      throw new Error(`Expected success, got ${first.reason}: ${first.reason_detail}`);
    }
    const second = await createBundle({ cwd: workDir, bundle_name: "B" });
    expect(second.ok).toBe(false);
    if (second.ok === false) {
      expect(second.reason).toBe("exists");
    }
  });

  test("overwrite=true clobbers the existing bundle", async () => {
    const first = await createBundle({ cwd: workDir, bundle_name: "B" });
    if (first.ok === false) throw new Error(`first: ${first.reason}`);
    // Mutate the file so we can verify it gets replaced.
    await writeFile(first.agent_path, "garbage", "utf8");
    const second = await createBundle({
      cwd: workDir,
      bundle_name: "B",
      overwrite: true,
    });
    expect(second.ok).toBe(true);
    if (second.ok === true) {
      const source = await readFile(second.agent_path, "utf8");
      expect(source).not.toBe("garbage");
    }
  });
});
