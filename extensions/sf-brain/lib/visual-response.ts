/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic, content-safe checks for terminal Mermaid response contracts. */
import { type DiagramKind, diagramKind, render } from "grok-mermaid";

export interface MermaidDiagramAnalysis {
  kind: DiagramKind | "unsupported";
  supported: boolean;
  syntaxValid: boolean;
  topLevel: boolean;
  closed: boolean;
  width?: number;
  height?: number;
  warnings: number;
  renderableAtWidth: boolean;
}

export interface VisualResponseAnalysis {
  diagrams: MermaidDiagramAnalysis[];
}

export interface VisualResponseContract {
  mermaid: "required" | "forbidden";
  kind?: DiagramKind;
  maxWidth?: number;
  maxDiagrams?: number;
  requireTopLevel?: boolean;
  requireZeroWarnings?: boolean;
}

export interface VisualResponseContractResult {
  passed: boolean;
  diagram_count: number;
  kinds: Array<DiagramKind | "unsupported">;
  renderable_count: number;
  facts: string[];
}

export function analyzeVisualResponse(
  markdown: string,
  availableWidth = 80,
): VisualResponseAnalysis {
  return {
    diagrams: extractMermaidBlocks(markdown).map((block) => {
      const kind = diagramKind(block.source);
      const art = render(block.source);
      const supported = kind !== null;
      const warnings = art?.warnings.length ?? 0;
      return {
        kind: kind ?? "unsupported",
        supported,
        syntaxValid: !!art,
        topLevel: block.topLevel,
        closed: block.closed,
        ...(art ? { width: art.width, height: art.plain.length } : {}),
        warnings,
        renderableAtWidth:
          block.topLevel &&
          block.closed &&
          supported &&
          !!art &&
          warnings === 0 &&
          art.width <= availableWidth,
      };
    }),
  };
}

export function evaluateVisualResponseContract(
  contract: VisualResponseContract,
  markdown: string,
): VisualResponseContractResult {
  const width = contract.maxWidth ?? 80;
  const diagrams = analyzeVisualResponse(markdown, width).diagrams;
  const facts: string[] = [];
  let passed = true;

  if (contract.mermaid === "forbidden") {
    if (diagrams.length === 0) facts.push("No Mermaid diagram was present, as required.");
    else {
      passed = false;
      facts.push(`Observed ${diagrams.length} Mermaid diagram(s), but none were expected.`);
    }
  } else if (diagrams.length === 0) {
    passed = false;
    facts.push("No Mermaid diagram was present.");
  } else {
    facts.push(`Observed ${diagrams.length} Mermaid diagram(s).`);
  }

  if (contract.maxDiagrams !== undefined && diagrams.length > contract.maxDiagrams) {
    passed = false;
    facts.push(`Diagram count exceeded the maximum of ${contract.maxDiagrams}.`);
  }
  if (contract.kind && diagrams.some((diagram) => diagram.kind !== contract.kind)) {
    passed = false;
    facts.push(`At least one diagram did not use the expected ${contract.kind} form.`);
  }
  if (diagrams.some((diagram) => !diagram.supported || !diagram.closed)) {
    passed = false;
    facts.push("At least one diagram was unsupported or had an incomplete fence.");
  }
  if (contract.requireTopLevel && diagrams.some((diagram) => !diagram.topLevel)) {
    passed = false;
    facts.push("At least one Mermaid fence was nested instead of top-level.");
  }
  if (contract.requireZeroWarnings && diagrams.some((diagram) => diagram.warnings > 0)) {
    passed = false;
    facts.push("At least one diagram produced parser warnings.");
  }
  if (diagrams.some((diagram) => diagram.width !== undefined && diagram.width > width)) {
    passed = false;
    facts.push(`At least one diagram exceeded ${width} terminal columns.`);
  }

  return {
    passed,
    diagram_count: diagrams.length,
    kinds: [...new Set(diagrams.map((diagram) => diagram.kind))],
    renderable_count: diagrams.filter((diagram) => diagram.renderableAtWidth).length,
    facts,
  };
}

interface MermaidBlock {
  source: string;
  topLevel: boolean;
  closed: boolean;
}

function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: MermaidBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index]?.match(/^([ \t]*)```mermaid(?:\s+.*)?\s*$/i);
    if (!opening) continue;
    const body: string[] = [];
    let closed = false;
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      if (/^[ \t]*```\s*$/.test(lines[cursor] ?? "")) {
        closed = true;
        break;
      }
      body.push(lines[cursor] ?? "");
    }
    blocks.push({
      source: body.join("\n"),
      topLevel: (opening[1] ?? "").length === 0,
      closed,
    });
    index = closed ? cursor : lines.length;
  }
  return blocks;
}
