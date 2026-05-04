/* SPDX-License-Identifier: Apache-2.0 */
import { renderDiagnosticsText } from "./diagnostics.ts";
import { sanitizeText } from "./sanitize.ts";
import type { Diagnostics, FeedbackDraft, IssueKind } from "./types.ts";

export function labelForKind(kind: IssueKind): string[] {
  switch (kind) {
    case "bug":
      return ["feedback", "bug"];
    case "feature":
      return ["feedback", "enhancement"];
    case "setup":
      return ["feedback", "setup"];
    case "feedback":
      return ["feedback"];
  }
}

export function titlePrefix(kind: IssueKind): string {
  switch (kind) {
    case "bug":
      return "Bug";
    case "feature":
      return "Feature request";
    case "setup":
      return "Setup issue";
    case "feedback":
      return "Feedback";
  }
}

export function normalizeIssueTitle(kind: IssueKind, title: string): string {
  const cleaned = sanitizeText(title).replace(/\s+/g, " ").trim();
  const prefix = titlePrefix(kind);
  if (!cleaned) return `[${prefix}] Untitled`;
  if (cleaned.startsWith("[")) return cleaned;
  return `[${prefix}] ${cleaned}`;
}

export function buildIssueBody(draft: FeedbackDraft, diagnostics: Diagnostics): string {
  const summary = sanitizeText(draft.summary).trim() || "Not provided.";
  const expected = sanitizeText(draft.expected).trim() || "Not provided.";
  const steps = sanitizeText(draft.steps).trim() || "Not provided.";

  return [
    "## Summary",
    "",
    summary,
    "",
    "## What happened?",
    "",
    summary,
    "",
    "## What did you expect?",
    "",
    expected,
    "",
    "## Steps to reproduce",
    "",
    steps,
    "",
    "## Diagnostics",
    "",
    "```text",
    renderDiagnosticsText(diagnostics),
    "```",
    "",
    "## Privacy note",
    "",
    "Diagnostics were sanitized before this issue was drafted. Salesforce org aliases, instance URLs, emails, tokens, and local home-directory paths are redacted by default.",
    "",
  ].join("\n");
}

export function buildDiagnosticsOnlyBody(diagnostics: Diagnostics): string {
  return ["## Diagnostics", "", "```text", renderDiagnosticsText(diagnostics), "```", ""].join(
    "\n",
  );
}
