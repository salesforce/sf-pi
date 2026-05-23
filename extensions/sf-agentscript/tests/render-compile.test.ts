/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { compileResultMarkdown } from "../lib/render/compile.ts";

describe("compileResultMarkdown", () => {
  it("emits a clean confirmation when no diagnostics", () => {
    const md = compileResultMarkdown({
      ok: true,
      action: "check",
      path: "/x.agent",
      clean: true,
      diagnostic_count: 0,
      dialect: { name: "agentforce-default" },
      compiled_via: "local",
    });
    expect(md).toMatch(/✓/);
    expect(md).toMatch(/x\.agent/);
    expect(md).toMatch(/compiles clean/);
    expect(md).toMatch(/agentforce-default/);
  });

  it("renders a diagnostics table with severity badges", () => {
    const md = compileResultMarkdown({
      ok: true,
      action: "check",
      path: "/topics/x.agent",
      clean: false,
      diagnostic_count: 3,
      quick_fix_count: 1,
      dialect: { name: "agentforce-default" },
      compiled_via: "local",
      diagnostics: [
        {
          severity: 1,
          code: "missing-required-field",
          message: "expected description",
          range: { start: { line: 16 } },
        },
        {
          severity: 1,
          code: "unknown-action-ref",
          message: "@actions.x not found",
          range: { start: { line: 41 } },
        },
        {
          severity: 2,
          code: "empty-template",
          message: "instructions evaluate to ''",
          range: { start: { line: 28 } },
        },
      ],
    });
    expect(md).toMatch(/❌/);
    expect(md).toMatch(/3 issues/);
    expect(md).toMatch(/2 errors/);
    expect(md).toMatch(/1 warning/);
    expect(md).toMatch(/quick-fix ready/);
    expect(md).toMatch(/missing-required-field/);
    expect(md).toMatch(/L17/); // 16+1
    expect(md).toMatch(/L42/); // 41+1
    expect(md).toMatch(/L29/); // 28+1
  });

  it("emits a quick-fix recover_via hint", () => {
    const md = compileResultMarkdown({
      ok: true,
      action: "check",
      path: "/x.agent",
      diagnostic_count: 1,
      quick_fix_count: 1,
      diagnostics: [
        {
          severity: 1,
          code: "missing-required-field",
          message: "x",
          range: { start: { line: 5 } },
        },
      ],
    });
    expect(md).toMatch(/agentscript_authoring verb=mutate mode=apply_quick_fix/);
    expect(md).toMatch(/line=6/); // 5+1
    expect(md).toMatch(/code=missing-required-field/);
  });

  it("clips at 8 sample diagnostics with overflow note", () => {
    const diagnostics = Array.from({ length: 12 }, (_, i) => ({
      severity: 2 as const,
      code: `c${i}`,
      message: `m${i}`,
      range: { start: { line: i } },
    }));
    const md = compileResultMarkdown({
      ok: true,
      action: "check",
      path: "/x.agent",
      diagnostic_count: 12,
      diagnostics,
    });
    expect(md).toMatch(/12 issues/);
    expect(md).toMatch(/and 4 more/);
  });

  it("format action: changed file shows bytes_changed", () => {
    const md = compileResultMarkdown({
      ok: true,
      action: "format",
      path: "/x.agent",
      changed: true,
      bytes_changed: 27,
    });
    expect(md).toMatch(/✨/);
    expect(md).toMatch(/27 bytes/);
  });

  it("format action: unchanged file shows already-canonical", () => {
    const md = compileResultMarkdown({
      ok: true,
      action: "format",
      path: "/x.agent",
      changed: false,
      bytes_changed: 0,
    });
    expect(md).toMatch(/already canonical/);
  });
});
