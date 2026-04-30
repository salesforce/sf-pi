/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the feedback layer — red/green session state, rendering.
 */
import { describe, expect, it } from "vitest";
import {
  buildToolResultUpdate,
  createState,
  renderErrorFeedback,
  renderSuccessFeedback,
  renderUnavailableFeedback,
  resetState,
} from "../lib/feedback.ts";
import { SF_PI_DIAGNOSTICS_DETAILS_KEY } from "../../../lib/common/display/diagnostics.ts";
import type { AgentScriptCheckResult, AgentScriptDiagnostic } from "../lib/types.ts";

function makeDiagnostic(overrides: Partial<AgentScriptDiagnostic> = {}): AgentScriptDiagnostic {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    },
    message: "something",
    severity: 1,
    ...overrides,
  };
}

function makeOk(overrides: Partial<AgentScriptCheckResult> = {}): AgentScriptCheckResult {
  return {
    ok: true,
    diagnostics: [],
    quickFixes: [],
    ...overrides,
  };
}

describe("createState / resetState", () => {
  it("starts empty and resets all maps", () => {
    const state = createState();
    state.lastStatusByFile.set("/a", "error");
    state.dialectReportedByFile.add("/a");
    state.sdkUnavailableReported = true;

    resetState(state);
    expect(state.lastStatusByFile.size).toBe(0);
    expect(state.dialectReportedByFile.size).toBe(0);
    expect(state.sdkUnavailableReported).toBe(false);
  });
});

describe("renderSuccessFeedback", () => {
  it("includes only the basename", () => {
    expect(renderSuccessFeedback("/abs/path/Billing.agent")).toBe("LSP now clean: Billing.agent");
  });
});

describe("renderUnavailableFeedback", () => {
  it("prefixes the setup note and mentions the reason", () => {
    const rendered = renderUnavailableFeedback("Module not found");
    expect(rendered).toContain("LSP setup note:");
    expect(rendered).toContain("Module not found");
    expect(rendered).toContain("/sf-agentscript-assist doctor");
  });
});

describe("renderErrorFeedback", () => {
  it("renders a diagnostic with its fix", () => {
    const diagnostic = makeDiagnostic({
      range: { start: { line: 13, character: 0 }, end: { line: 13, character: 5 } },
      message: "Deprecated",
      severity: 2,
      code: "deprecated-field",
    });
    const rendered = renderErrorFeedback(
      "/abs/billing.agent",
      "Agent Script dialect: agentforce 2.5",
      [diagnostic],
      [
        {
          title: "Replace with 'subagent'",
          preferred: true,
          diagnosticLine: 13,
          diagnosticCode: "deprecated-field",
          edits: [
            {
              range: { start: { line: 13, character: 0 }, end: { line: 13, character: 5 } },
              newText: "subagent",
            },
          ],
        },
      ],
    );

    expect(rendered).toContain("LSP feedback: billing.agent");
    expect(rendered).toContain("Agent Script dialect: agentforce 2.5");
    expect(rendered).toContain("L14 [warning]: Deprecated");
    expect(rendered).toContain("fix: Replace with 'subagent'");
    expect(rendered).toContain("L14:0-5");
  });

  it("renders '(+N more)' when the overall byte limit is exceeded", () => {
    // Each diagnostic message is truncated to 240 bytes. With 240-byte
    // messages the 8KB rendered cap lets roughly ~30 diagnostics through
    // before we start omitting. Overshooting ensures the omitted tail.
    const many = Array.from({ length: 80 }, (_, i) =>
      makeDiagnostic({
        range: { start: { line: i, character: 0 }, end: { line: i, character: 1 } },
        message: "x".repeat(5000),
      }),
    );
    const rendered = renderErrorFeedback("/file.agent", null, many, []);
    expect(rendered).toMatch(/\(\+\d+ more\)/);
  });
});

describe("buildToolResultUpdate", () => {
  it("stays silent on a clean file that was never broken", () => {
    const state = createState();
    const update = buildToolResultUpdate({
      filePath: "/file.agent",
      existingContent: [],
      checkResult: makeOk(),
      state,
    });
    expect(update).toBeUndefined();
    expect(state.lastStatusByFile.get("/file.agent")).toBe("clean");
  });

  it("emits a 'now clean' note on error → clean transition", () => {
    const state = createState();
    state.lastStatusByFile.set("/file.agent", "error");

    const update = buildToolResultUpdate({
      filePath: "/file.agent",
      existingContent: [],
      checkResult: makeOk(),
      state,
    });

    expect(update?.content?.[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("LSP now clean"),
    });
  });

  it("emits an error block and includes dialect on first feedback", () => {
    const state = createState();
    const update = buildToolResultUpdate({
      filePath: "/billing.agent",
      existingContent: [],
      checkResult: makeOk({
        diagnostics: [makeDiagnostic({ message: "Missing config block" })],
        dialect: { name: "agentforce", version: "2.5" },
      }),
      state,
    });

    const text = (update?.content?.[0] as { text: string } | undefined)?.text ?? "";
    expect(text).toContain("LSP feedback: billing.agent");
    expect(text).toContain("Agent Script dialect: agentforce 2.5");
    const details = update?.details as Record<string, unknown> | undefined;
    const metadata = details?.[SF_PI_DIAGNOSTICS_DETAILS_KEY] as
      | { fileName?: string; source?: string; status?: string }
      | undefined;
    expect(metadata?.fileName).toBe("billing.agent");
    expect(metadata?.source).toBe("sf-agentscript-assist");
    expect(metadata?.status).toBe("error");
    expect(state.lastStatusByFile.get("/billing.agent")).toBe("error");
  });

  it("skips the dialect header on follow-up feedback for the same file", () => {
    const state = createState();
    const first = buildToolResultUpdate({
      filePath: "/billing.agent",
      existingContent: [],
      checkResult: makeOk({
        diagnostics: [makeDiagnostic()],
        dialect: { name: "agentforce", version: "2.5" },
      }),
      state,
    });
    const second = buildToolResultUpdate({
      filePath: "/billing.agent",
      existingContent: [],
      checkResult: makeOk({
        diagnostics: [makeDiagnostic()],
        dialect: { name: "agentforce", version: "2.5" },
      }),
      state,
    });

    const firstText = (first?.content?.[0] as { text: string } | undefined)?.text ?? "";
    const secondText = (second?.content?.[0] as { text: string } | undefined)?.text ?? "";
    expect(firstText).toContain("Agent Script dialect");
    expect(secondText).not.toContain("Agent Script dialect");
  });

  it("reports SDK unavailable once per session, then stays silent", () => {
    const state = createState();
    const first = buildToolResultUpdate({
      filePath: "/file.agent",
      existingContent: [],
      checkResult: { ok: false, diagnostics: [], quickFixes: [], unavailableReason: "boom" },
      state,
    });
    const second = buildToolResultUpdate({
      filePath: "/file.agent",
      existingContent: [],
      checkResult: { ok: false, diagnostics: [], quickFixes: [], unavailableReason: "boom" },
      state,
    });

    expect(first?.content?.[0]).toMatchObject({ type: "text" });
    expect(second).toBeUndefined();
  });
});
