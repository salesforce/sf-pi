/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Build safe, deterministic quick fixes for a set of filtered diagnostics.
 *
 * Generic AgentScript quick fixes are delegated to the official
 * @sf-agentscript/lsp provider. SF Pi keeps only the Salesforce/pi-specific
 * hardening fixes that upstream does not own.
 */

import { AGENTFORCE_DOCUMENT_URI, processAgentforceDocument } from "./agentforce-document.ts";
import type { DocumentState } from "@sf-agentscript/lsp";
import type { AgentScriptDiagnostic, AgentScriptQuickFix, AgentScriptRange } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Shape of diagnostic data we trust for local hardening fixes
// -------------------------------------------------------------------------------------------------

/**
 * `data.removalRange` travels on local diagnostics that remove a declaration.
 */
interface RemovalRangeData {
  removalRange?: AgentScriptRange;
}

// -------------------------------------------------------------------------------------------------
// Official LSP quick-fix adapter
// -------------------------------------------------------------------------------------------------

function fullDocumentRange(source: string): AgentScriptRange {
  const lines = source.split("\n");
  const lastLine = Math.max(0, lines.length - 1);
  return {
    start: { line: 0, character: 0 },
    end: { line: lastLine, character: lines[lastLine]?.length ?? 0 },
  };
}

function codeOf(diagnostic: unknown): string | undefined {
  const code = (diagnostic as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

async function officialQuickFixes(
  source: string,
  diagnostics: AgentScriptDiagnostic[],
  state?: DocumentState,
): Promise<AgentScriptQuickFix[]> {
  let actions: Array<{
    title: string;
    isPreferred?: boolean;
    diagnostics?: AgentScriptDiagnostic[];
    edit?: { changes?: Record<string, Array<{ range: AgentScriptRange; newText: string }>> };
  }>;
  try {
    const [documentState, { provideCodeActions }] = await Promise.all([
      state ?? processAgentforceDocument(source, AGENTFORCE_DOCUMENT_URI),
      import("@sf-agentscript/lsp"),
    ]);
    actions = provideCodeActions(
      documentState,
      fullDocumentRange(source),
      diagnostics as Parameters<typeof provideCodeActions>[2],
    ) as typeof actions;
  } catch {
    return [];
  }

  const fixes: AgentScriptQuickFix[] = [];
  for (const action of actions) {
    const edits = action.edit?.changes?.[AGENTFORCE_DOCUMENT_URI];
    if (!edits || edits.length === 0) continue;

    const firstDiagnostic = action.diagnostics?.[0];
    fixes.push({
      title: action.title,
      preferred: action.isPreferred === true,
      diagnosticLine: firstDiagnostic?.range.start.line ?? edits[0].range.start.line,
      diagnosticCode: codeOf(firstDiagnostic),
      edits: edits.map((edit) => ({
        range: edit.range,
        newText: edit.newText,
      })),
    });
  }
  return fixes;
}

// -------------------------------------------------------------------------------------------------
// SF Pi local hardening fix builders
// -------------------------------------------------------------------------------------------------

function buildRemovalRangeFix(
  source: string,
  diagnostic: AgentScriptDiagnostic,
  title: string,
): AgentScriptQuickFix | null {
  const data = (diagnostic.data ?? {}) as RemovalRangeData;
  const removal = data.removalRange;
  if (!removal || !removal.start || !removal.end) return null;

  // Extend the end of the removal to the end of the line so we don't leave a
  // blank stub behind.
  const lines = source.split("\n");
  const endLine = removal.end.line;
  const endLineLength = lines[endLine]?.length ?? 0;

  const deleteEnd =
    endLine + 1 < lines.length
      ? { line: endLine + 1, character: 0 }
      : { line: endLine, character: endLineLength };

  return {
    title,
    preferred: true,
    diagnosticLine: diagnostic.range.start.line,
    diagnosticCode: diagnostic.code,
    edits: [
      {
        range: {
          start: { line: removal.start.line, character: 0 },
          end: deleteEnd,
        },
        newText: "",
      },
    ],
  };
}

function buildEmployeeDefaultUserFix(
  source: string,
  diagnostic: AgentScriptDiagnostic,
): AgentScriptQuickFix | null {
  return buildRemovalRangeFix(
    source,
    diagnostic,
    "Remove default_agent_user from Employee Agent config",
  );
}

/**
 * Detect the `transition to @topic.X when "..."` footgun and offer to
 * strip the unsupported `when` clause.
 */
const TRANSITION_WHEN_RE = /^(?<keep>\s*transition\s+to\s+@[A-Za-z_][\w.]*)\s+when\b.*$/;

function buildMissingTokenTransitionFix(
  source: string,
  diagnostic: AgentScriptDiagnostic,
): AgentScriptQuickFix | null {
  const lines = source.split("\n");
  const lineText = lines[diagnostic.range.start.line];
  if (!lineText) return null;
  const m = TRANSITION_WHEN_RE.exec(lineText);
  if (!m || !m.groups?.keep) return null;
  return {
    title: `Remove unsupported 'when ...' clause (transitions don't support guards)`,
    preferred: true,
    diagnosticLine: diagnostic.range.start.line,
    diagnosticCode: diagnostic.code,
    edits: [
      {
        range: {
          start: { line: diagnostic.range.start.line, character: 0 },
          end: { line: diagnostic.range.start.line, character: lineText.length },
        },
        newText: m.groups.keep,
      },
    ],
  };
}

function localHardeningQuickFixes(
  source: string,
  diagnostics: AgentScriptDiagnostic[],
): AgentScriptQuickFix[] {
  const fixes: AgentScriptQuickFix[] = [];

  for (const diagnostic of diagnostics) {
    switch (diagnostic.code) {
      case "employee-agent-default-user": {
        const fix = buildEmployeeDefaultUserFix(source, diagnostic);
        if (fix) fixes.push(fix);
        break;
      }
      case "missing-token": {
        const fix = buildMissingTokenTransitionFix(source, diagnostic);
        if (fix) fixes.push(fix);
        break;
      }
      default:
        break;
    }
  }

  return fixes;
}

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

/**
 * Build the ordered list of quick fixes for a document.
 *
 * Input is the already-filtered diagnostic list so that quick fix generation
 * can't accidentally surface fixes for diagnostics the rest of the system chose
 * to hide.
 */
export async function buildQuickFixes(
  source: string,
  diagnostics: AgentScriptDiagnostic[],
  state?: DocumentState,
): Promise<AgentScriptQuickFix[]> {
  if (diagnostics.length === 0) return [];
  return [
    ...(await officialQuickFixes(source, diagnostics, state)),
    ...localHardeningQuickFixes(source, diagnostics),
  ];
}
