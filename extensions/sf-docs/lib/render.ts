/* SPDX-License-Identifier: Apache-2.0 */
/** Human-polished and LLM-bounded formatting for SF Docs. */
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type {
  DocsCitation,
  DocsCollection,
  DocsDocument,
  DocsSearchResult,
  SfDocsDisplayDensity,
} from "./types.ts";

interface RenderOptions {
  isPartial?: boolean;
  expanded?: boolean;
}

interface FetchRenderDocument extends DocsDocument {
  status?: "ok" | "error";
  contentChars?: number;
  llmReturnedChars?: number;
  llmTruncated?: boolean;
  metadataOnly?: boolean;
  headings?: string[];
  humanPreview?: string;
}

interface DensityBudget {
  searchSnippetChars: number;
  collapsedFetchPreviewChars: number;
  expandedFetchPreviewChars: number;
  collapsedAnswerChars: number;
  expandedVisibleChars: number;
  collapsedFetchDocs: number;
}

const DENSITY_BUDGETS: Record<SfDocsDisplayDensity, DensityBudget> = {
  compact: {
    searchSnippetChars: 0,
    collapsedFetchPreviewChars: 0,
    expandedFetchPreviewChars: 400,
    collapsedAnswerChars: 800,
    expandedVisibleChars: 4000,
    collapsedFetchDocs: 3,
  },
  balanced: {
    searchSnippetChars: 180,
    collapsedFetchPreviewChars: 240,
    expandedFetchPreviewChars: 800,
    collapsedAnswerChars: 1600,
    expandedVisibleChars: 6000,
    collapsedFetchDocs: 4,
  },
  verbose: {
    searchSnippetChars: 300,
    collapsedFetchPreviewChars: 500,
    expandedFetchPreviewChars: 1400,
    collapsedAnswerChars: 3200,
    expandedVisibleChars: 8000,
    collapsedFetchDocs: 6,
  },
};

export function renderToolCall(
  args: {
    action?: string;
    query?: string;
    collection?: string;
    ids?: string[];
    urls?: string[];
    format?: string;
  },
  theme: Theme,
): Text {
  const bits = [args.action ?? "status"];
  if (args.collection) bits.push(args.collection);
  if (args.query) bits.push(`"${clipLine(args.query, 60)}"`);
  if (args.ids?.length) bits.push(`${args.ids.length} id${args.ids.length === 1 ? "" : "s"}`);
  if (args.urls?.length) bits.push(`${args.urls.length} url${args.urls.length === 1 ? "" : "s"}`);
  if (args.format) bits.push(args.format);
  return new Text(
    theme.fg("toolTitle", theme.bold("📚 SF Docs ")) + theme.fg("muted", bits.join(" · ")),
    0,
    0,
  );
}

export function renderToolResult(
  result: { details?: Record<string, unknown>; content?: unknown[] },
  opts: RenderOptions,
  theme: Theme,
): Text {
  if (opts.isPartial) return new Text(theme.fg("warning", "📚 SF Docs · loading…"), 0, 0);
  const details = result.details ?? {};
  if (details.ok === false) {
    return new Text(theme.fg("error", `✗ ${firstText(result.content) || "SF Docs failed"}`), 0, 0);
  }
  const action = String(details.action ?? "status");
  if (action === "search") return new Text(formatSearch(details, theme, opts), 0, 0);
  if (action === "answer" || action === "explain")
    return new Text(formatAnswer(details, theme, opts), 0, 0);
  if (action === "fetch") return new Text(formatFetch(details, theme, opts), 0, 0);
  if (action === "collections") return new Text(formatCollections(details, theme), 0, 0);
  return new Text(firstText(result.content), 0, 0);
}

export function formatSearch(
  details: Record<string, unknown>,
  theme?: Theme,
  opts: { expanded?: boolean } = {},
): string {
  const results = asArray<DocsSearchResult>(details.results);
  const total = typeof details.totalCount === "number" ? details.totalCount : results.length;
  const density = displayDensity(details);
  const budget = DENSITY_BUDGETS[density];
  const showSnippets = opts.expanded || density === "verbose";
  const lines = [
    header("📚", `SF Docs search · ${slice(details)}`, theme),
    row("🔎", "Query", String(details.query ?? ""), theme),
    row(
      "✅",
      "Results",
      `${results.length}${total !== results.length ? ` of ${total}` : ""}`,
      theme,
    ),
    row("👁", "Density", density, theme),
  ];
  lines.push(...queryPlanRows(details, theme), "");
  results.slice(0, 10).forEach((result, index) => {
    lines.push(
      `  ${index + 1}. ${strong(result.title ?? "Untitled", theme)} ${dim(result.product ? `· ${result.product}` : "", theme)}`,
    );
    if (result.url) lines.push(`     🔗 ${link(result.url, theme)}`);
    if (result.id)
      lines.push(`     🆔 ${code(opts.expanded ? result.id : shortId(result.id), theme)}`);
    if (showSnippets) {
      const snippet = searchSnippet(result, budget.searchSnippetChars);
      if (snippet) lines.push(`     ${dim(`Snippet: ${snippet}`, theme)}`);
    }
  });
  lines.push("");
  lines.push(
    dim("💡 Next: fetch result ids for source text; use answer for quick cited synthesis.", theme),
  );
  return lines.join("\n");
}

export function formatAnswer(
  details: Record<string, unknown>,
  theme?: Theme,
  opts: { expanded?: boolean } = {},
): string {
  const citations = asArray<DocsCitation>(details.citations);
  const density = displayDensity(details);
  const budget = DENSITY_BUDGETS[density];
  const answer = String(details.answer ?? details.explanation ?? "(no answer)");
  const visibleAnswer = opts.expanded ? answer : clipText(answer, budget.collapsedAnswerChars);
  const lines = [
    header(
      "📚",
      `SF Docs ${details.action === "explain" ? "explain" : "answer"} · ${slice(details)}`,
      theme,
    ),
    row("✅", "Sources", `${citations.length} citation${citations.length === 1 ? "" : "s"}`, theme),
    row("👁", "Density", density, theme),
  ];
  lines.push(
    ...queryPlanRows(details, theme),
    "",
    section("🧾", opts.expanded ? "Answer" : "Answer preview", theme),
    visibleAnswer,
  );
  if (!opts.expanded && answer.length > visibleAnswer.length) {
    lines.push(dim("…answer truncated in human view; expand for full bounded answer.", theme));
  }
  if (citations.length) {
    lines.push("", section("📎", "Citations", theme));
    citations.slice(0, 12).forEach((citation, index) => {
      lines.push(`  ${index + 1}. ${strong(citation.title ?? "Untitled", theme)}`);
      if (citation.url) lines.push(`     ${link(citation.url, theme)}`);
    });
  }
  return lines.join("\n");
}

export function formatFetch(
  details: Record<string, unknown>,
  theme?: Theme,
  opts: { expanded?: boolean } = {},
): string {
  const documents = asArray<FetchRenderDocument>(details.documents);
  const density = displayDensity(details);
  const budget = DENSITY_BUDGETS[density];
  const llmBudget = isRecord(details.llmBudget) ? details.llmBudget : {};
  const returnedChars = numberValue(llmBudget.returnedChars);
  const maxTotalChars = numberValue(llmBudget.maxTotalChars);
  const truncatedDocuments = numberValue(llmBudget.truncatedDocuments);
  const metadataOnlyDocuments = numberValue(llmBudget.metadataOnlyDocuments);
  const totalContentChars = numberValue(details.totalContentChars);
  const previewChars = opts.expanded
    ? budget.expandedFetchPreviewChars
    : budget.collapsedFetchPreviewChars;
  const visibleDocs = opts.expanded ? documents : documents.slice(0, budget.collapsedFetchDocs);
  const lines = [
    header("📚", `SF Docs fetch · ${slice(details)}`, theme),
    row("📄", "Documents", String(documents.length), theme),
    row(
      "📦",
      "LLM packet",
      `${formatChars(returnedChars)} bounded source${maxTotalChars ? ` · cap ${formatChars(maxTotalChars)}` : ""}`,
      theme,
    ),
    row("👁", "Density", density, theme),
  ];
  lines.push(...queryPlanRows(details, theme));
  if (totalContentChars)
    lines.push(row("📚", "Source", `${formatChars(totalContentChars)} fetched`, theme));
  if (truncatedDocuments || metadataOnlyDocuments) {
    lines.push(
      row(
        "⚠",
        "Truncation",
        [
          truncatedDocuments
            ? `${truncatedDocuments} doc${truncatedDocuments === 1 ? "" : "s"} clipped`
            : "",
          metadataOnlyDocuments ? `${metadataOnlyDocuments} metadata-only after packet cap` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        theme,
      ),
    );
  }
  lines.push("");

  visibleDocs.forEach((doc, index) => {
    lines.push(
      section("📄", `${index + 1}. ${doc.title ?? doc.id ?? doc.url ?? "Document"}`, theme),
    );
    if (doc.url) lines.push(`🔗 ${link(doc.url, theme)}`);
    if (doc.id) lines.push(`🆔 ${code(opts.expanded ? doc.id : shortId(doc.id), theme)}`);
    if (doc.error) lines.push(`⚠ ${doc.error}`);
    lines.push(
      dim(
        `Source: ${formatChars(doc.contentChars ?? textLength(doc.content))} fetched · ${formatChars(doc.llmReturnedChars ?? textLength(doc.content))} sent to LLM${doc.llmTruncated ? " · clipped" : ""}${doc.metadataOnly ? " · metadata-only" : ""}`,
        theme,
      ),
    );
    const headings = asArray<string>(doc.headings).slice(0, opts.expanded ? 5 : 3);
    if (headings.length) lines.push(dim(`Headings: ${headings.join(" · ")}`, theme));
    const preview = fetchPreview(doc, previewChars);
    if (preview) {
      lines.push(dim(opts.expanded ? "Preview:" : "Preview:", theme));
      lines.push(preview);
    } else if (!opts.expanded && previewChars === 0) {
      lines.push(dim("Preview hidden at compact density; expand for a bounded preview.", theme));
    }
    lines.push("");
  });

  if (!opts.expanded && documents.length > visibleDocs.length) {
    lines.push(
      dim(`+${documents.length - visibleDocs.length} more document(s). Expand for cards.`, theme),
    );
  }
  lines.push(
    dim(
      "💡 LLM received the bounded Docs Evidence Packet. Expand for previews; open URLs for full source.",
      theme,
    ),
  );
  return clipText(lines.join("\n").trimEnd(), budget.expandedVisibleChars);
}

export function formatCollections(details: Record<string, unknown>, theme?: Theme): string {
  const collections = asArray<DocsCollection>(details.collections);
  const summaries = asArray<Record<string, string>>(details.capabilitySummaries);
  const lines = [header("📚", "SF Docs collections", theme)];
  if (details.cache) lines.push(row("🗄", "Cache", String(details.cache), theme));
  if (details.collectionAlias)
    lines.push(row("↪", "Alias", String(details.collectionAlias), theme));
  if (details.displayDensity) lines.push(row("👁", "Density", displayDensity(details), theme));
  lines.push("");
  const nameW = Math.max(10, ...collections.map((c) => visibleWidth(c.collection)));
  lines.push(
    `  ${dim(pad("Collection", nameW), theme)}  ${dim("Versions", theme)}  ${dim("Locales", theme)}  ${dim("Formats", theme)}`,
  );
  for (const c of collections) {
    lines.push(
      `  ${code(pad(c.collection, nameW), theme)}  ${dim((c.versions ?? []).join(",") || "-", theme)}  ${dim(formatCount(c.locales), theme)}  ${dim((c.formats ?? []).join(",") || "-", theme)}`,
    );
    const summary = summaries.find((item) => item.collection === c.collection);
    if (summary?.keyFilters) lines.push(`     ${dim(`filters: ${summary.keyFilters}`, theme)}`);
    if (summary?.landmarks) lines.push(`     ${dim(`landmarks: ${summary.landmarks}`, theme)}`);
    if (summary?.extraFields) lines.push(`     ${dim(`extra: ${summary.extraFields}`, theme)}`);
  }
  return lines.join("\n");
}

export function clipLine(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

export function clipText(value: string, max: number): string {
  if (max <= 0) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n…truncated ${value.length - max} chars. Fetch a narrower document or open the source URL for full text.`;
}

function header(icon: string, label: string, theme?: Theme): string {
  return theme ? theme.fg("accent", theme.bold(`${icon} ${label}`)) : `**${icon} ${label}**`;
}

function section(icon: string, label: string, theme?: Theme): string {
  return theme ? theme.fg("muted", `─── ${icon} ${label} ───`) : `**${icon} ${label}**`;
}

function row(icon: string, label: string, value: string, theme?: Theme): string {
  return `  ${icon} ${code(pad(label, 12), theme)} ${value}`;
}

function code(value: string, theme?: Theme): string {
  return theme ? theme.fg("mdCode", value) : value;
}

function strong(value: string, theme?: Theme): string {
  return theme ? theme.bold(value) : `**${value}**`;
}

function dim(value: string, theme?: Theme): string {
  return theme ? theme.fg("dim", value) : value;
}

function link(value: string, theme?: Theme): string {
  return theme ? theme.fg("mdLink", value) : value;
}

function pad(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - visibleWidth(value)))}`;
}

function firstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (!first || typeof first !== "object" || !("text" in first)) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function formatCount(values?: unknown[]): string {
  if (!values?.length) return "-";
  return values.length <= 3
    ? values.join(",")
    : `${values.slice(0, 3).join(",")} +${values.length - 3}`;
}

function queryPlanRows(details: Record<string, unknown>, theme?: Theme): string[] {
  const plan = isRecord(details.queryPlan) ? details.queryPlan : undefined;
  if (!plan) return [];
  const rows = [row("🧭", "Compiled", String(plan.compiledQuery ?? ""), theme)];
  const filters = [asArray<string>(plan.filters), asArray<string>(plan.boosts)].flat();
  if (filters.length) rows.push(row("🎚", "Filters", filters.join(" "), theme));
  if (plan.evidenceStatus) {
    rows.push(
      row(
        "🧪",
        "Evidence",
        `${plan.evidenceStatus}${plan.evidenceMessage ? ` — ${plan.evidenceMessage}` : ""}`,
        theme,
      ),
    );
  }
  return rows;
}

function slice(details: Record<string, unknown>): string {
  return `${details.collection ?? "?"}/${details.version ?? "current"}/${details.locale ?? "en-us"}`;
}

function displayDensity(details: Record<string, unknown>): SfDocsDisplayDensity {
  return details.displayDensity === "compact" ||
    details.displayDensity === "balanced" ||
    details.displayDensity === "verbose"
    ? details.displayDensity
    : "balanced";
}

function searchSnippet(result: DocsSearchResult, max: number): string {
  if (max <= 0) return "";
  const raw = result.content;
  if (typeof raw !== "string") return "";
  return clipLine(raw.replace(/\s+/g, " ").trim(), max);
}

function fetchPreview(doc: FetchRenderDocument, max: number): string {
  if (max <= 0) return "";
  const raw = typeof doc.humanPreview === "string" ? doc.humanPreview : doc.content;
  if (typeof raw !== "string") return "";
  return clipText(raw.replace(/\s+/g, " ").trim(), max);
}

function textLength(value: unknown): number {
  return typeof value === "string" ? value.length : 0;
}

function formatChars(value: number): string {
  if (!value) return "0 chars";
  if (value < 1000) return `${value} chars`;
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k chars`;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
