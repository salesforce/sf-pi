/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for red/green decision logic and feedback rendering.
 */
import { describe, it, expect } from "vitest";
import {
  buildToolResultUpdate,
  createState,
  resetState,
  renderSuccessFeedback,
  renderErrorFeedback,
  renderUnavailableFeedback,
  renderDoctorReport,
  type SfLspCheckResult,
  type ToolResultContentPart,
} from "../lib/feedback.ts";
import { SF_PI_DIAGNOSTICS_DETAILS_KEY } from "../../../lib/common/display/diagnostics.ts";
import type { LspDiagnostic, LspDoctorStatus } from "../lib/types.ts";

// -------------------------------------------------------------------------------------------------
// Factory helpers
// -------------------------------------------------------------------------------------------------

function makeDiagnostic(overrides: Partial<LspDiagnostic> = {}): LspDiagnostic {
  return {
    severity: 1,
    message: "Expected ';' at end of statement",
    range: {
      start: { line: 10, character: 0 },
      end: { line: 10, character: 5 },
    },
    ...overrides,
  };
}

function makeUnavailableStatus(language: "apex" | "lwc" | "agentscript" = "apex"): LspDoctorStatus {
  return {
    language,
    available: false,
    detail: "Java 11+ not found. Set JAVA_HOME or install OpenJDK.",
  };
}

function makeExistingContent(): ToolResultContentPart[] {
  return [{ type: "text", text: "File written successfully." }];
}

// -------------------------------------------------------------------------------------------------
// State management
// -------------------------------------------------------------------------------------------------

describe("createState / resetState", () => {
  it("creates an empty state", () => {
    const state = createState();
    expect(state.lastStatusByFile.size).toBe(0);
    expect(state.reportedUnavailableByLanguage.size).toBe(0);
  });

  it("resets state to empty", () => {
    const state = createState();
    state.lastStatusByFile.set("/foo.cls", "error");
    state.reportedUnavailableByLanguage.add("apex");

    resetState(state);
    expect(state.lastStatusByFile.size).toBe(0);
    expect(state.reportedUnavailableByLanguage.size).toBe(0);
  });
});

// -------------------------------------------------------------------------------------------------
// buildToolResultUpdate — unavailable
// -------------------------------------------------------------------------------------------------

describe("buildToolResultUpdate — unavailable", () => {
  it("returns unavailable note on first encounter", () => {
    const state = createState();
    const result = buildToolResultUpdate({
      filePath: "/project/classes/MyClass.cls",
      language: "apex",
      existingContent: makeExistingContent(),
      lspResult: { diagnostics: [], unavailable: makeUnavailableStatus() },
      state,
    });

    expect(result).toBeDefined();
    expect(result!.content).toHaveLength(2);
    const appended = result!.content![1] as { type: string; text: string };
    expect(appended.text).toContain("LSP setup note");
    expect(appended.text).toContain("Apex");
  });

  it("returns undefined on second encounter for same language", () => {
    const state = createState();
    const lspResult: SfLspCheckResult = { diagnostics: [], unavailable: makeUnavailableStatus() };
    const options = {
      filePath: "/project/classes/MyClass.cls",
      language: "apex" as const,
      existingContent: makeExistingContent(),
      lspResult,
      state,
    };

    // First call — should return the note
    buildToolResultUpdate(options);

    // Second call — should skip
    const result = buildToolResultUpdate({ ...options, filePath: "/project/classes/Other.cls" });
    expect(result).toBeUndefined();
  });

  it("reports unavailable separately for different languages", () => {
    const state = createState();

    const apexResult = buildToolResultUpdate({
      filePath: "/project/classes/MyClass.cls",
      language: "apex",
      existingContent: makeExistingContent(),
      lspResult: { diagnostics: [], unavailable: makeUnavailableStatus("apex") },
      state,
    });
    expect(apexResult).toBeDefined();

    const lwcResult = buildToolResultUpdate({
      filePath: "/project/lwc/comp/comp.js",
      language: "lwc",
      existingContent: makeExistingContent(),
      lspResult: { diagnostics: [], unavailable: makeUnavailableStatus("lwc") },
      state,
    });
    expect(lwcResult).toBeDefined();
  });
});

// -------------------------------------------------------------------------------------------------
// buildToolResultUpdate — errors
// -------------------------------------------------------------------------------------------------

describe("buildToolResultUpdate — errors", () => {
  it("appends error feedback when diagnostics have errors", () => {
    const state = createState();
    const result = buildToolResultUpdate({
      filePath: "/project/classes/MyClass.cls",
      language: "apex",
      existingContent: makeExistingContent(),
      lspResult: { diagnostics: [makeDiagnostic()] },
      state,
    });

    expect(result).toBeDefined();
    const appended = result!.content![1] as { type: string; text: string };
    expect(appended.text).toContain("LSP feedback");
    expect(appended.text).toContain("MyClass.cls");
    expect(appended.text).toContain("L11"); // line 10 (0-based) → L11
    const details = result!.details as Record<string, unknown>;
    const metadata = details[SF_PI_DIAGNOSTICS_DETAILS_KEY] as {
      fileName?: string;
      status?: string;
    };
    expect(metadata.fileName).toBe("MyClass.cls");
    expect(metadata.status).toBe("error");
  });

  it("tracks file as 'error' in state", () => {
    const state = createState();
    buildToolResultUpdate({
      filePath: "/project/classes/MyClass.cls",
      language: "apex",
      existingContent: makeExistingContent(),
      lspResult: { diagnostics: [makeDiagnostic()] },
      state,
    });

    expect(state.lastStatusByFile.get("/project/classes/MyClass.cls")).toBe("error");
  });

  it("ignores warnings (severity 2) — only reports errors", () => {
    const state = createState();
    const result = buildToolResultUpdate({
      filePath: "/project/classes/MyClass.cls",
      language: "apex",
      existingContent: makeExistingContent(),
      lspResult: { diagnostics: [makeDiagnostic({ severity: 2 })] },
      state,
    });

    // No errors → treated as clean, and no previous error → undefined
    expect(result).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// buildToolResultUpdate — clean transitions
// -------------------------------------------------------------------------------------------------

describe("buildToolResultUpdate — clean transitions", () => {
  it("returns undefined when file was never tracked (first clean result)", () => {
    const state = createState();
    const result = buildToolResultUpdate({
      filePath: "/project/classes/MyClass.cls",
      language: "apex",
      existingContent: makeExistingContent(),
      lspResult: { diagnostics: [] },
      state,
    });

    expect(result).toBeUndefined();
  });

  it("returns undefined when file was already clean", () => {
    const state = createState();
    state.lastStatusByFile.set("/project/classes/MyClass.cls", "clean");

    const result = buildToolResultUpdate({
      filePath: "/project/classes/MyClass.cls",
      language: "apex",
      existingContent: makeExistingContent(),
      lspResult: { diagnostics: [] },
      state,
    });

    expect(result).toBeUndefined();
  });

  it("returns clean note when file transitions from error to clean", () => {
    const state = createState();
    state.lastStatusByFile.set("/project/classes/MyClass.cls", "error");

    const result = buildToolResultUpdate({
      filePath: "/project/classes/MyClass.cls",
      language: "apex",
      existingContent: makeExistingContent(),
      lspResult: { diagnostics: [] },
      state,
    });

    expect(result).toBeDefined();
    const appended = result!.content![1] as { type: string; text: string };
    expect(appended.text).toContain("LSP now clean");
    expect(appended.text).toContain("MyClass.cls");
  });
});

// -------------------------------------------------------------------------------------------------
// Rendering functions
// -------------------------------------------------------------------------------------------------

describe("renderSuccessFeedback", () => {
  it("includes the file basename", () => {
    expect(renderSuccessFeedback("/project/classes/MyClass.cls")).toBe(
      "LSP now clean: MyClass.cls",
    );
  });
});

describe("renderErrorFeedback", () => {
  it("renders header and sorted diagnostics", () => {
    const diagnostics = [
      makeDiagnostic({
        message: "Second error",
        range: { start: { line: 20, character: 0 }, end: { line: 20, character: 5 } },
      }),
      makeDiagnostic({
        message: "First error",
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 5 } },
      }),
    ];

    const output = renderErrorFeedback("/project/classes/MyClass.cls", diagnostics);
    expect(output).toContain("LSP feedback: MyClass.cls");
    // Should be sorted: L6 before L21
    const lines = output.split("\n");
    expect(lines[1]).toContain("L6");
    expect(lines[2]).toContain("L21");
  });

  it("shows omitted count when diagnostics exceed byte budget", () => {
    const diagnostics = Array.from({ length: 100 }, (_, i) =>
      makeDiagnostic({
        message: `Error on line ${i} — ${"x".repeat(200)}`,
        range: { start: { line: i, character: 0 }, end: { line: i, character: 5 } },
      }),
    );

    const output = renderErrorFeedback("/project/classes/Big.cls", diagnostics);
    expect(output).toMatch(/\(\+\d+ more\)/);
  });
});

describe("renderUnavailableFeedback", () => {
  it("includes language label and detail", () => {
    const output = renderUnavailableFeedback("apex", "Java 11+ not found.");
    expect(output).toContain("LSP setup note");
    expect(output).toContain("Apex");
    expect(output).toContain("Java 11+ not found.");
  });

  it("truncates very long detail", () => {
    const longDetail = "x".repeat(500);
    const output = renderUnavailableFeedback("lwc", longDetail);
    expect(output).toContain("...");
    expect(Buffer.byteLength(output, "utf8")).toBeLessThan(1000);
  });
});

describe("renderDoctorReport", () => {
  it("renders available and unavailable statuses", () => {
    const statuses: LspDoctorStatus[] = [
      {
        language: "apex",
        available: true,
        source: "vscode",
        detail: "/path/to/jar",
        command: "java -cp ...",
      },
      { language: "lwc", available: false, detail: "Not found" },
      {
        language: "agentscript",
        available: true,
        source: "pi-global",
        detail: "/path/to/server.js",
        command: "node server.js",
      },
    ];

    const output = renderDoctorReport(statuses);
    expect(output).toContain("✅ Apex (vscode)");
    expect(output).toContain("❌ LWC: Not found");
    expect(output).toContain("✅ Agent Script (pi-global)");
    expect(output).toContain("command:");
  });
});
