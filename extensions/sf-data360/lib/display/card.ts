/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Standard Data 360 result-card contract.
 *
 * This file is intentionally pure: no pi runtime imports, no TUI imports, and
 * no filesystem writes. Data 360 tools can map any domain result (STDM,
 * Platform Tracing, segments, activations, ingestion, etc.) into this compact
 * card shape, then use the render helpers for model-facing content and future
 * TUI renderers.
 */

export type D360CardStatus = "success" | "warning" | "error";
export type D360ArtifactKind = "json" | "sql" | "markdown" | "csv";

export interface D360ResultFact {
  label: string;
  value: string;
}

export interface D360ResultSection {
  title: string;
  icon?: string;
  lines: string[];
}

export interface D360ResultArtifact {
  label: string;
  path: string;
  kind: D360ArtifactKind;
}

export interface D360ResultCard {
  status: D360CardStatus;
  icon: string;
  title: string;
  subtitle?: string;
  /** One-sentence outcome. */
  summary: string;
  facts?: D360ResultFact[];
  sections?: D360ResultSection[];
  artifacts?: D360ResultArtifact[];
  nextSteps?: string[];
}

export interface D360CardRenderOptions {
  /** Default 8. Includes header/facts/sections/artifacts/next-step lines. */
  collapsedMaxLines?: number;
  /** Default 40. Applies only to expanded rendering. */
  expandedMaxLines?: number;
  /** Default 160. */
  lineMaxChars?: number;
}

const STATUS_ICON: Record<D360CardStatus, string> = {
  success: "✅",
  warning: "⚠️",
  error: "❌",
};

export function renderCardForLlm(card: D360ResultCard, opts: D360CardRenderOptions = {}): string {
  const lines = renderExpandedLines(card, {
    ...opts,
    expandedMaxLines: opts.expandedMaxLines ?? 24,
  });
  return lines.join("\n");
}

export function renderCardCollapsed(
  card: D360ResultCard,
  opts: D360CardRenderOptions = {},
): string {
  const maxLines = opts.collapsedMaxLines ?? 8;
  const lines = buildCardLines(card, opts, "collapsed");
  return clampLines(preserveArtifactLines(lines, card, opts), maxLines, opts).join("\n");
}

export function renderCardExpanded(card: D360ResultCard, opts: D360CardRenderOptions = {}): string {
  return renderExpandedLines(card, opts).join("\n");
}

function renderExpandedLines(card: D360ResultCard, opts: D360CardRenderOptions): string[] {
  const maxLines = opts.expandedMaxLines ?? 40;
  const lines = buildCardLines(card, opts, "expanded");
  return clampLines(preserveArtifactLines(lines, card, opts), maxLines, opts);
}

function buildCardLines(
  card: D360ResultCard,
  opts: D360CardRenderOptions,
  mode: "collapsed" | "expanded",
): string[] {
  const maxChars = opts.lineMaxChars ?? 160;
  const title = `${card.icon} ${card.title} ${STATUS_ICON[card.status]}`.trim();
  const lines = [clipLine(title, maxChars)];
  if (card.subtitle) lines.push(clipLine(card.subtitle, maxChars));
  if (card.summary) lines.push(clipLine(card.summary, maxChars));

  const showCollapsedFacts = mode === "collapsed" && !card.sections?.length;
  if (card.facts?.length && (mode === "expanded" || showCollapsedFacts)) {
    if (mode === "expanded") lines.push("", "Facts");
    const facts = mode === "collapsed" ? card.facts.slice(0, 4) : card.facts;
    for (const fact of facts) lines.push(clipLine(`• ${fact.label}: ${fact.value}`, maxChars));
  }

  for (const section of card.sections ?? []) {
    if (mode === "expanded") lines.push("", `${section.icon ?? "•"} ${section.title}`);
    const sectionLimit = mode === "collapsed" ? 4 : section.lines.length;
    for (const line of section.lines.slice(0, sectionLimit)) {
      lines.push(clipLine(line, maxChars));
    }
    const omitted = section.lines.length - sectionLimit;
    if (omitted > 0) lines.push(`… +${omitted} more ${section.title.toLowerCase()} line(s)`);
  }

  if (card.artifacts?.length) {
    if (mode === "expanded") lines.push("", "Artifacts");
    for (const artifact of card.artifacts) {
      lines.push(
        clipLine(`${artifactIcon(artifact.kind)} ${artifact.label}: ${artifact.path}`, maxChars),
      );
    }
  }

  if (card.nextSteps?.length) {
    if (mode === "expanded") lines.push("", "Next");
    const next = mode === "collapsed" ? card.nextSteps.slice(0, 2) : card.nextSteps;
    for (const step of next) lines.push(clipLine(`→ ${step}`, maxChars));
  }

  return lines;
}

function preserveArtifactLines(
  lines: string[],
  card: D360ResultCard,
  opts: D360CardRenderOptions,
): string[] {
  const artifacts = card.artifacts ?? [];
  if (artifacts.length === 0) return lines;
  const maxChars = opts.lineMaxChars ?? 160;
  const artifactLines = artifacts.map((artifact) =>
    clipLine(`${artifactIcon(artifact.kind)} ${artifact.label}: ${artifact.path}`, maxChars),
  );
  const withoutDuplicateArtifacts = lines.filter((line) => !artifactLines.includes(line));
  return [...withoutDuplicateArtifacts, ...artifactLines];
}

function clampLines(lines: string[], maxLines: number, opts: D360CardRenderOptions): string[] {
  if (maxLines <= 0 || lines.length <= maxLines) return lines;
  const maxChars = opts.lineMaxChars ?? 160;
  const artifactLines = lines.filter((line) => /^📄|^🧾|^📝|^📊/.test(line));
  const artifactSet = new Set(artifactLines);
  const bodyBudget = Math.max(1, maxLines - artifactLines.length - 1);
  const body = lines.filter((line) => !artifactSet.has(line)).slice(0, bodyBudget);
  const omitted = lines.length - body.length - artifactLines.length;
  const omittedLine = omitted > 0 ? [clipLine(`… +${omitted} more line(s)`, maxChars)] : [];
  return [...body, ...omittedLine, ...artifactLines].slice(0, maxLines);
}

function artifactIcon(kind: D360ArtifactKind): string {
  switch (kind) {
    case "sql":
      return "🧾";
    case "markdown":
      return "📝";
    case "csv":
      return "📊";
    case "json":
    default:
      return "📄";
  }
}

function clipLine(value: string, maxChars: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxChars) return oneLine;
  return `${oneLine.slice(0, Math.max(1, maxChars - 1))}…`;
}
