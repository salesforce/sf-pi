/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const extensionRoot = path.resolve(import.meta.dirname, "..");
const guidePath = path.join(extensionRoot, "AGENT_GUIDE.md");
const children = {
  authoring: path.join(extensionRoot, "docs/authoring.md"),
  preview: path.join(extensionRoot, "docs/preview.md"),
  eval: path.join(extensionRoot, "docs/eval.md"),
  lifecycle: path.join(extensionRoot, "docs/lifecycle.md"),
} as const;

describe("Agent Script operating guide index", () => {
  it("keeps AGENT_GUIDE.md as a Pi-style index", () => {
    const guide = readFileSync(guidePath, "utf8");
    expect(guide.split("\n").length).toBeLessThanOrEqual(80);
    expect(guide).toContain("docs/authoring.md");
    expect(guide).toContain("docs/preview.md");
    expect(guide).toContain("docs/eval.md");
    expect(guide).toContain("docs/lifecycle.md");
    expect(guide).not.toMatch(/^## Authoring contract/m);
    expect(guide).not.toMatch(/^## Compile/m);
    expect(guide).not.toMatch(/^## Preview/m);
    expect(guide).not.toMatch(/^## Eval/m);
    expect(guide).not.toMatch(/^## Lifecycle/m);
  });

  it("moves each mode encyclopedia to exactly one child", () => {
    for (const file of Object.values(children)) {
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8"), file).toMatch(/^# /);
    }

    const authoring = readFileSync(children.authoring, "utf8");
    const preview = readFileSync(children.preview, "utf8");
    const evalGuide = readFileSync(children.eval, "utf8");
    const lifecycle = readFileSync(children.lifecycle, "utf8");

    expect(authoring).toContain("## Authoring contract");
    expect(authoring).toContain("## Compile");
    expect(authoring).toContain("inspect/quality");
    expect(preview).toContain('action="start"');
    expect(preview).toContain("RelatedAgentStep");
    expect(evalGuide).toContain("run_release");
    expect(evalGuide).toContain("seed_profiles");
    expect(lifecycle).toContain("acknowledge_untested_activation");
    expect(lifecycle).toContain("agent-user-setup.md");

    expect(authoring).not.toContain("run_release");
    expect(preview).not.toContain("## Compile");
    expect(evalGuide).not.toContain("## Authoring contract");
    expect(lifecycle).not.toContain("seed_profiles");
  });
});
