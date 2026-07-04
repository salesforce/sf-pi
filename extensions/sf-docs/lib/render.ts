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
  sourcePath?: string;
  baseUrl?: string;
  release?: string | number;
  contentHash?: string;
  description?: string;
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
  if (opts.isPartial) return new Text(formatLoading(theme), 0, 0);
  const details = result.details ?? {};
  const action = String(details.action ?? "status");
  if (details.ok === false) {
    return new Text(formatFailure(action, details, firstText(result.content), theme), 0, 0);
  }
  if (action === "search") return new Text(formatSearch(details, theme, opts), 0, 0);
  if (action === "answer" || action === "explain")
    return new Text(formatAnswer(details, theme, opts), 0, 0);
  if (action === "fetch") return new Text(formatFetch(details, theme, opts), 0, 0);
  if (action === "collections") return new Text(formatCollections(details, theme), 0, 0);
  return new Text(formatSimple(action, details, firstText(result.content), theme), 0, 0);
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
  const lines = cardHeader("search", details, theme, "ok");
  lines.push(...lineageSection(details, "search", theme));
  lines.push(
    ...sectionBlock(
      "2",
      "Results",
      [
        fact(
          "✅",
          "Matches",
          `${results.length}${total !== results.length ? ` of ${total}` : ""}`,
          theme,
        ),
        fact("👁", "Density", density, theme),
        ...results
          .slice(0, 10)
          .flatMap((result, index) =>
            searchResultLines(
              result,
              index,
              showSnippets ? budget.searchSnippetChars : 0,
              theme,
              opts.expanded,
            ),
          ),
      ],
      theme,
    ),
  );
  lines.push(
    ...nextSection(
      "Fetch promising result IDs before implementation-sensitive use; use answer only for quick cited synthesis.",
      theme,
    ),
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
  const action = details.action === "explain" ? "explain" : "answer";
  const lines = cardHeader(action, details, theme, "ok");
  lines.push(...lineageSection(details, action, theme));
  lines.push(
    ...sectionBlock(
      "2",
      opts.expanded ? "Answer" : "Answer preview",
      [
        fact(
          "✅",
          "Sources",
          `${citations.length} citation${citations.length === 1 ? "" : "s"}`,
          theme,
        ),
        fact("👁", "Density", density, theme),
        "",
        visibleAnswer,
        !opts.expanded && answer.length > visibleAnswer.length
          ? dim("…answer truncated in human view; expand for full bounded answer.", theme)
          : "",
      ].filter(Boolean),
      theme,
    ),
  );
  if (citations.length) {
    lines.push(
      ...sectionBlock(
        "3",
        "Citations",
        citations.slice(0, 12).flatMap((citation, index) => citationLines(citation, index, theme)),
        theme,
      ),
    );
  }
  lines.push(
    ...nextSection("Open citations or fetch source IDs when implementation details matter.", theme),
  );
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
  const lines = cardHeader("fetch", details, theme, "ok");
  lines.push(...lineageSection(details, "fetch", theme));
  lines.push(
    ...sectionBlock(
      "2",
      "Evidence packet",
      [
        fact("📄", "Documents", String(documents.length), theme),
        fact(
          "📦",
          "LLM packet",
          `${formatChars(returnedChars)} bounded source${maxTotalChars ? ` · cap ${formatChars(maxTotalChars)}` : ""}`,
          theme,
        ),
        fact("👁", "Density", density, theme),
        totalContentChars
          ? fact("📚", "Source", `${formatChars(totalContentChars)} fetched`, theme)
          : "",
        truncatedDocuments || metadataOnlyDocuments
          ? fact(
              "⚠",
              "Truncation",
              [
                truncatedDocuments
                  ? `${truncatedDocuments} doc${truncatedDocuments === 1 ? "" : "s"} clipped`
                  : "",
                metadataOnlyDocuments
                  ? `${metadataOnlyDocuments} metadata-only after packet cap`
                  : "",
              ]
                .filter(Boolean)
                .join(" · "),
              theme,
            )
          : "",
      ].filter(Boolean),
      theme,
    ),
  );
  lines.push(
    ...sectionBlock(
      "3",
      "Document evidence",
      visibleDocs.flatMap((doc, index) =>
        documentLines(doc, index, previewChars, opts.expanded, density, theme),
      ),
      theme,
    ),
  );
  if (!opts.expanded && documents.length > visibleDocs.length) {
    lines.push(
      dim(`+${documents.length - visibleDocs.length} more document(s). Expand for cards.`, theme),
    );
  }
  lines.push(
    ...nextSection(
      "LLM received the bounded Docs Evidence Packet. Expand for previews; open URLs for full source.",
      theme,
    ),
  );
  return clipText(lines.join("\n").trimEnd(), budget.expandedVisibleChars);
}

export function formatCollections(details: Record<string, unknown>, theme?: Theme): string {
  const collections = asArray<DocsCollection>(details.collections);
  const summaries = asArray<Record<string, string>>(details.capabilitySummaries);
  const profiles = asArray<Record<string, string>>(details.collectionProfiles);
  const lines = cardHeader("collections", details, theme, "ok");
  lines.push(
    ...sectionBlock(
      "1",
      "Catalog lineage",
      [
        fact("📚", "Collections", String(collections.length), theme),
        details.cache ? fact("🗄", "Cache", String(details.cache), theme) : "",
        details.collectionAlias ? fact("↪", "Alias", String(details.collectionAlias), theme) : "",
        details.displayDensity ? fact("👁", "Density", displayDensity(details), theme) : "",
      ].filter(Boolean),
      theme,
    ),
  );
  lines.push(
    ...sectionBlock(
      "2",
      "Collection capabilities",
      collections.flatMap((collection) => collectionLines(collection, summaries, profiles, theme)),
      theme,
    ),
  );
  lines.push(
    ...nextSection(
      "Use the collection profile before choosing non-default slices or filters.",
      theme,
    ),
  );
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

function formatLoading(theme?: Theme): string {
  return [
    headerLine("loading", undefined, theme, "warn"),
    rule(theme),
    `${accent("⏳ Working", theme)}  ${dim("Waiting for the Salesforce Docs service…", theme)}`,
  ].join("\n");
}

function formatFailure(
  action: string,
  details: Record<string, unknown>,
  text: string,
  theme?: Theme,
): string {
  const lines = cardHeader(action, details, theme, "error", "blocked");
  lines.push(...lineageSection(details, action, theme));
  lines.push(
    ...sectionBlock(
      "2",
      "Evidence gate",
      [
        fact("✗", "Status", String(details.retrieval_status ?? details.reason ?? "failed"), theme),
        text || "SF Docs failed.",
      ],
      theme,
    ),
  );
  const recover = isRecord(details.recover_via) ? JSON.stringify(details.recover_via) : "";
  lines.push(
    ...nextSection(
      recover
        ? `Recover via ${recover}`
        : "Inspect the query plan, adjust the slice, or retry with a narrower query.",
      theme,
    ),
  );
  return lines.join("\n");
}

function formatSimple(
  action: string,
  details: Record<string, unknown>,
  text: string,
  theme?: Theme,
): string {
  const lines = cardHeader(action, details, theme, "ok");
  lines.push(...lineageSection(details, action, theme));
  if (text) lines.push(...sectionBlock("2", "Result", [text], theme));
  return lines.join("\n");
}

function cardHeader(
  action: string,
  details: Record<string, unknown>,
  theme?: Theme,
  status: "ok" | "warn" | "error" = "ok",
  suffix?: string,
): string[] {
  return [headerLine(action, details, theme, status, suffix), rule(theme)];
}

function headerLine(
  action: string,
  details?: Record<string, unknown>,
  theme?: Theme,
  status: "ok" | "warn" | "error" = "ok",
  suffix?: string,
): string {
  const statusIcon = status === "error" ? "⛔" : status === "warn" ? "⚠" : "📚";
  const label = `SF Docs · ${action}${suffix ? ` ${suffix}` : ""}`;
  const sliceText = details ? slice(details) : "";
  const title = theme
    ? theme.fg("toolTitle", theme.bold(`${statusIcon} ${label}`))
    : `**${statusIcon} ${label}**`;
  return sliceText ? `${title}  ${dim(sliceText, theme)}` : title;
}

function lineageSection(details: Record<string, unknown>, action: string, theme?: Theme): string[] {
  const plan = isRecord(details.queryPlan) ? details.queryPlan : undefined;
  const requested = isRecord(details.requested) ? details.requested : undefined;
  const rows = [
    fact("🔎", "Original", originalLabel(details, requested, action), theme),
    plan?.intent ? fact("🧭", "Intent", String(plan.intent), theme) : "",
    plan?.collectionOverride && isRecord(plan.collectionOverride)
      ? fact(
          "↪",
          "Override",
          `${plan.collectionOverride.from ?? "?"} → ${plan.collectionOverride.to ?? "?"} (${plan.collectionOverride.reason ?? "routing"})`,
          theme,
        )
      : details.collectionOverride && isRecord(details.collectionOverride)
        ? fact(
            "↪",
            "Override",
            `${details.collectionOverride.from ?? "?"} → ${details.collectionOverride.to ?? "?"} (${details.collectionOverride.reason ?? "routing"})`,
            theme,
          )
        : "",
    plan?.reason ? fact("💬", "Reason", String(plan.reason), theme) : "",
    plan?.compiledQuery
      ? fact("⚙", "Compiled", String(plan.compiledQuery), theme)
      : details.compiledQuery
        ? fact("⚙", "Compiled", String(details.compiledQuery), theme)
        : "",
    fact("🗂", "Slice", slice(details), theme),
    ...evidenceRows(plan, theme),
  ].filter(Boolean);
  return sectionBlock("1", "Lineage", rows, theme);
}

function evidenceRows(plan: Record<string, unknown> | undefined, theme?: Theme): string[] {
  if (!plan) return [];
  const filters = [asArray<string>(plan.filters), asArray<string>(plan.boosts)].flat();
  return [
    filters.length ? fact("🎚", "Filters", filters.join(" "), theme) : "",
    plan.evidenceStatus
      ? fact(
          evidenceIcon(String(plan.evidenceStatus)),
          "Evidence",
          `${plan.evidenceStatus}${plan.evidenceMessage ? ` — ${plan.evidenceMessage}` : ""}`,
          theme,
        )
      : "",
  ].filter(Boolean);
}

function sectionBlock(index: string, title: string, body: string[], theme?: Theme): string[] {
  const cleaned = body.filter((line) => line !== undefined && line !== null);
  if (!cleaned.length) return [];
  return ["", sectionTitle(index, title, theme), ...cleaned];
}

function nextSection(message: string, theme?: Theme): string[] {
  return sectionBlock("→", "Next", [`💡 ${dim(message, theme)}`], theme);
}

function searchResultLines(
  result: DocsSearchResult,
  index: number,
  snippetChars: number,
  theme?: Theme,
  expanded?: boolean,
): string[] {
  const lines = [
    `  ${index + 1}. ${strong(result.title ?? "Untitled", theme)} ${dim(result.product ? `· ${result.product}` : "", theme)}`,
  ];
  if (result.url) lines.push(`     🔗 ${link(result.url, theme)}`);
  if (result.id) lines.push(`     🆔 ${code(expanded ? result.id : shortId(result.id), theme)}`);
  const metadata = resultMetadataLine(result);
  if (metadata) lines.push(dim(`     🏷 ${metadata}`, theme));
  const snippet = searchSnippet(result, snippetChars);
  if (snippet) lines.push(`     ${dim(`Snippet: ${snippet}`, theme)}`);
  return lines;
}

function citationLines(citation: DocsCitation, index: number, theme?: Theme): string[] {
  const lines = [`  ${index + 1}. ${strong(citation.title ?? "Untitled", theme)}`];
  if (citation.url) lines.push(`     ${link(citation.url, theme)}`);
  const metadata = resultMetadataLine(citation);
  if (metadata) lines.push(dim(`     🏷 ${metadata}`, theme));
  return lines;
}

function documentLines(
  doc: FetchRenderDocument,
  index: number,
  previewChars: number,
  expanded: boolean | undefined,
  density: SfDocsDisplayDensity,
  theme?: Theme,
): string[] {
  const title = `${index + 1}. ${doc.title ?? doc.id ?? doc.url ?? "Document"}`;
  const status = doc.error ? "error" : doc.llmTruncated ? "clipped" : "ok";
  const lines = [`  📄 ${strong(title, theme)} ${dim(status, theme)}`];
  if (doc.url) lines.push(`     🔗 ${link(doc.url, theme)}`);
  if (doc.id) lines.push(`     🆔 ${code(expanded ? doc.id : shortId(doc.id), theme)}`);
  const metadata = fetchMetadataLine(doc, expanded || density === "verbose");
  if (metadata) lines.push(dim(`     🏷 ${metadata}`, theme));
  if (doc.error) lines.push(`     ⚠ ${doc.error}`);
  lines.push(
    dim(
      `     Source: ${formatChars(doc.contentChars ?? textLength(doc.content))} fetched · ${formatChars(doc.llmReturnedChars ?? textLength(doc.content))} sent to LLM${doc.llmTruncated ? " · clipped" : ""}${doc.metadataOnly ? " · metadata-only" : ""}`,
      theme,
    ),
  );
  const headings = asArray<string>(doc.headings).slice(0, expanded ? 5 : 3);
  if (headings.length) lines.push(dim(`     Headings: ${headings.join(" › ")}`, theme));
  const preview = fetchPreview(doc, previewChars);
  if (preview) lines.push(dim("     Preview:", theme), indent(preview, "     "));
  else if (!expanded && previewChars === 0) {
    lines.push(dim("     Preview hidden at compact density; expand for a bounded preview.", theme));
  }
  return [...lines, ""];
}

function collectionLines(
  collection: DocsCollection,
  summaries: Array<Record<string, string>>,
  profiles: Array<Record<string, string>>,
  theme?: Theme,
): string[] {
  const summary = summaries.find((item) => item.collection === collection.collection);
  const profile = profiles.find((item) => item.collection === collection.collection);
  const versions = (collection.versions ?? []).join(",") || "-";
  const locales = formatCount(collection.locales);
  const formats = (collection.formats ?? []).join(",") || "-";
  const lines = [
    `${accent(collection.collection, theme)} ${dim(`${versions} · ${locales} · ${formats}`, theme)}`,
  ];
  if (profile?.coverage) lines.push(dim(`  🧭 owns ${profile.coverage}`, theme));
  if (profile?.releaseNotes) lines.push(dim(`  🕘 release notes ${profile.releaseNotes}`, theme));
  if (profile?.references) lines.push(dim(`  📖 reference ${profile.references}`, theme));
  if (summary?.keyFilters) lines.push(dim(`  🔍 filters ${summary.keyFilters}`, theme));
  if (summary?.landmarks) lines.push(dim(`  🗺 landmarks ${summary.landmarks}`, theme));
  if (summary?.extraFields) lines.push(dim(`  🧩 extra ${summary.extraFields}`, theme));
  return [...lines, ""];
}

function originalLabel(
  details: Record<string, unknown>,
  requested: Record<string, unknown> | undefined,
  action: string,
): string {
  if (typeof details.query === "string" && details.query.trim()) return details.query;
  const ids = asArray<string>(requested?.ids);
  const urls = asArray<string>(requested?.urls);
  if (ids.length) return `${ids.length} id${ids.length === 1 ? "" : "s"}`;
  if (urls.length) return `${urls.length} url${urls.length === 1 ? "" : "s"}`;
  if (action === "collections") return "collection catalog";
  return action;
}

function fact(icon: string, label: string, value: string, theme?: Theme): string {
  return `  ${icon} ${code(pad(label, 12), theme)} ${value}`;
}

function rule(theme?: Theme): string {
  return dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", theme);
}

function sectionTitle(index: string, title: string, theme?: Theme): string {
  return accent(index === "→" ? `→ ${title}` : `${index}. ${title}`, theme);
}

function accent(value: string, theme?: Theme): string {
  return theme ? theme.fg("accent", theme.bold(value)) : `**${value}**`;
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

function indent(value: string, prefix: string): string {
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
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

function resultMetadataLine(result: DocsSearchResult): string {
  return [
    result.release !== undefined ? `release ${String(result.release)}` : "",
    result.product ? `product ${result.product}` : "",
    result.guides ? `guides ${result.guides}` : "",
    result.filename ? `file ${result.filename}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function fetchMetadataLine(doc: FetchRenderDocument, includeDebugMetadata: boolean): string {
  const parts = [
    doc.release !== undefined ? `release ${String(doc.release)}` : "",
    doc.product ? `product ${doc.product}` : "",
    doc.guides ? `guides ${doc.guides}` : "",
    doc.filename ? `file ${doc.filename}` : "",
    doc.sourcePath ? `sourcePath ${doc.sourcePath}` : "",
    doc.baseUrl ? `baseUrl ${doc.baseUrl}` : "",
    includeDebugMetadata && doc.contentHash ? `contentHash ${shortId(doc.contentHash)}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "";
}

function evidenceIcon(status: string): string {
  if (status === "ok") return "✅";
  if (status === "coverage_gap" || status === "not_release_note_evidence") return "⛔";
  if (status === "wrong_release" || status === "insufficient") return "⚠";
  return "🧪";
}

function formatCount(values?: unknown[]): string {
  if (!values?.length) return "-";
  return values.length <= 3
    ? values.join(",")
    : `${values.slice(0, 3).join(",")} +${values.length - 3}`;
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
