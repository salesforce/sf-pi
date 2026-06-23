/* SPDX-License-Identifier: Apache-2.0 */
/** Human-polished and LLM-bounded formatting for SF Docs. */
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { DocsCitation, DocsCollection, DocsDocument, DocsSearchResult } from "./types.ts";

export function renderToolCall(
  args: { action?: string; query?: string; collection?: string },
  theme: Theme,
): Text {
  const bits = [args.action ?? "status"];
  if (args.collection) bits.push(args.collection);
  if (args.query) bits.push(`"${clipLine(args.query, 60)}"`);
  return new Text(
    theme.fg("toolTitle", theme.bold("📚 SF Docs ")) + theme.fg("muted", bits.join(" · ")),
    0,
    0,
  );
}

export function renderToolResult(
  result: { details?: Record<string, unknown>; content?: unknown[] },
  opts: { isPartial?: boolean },
  theme: Theme,
): Text {
  if (opts.isPartial) return new Text(theme.fg("warning", "📚 SF Docs · loading…"), 0, 0);
  const details = result.details ?? {};
  if (details.ok === false) {
    return new Text(theme.fg("error", `✗ ${firstText(result.content) || "SF Docs failed"}`), 0, 0);
  }
  const action = String(details.action ?? "status");
  if (action === "search") return new Text(formatSearch(details, theme), 0, 0);
  if (action === "answer") return new Text(formatAnswer(details, theme), 0, 0);
  if (action === "fetch") return new Text(formatFetch(details, theme), 0, 0);
  if (action === "collections") return new Text(formatCollections(details, theme), 0, 0);
  return new Text(firstText(result.content), 0, 0);
}

export function formatSearch(details: Record<string, unknown>, theme?: Theme): string {
  const results = asArray<DocsSearchResult>(details.results);
  const total = typeof details.totalCount === "number" ? details.totalCount : results.length;
  const lines = [
    header("📚", `SF Docs search · ${slice(details)}`, theme),
    row("🔎", "Query", String(details.query ?? ""), theme),
    row(
      "✅",
      "Results",
      `${results.length}${total !== results.length ? ` of ${total}` : ""}`,
      theme,
    ),
    "",
  ];
  results.slice(0, 10).forEach((result, index) => {
    lines.push(
      `  ${index + 1}. ${strong(result.title ?? "Untitled", theme)} ${dim(result.product ? `· ${result.product}` : "", theme)}`,
    );
    if (result.url) lines.push(`     🔗 ${link(result.url, theme)}`);
    if (result.id) lines.push(`     🆔 ${code(shortId(result.id), theme)}`);
  });
  lines.push("");
  lines.push(
    dim("💡 Next: fetch result ids for source text; use answer for quick cited synthesis.", theme),
  );
  return lines.join("\n");
}

export function formatAnswer(details: Record<string, unknown>, theme?: Theme): string {
  const citations = asArray<DocsCitation>(details.citations);
  const lines = [
    header("📚", `SF Docs answer · ${slice(details)}`, theme),
    row("✅", "Sources", `${citations.length} citation${citations.length === 1 ? "" : "s"}`, theme),
    "",
    section("🧾", "Answer", theme),
    String(details.answer ?? "(no answer)"),
  ];
  if (citations.length) {
    lines.push("", section("📎", "Citations", theme));
    citations.slice(0, 12).forEach((citation, index) => {
      lines.push(`  ${index + 1}. ${strong(citation.title ?? "Untitled", theme)}`);
      if (citation.url) lines.push(`     ${link(citation.url, theme)}`);
    });
  }
  return lines.join("\n");
}

export function formatFetch(details: Record<string, unknown>, theme?: Theme): string {
  const documents = asArray<DocsDocument>(details.documents);
  const lines = [
    header("📚", `SF Docs fetch · ${slice(details)}`, theme),
    row("📄", "Documents", String(documents.length), theme),
    "",
  ];
  for (const doc of documents.slice(0, 4)) {
    lines.push(section("📄", doc.title ?? doc.id ?? doc.url ?? "Document", theme));
    if (doc.url) lines.push(`🔗 ${link(doc.url, theme)}`);
    if (doc.error) lines.push(`⚠ ${doc.error}`);
    if (doc.content) lines.push(clipText(doc.content, 12000));
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function formatCollections(details: Record<string, unknown>, theme?: Theme): string {
  const collections = asArray<DocsCollection>(details.collections);
  const lines = [header("📚", "SF Docs collections", theme)];
  if (details.cache) lines.push(row("🗄", "Cache", String(details.cache), theme));
  lines.push("");
  const nameW = Math.max(10, ...collections.map((c) => visibleWidth(c.collection)));
  lines.push(
    `  ${dim(pad("Collection", nameW), theme)}  ${dim("Versions", theme)}  ${dim("Locales", theme)}  ${dim("Formats", theme)}`,
  );
  for (const c of collections) {
    lines.push(
      `  ${code(pad(c.collection, nameW), theme)}  ${dim((c.versions ?? []).join(",") || "-", theme)}  ${dim(formatCount(c.locales), theme)}  ${dim((c.formats ?? []).join(",") || "-", theme)}`,
    );
  }
  return lines.join("\n");
}

export function clipLine(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

export function clipText(value: string, max: number): string {
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

function slice(details: Record<string, unknown>): string {
  return `${details.collection ?? "?"}/${details.version ?? "current"}/${details.locale ?? "en-us"}`;
}
