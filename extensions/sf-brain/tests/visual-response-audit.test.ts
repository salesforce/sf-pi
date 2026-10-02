/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  captureVisualResponseAudit,
  renderVisualResponseAuditMarkdown,
} from "../lib/visual-response-audit.ts";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "sf-brain-visual-audit-"));
});

afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

describe("privacy-safe visual response audit", () => {
  it("returns only aggregate diagram and icon facts", () => {
    const cwd = path.join(tempDir, "workspace");
    const privatePrompt = "PRIVATE_CUSTOMER_PROMPT_92f51";
    const privateLabel = "PRIVATE_INTERNAL_COMPONENT_4b6d";
    writeSession("2026-01-01T00-00-00-000Z_one.jsonl", cwd, [
      entry("user", privatePrompt),
      entry(
        "assistant",
        `✅ Complete.\n\n\`\`\`mermaid\nsequenceDiagram\n  participant A\n  participant B\n  A->>B: ${privateLabel}\n\`\`\``,
      ),
    ]);
    writeSession("2026-01-02T00-00-00-000Z_two.jsonl", cwd, [
      entry("assistant", "```mermaid\ngantt\n  title Private roadmap\n```"),
    ]);

    const report = captureVisualResponseAudit({
      cwd,
      sessionDir: tempDir,
      maxSessions: 10,
      terminalWidth: 80,
    });
    const serialized = JSON.stringify(report);
    const markdown = renderVisualResponseAuditMarkdown(report);

    expect(report.summary).toMatchObject({
      sessionsAudited: 2,
      finalResponses: 2,
      responsesWithMermaid: 2,
      responsesWithVisualIcons: 1,
      diagrams: 2,
      unsupported: 1,
    });
    expect(report.diagramKinds.sequence).toBe(1);
    expect(serialized).not.toContain(privatePrompt);
    expect(serialized).not.toContain(privateLabel);
    expect(serialized).not.toContain("one.jsonl");
    expect(serialized).not.toContain(cwd);
    expect(markdown).not.toContain(privatePrompt);
    expect(markdown).toContain("Visual Response Audit");
  });

  it("bounds the number and total bytes of inspected sessions", () => {
    const cwd = path.join(tempDir, "workspace");
    writeSession("2026-01-01T00-00-00-000Z_one.jsonl", cwd, [entry("assistant", "First")]);
    writeSession("2026-01-02T00-00-00-000Z_two.jsonl", cwd, [entry("assistant", "Second")]);

    const report = captureVisualResponseAudit({
      cwd,
      sessionDir: tempDir,
      maxSessions: 1,
      maxTotalBytes: 1,
      terminalWidth: 80,
    });

    expect(report.scope.sessionsSelected).toBe(1);
    expect(report.summary.sessionsAudited).toBe(0);
    expect(report.summary.sessionsSkippedForBounds).toBe(1);
  });
});

function writeSession(name: string, cwd: string, messages: Array<Record<string, unknown>>): void {
  const lines = [
    JSON.stringify({
      type: "session",
      version: 3,
      id: "private-session-id",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd,
    }),
    ...messages.map((message, index) =>
      JSON.stringify({
        type: "message",
        id: `entry-${index}`,
        parentId: index === 0 ? null : `entry-${index - 1}`,
        timestamp: "2026-01-01T00:00:00.000Z",
        message,
      }),
    ),
  ];
  writeFileSync(path.join(tempDir, name), `${lines.join("\n")}\n`);
}

function entry(role: "user" | "assistant", text: string): Record<string, unknown> {
  if (role === "user") return { role, content: text, timestamp: 1 };
  return {
    role,
    content: [{ type: "text", text }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}
