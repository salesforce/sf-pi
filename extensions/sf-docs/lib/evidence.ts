/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded model-facing evidence and deterministic fetch completeness. */
import type { AnswerResponse } from "./protocol.ts";
import type { DocsCitation, DocsDocument } from "./types.ts";

const FETCH_PER_DOCUMENT_CHAR_LIMIT = 12000;
const FETCH_TOTAL_CHAR_LIMIT = 48000;
export const EVIDENCE_PREVIEW_CHAR_LIMIT = 1600;
const ANSWER_CHAR_LIMIT = 16000;
const ANSWER_CITATION_LIMIT = 12;
const CITATION_TITLE_CHAR_LIMIT = 300;
const CITATION_URL_CHAR_LIMIT = 2000;

export type FetchRetrievalStatus = "complete" | "partial" | "failed";
export type FetchContentStatus = "complete" | "truncated";

export interface FetchOutcome {
  retrievalStatus: FetchRetrievalStatus;
  usableDocuments: number;
}

export interface FetchEvidenceDocument {
  id?: string;
  url?: string;
  title: string;
  description?: string;
  product?: string;
  products?: string;
  guides?: string;
  filename?: string;
  sourcePath?: string;
  baseUrl?: string;
  release?: string | number;
  taxonomyIds?: string | string[];
  contentHash?: string;
  status: "ok" | "error";
  error?: string;
  available?: string;
  contentChars: number;
  llmReturnedChars: number;
  llmTruncated: boolean;
  metadataOnly: boolean;
  headings: string[];
  humanPreview: string;
}

export interface FetchEvidencePacket {
  text: string;
  documents: FetchEvidenceDocument[];
  totalContentChars: number;
  llmBudget: {
    perDocumentChars: number;
    maxTotalChars: number;
    returnedChars: number;
    truncatedDocuments: number;
    metadataOnlyDocuments: number;
  };
}

export interface AnswerEvidencePacket {
  text: string;
  details: Record<string, unknown>;
  answerChars: number;
  answerReturnedChars: number;
  answerTruncated: boolean;
  citationsTruncated: boolean;
}

export function classifyFetchDocuments(docs: DocsDocument[], requestedCount: number): FetchOutcome {
  const usableDocuments = docs.filter(
    (doc) => !doc.error && typeof doc.content === "string" && Boolean(doc.content.trim()),
  ).length;
  if (usableDocuments === 0) return { retrievalStatus: "failed", usableDocuments };
  const complete = usableDocuments === requestedCount && docs.length === requestedCount;
  return {
    retrievalStatus: complete ? "complete" : "partial",
    usableDocuments,
  };
}

export function fetchContentStatus(packet: FetchEvidencePacket): FetchContentStatus {
  return packet.llmBudget.truncatedDocuments > 0 || packet.llmBudget.metadataOnlyDocuments > 0
    ? "truncated"
    : "complete";
}

export function formatFetchOutcome(
  retrievalStatus: FetchRetrievalStatus,
  contentStatus: FetchContentStatus,
): string {
  return `Fetch outcome: retrieval=${retrievalStatus}; content=${contentStatus}.`;
}

export function buildFetchEvidencePacket(
  docs: DocsDocument[],
  slice: { collection: string; version: string; locale: string },
): FetchEvidencePacket {
  let remaining = FETCH_TOTAL_CHAR_LIMIT;
  let returnedChars = 0;
  const documents: FetchEvidenceDocument[] = [];
  const bodyLines = [
    `SF Docs fetch returned ${docs.length} document(s) for ${slice.collection}/${slice.version}/${slice.locale}.`,
    `LLM source budget: ${FETCH_PER_DOCUMENT_CHAR_LIMIT} chars per document; ${FETCH_TOTAL_CHAR_LIMIT} chars total.`,
    "",
  ];

  docs.forEach((doc, index) => {
    const title = doc.title ?? doc.id ?? doc.url ?? "Document";
    const source = doc.content ?? "";
    const contentChars = source.length;
    const allowed = doc.error ? 0 : Math.max(0, Math.min(remaining, FETCH_PER_DOCUMENT_CHAR_LIMIT));
    const body = allowed > 0 ? source.slice(0, allowed) : "";
    const metadataOnly = !doc.error && contentChars > 0 && body.length === 0;
    const llmTruncated = !doc.error && body.length < contentChars;
    remaining -= body.length;
    returnedChars += body.length;

    documents.push({
      id: doc.id,
      url: doc.url,
      title,
      description: typeof doc.description === "string" ? doc.description : undefined,
      product: typeof doc.product === "string" ? doc.product : undefined,
      products: typeof doc.products === "string" ? doc.products : undefined,
      guides: typeof doc.guides === "string" ? doc.guides : undefined,
      filename: typeof doc.filename === "string" ? doc.filename : undefined,
      sourcePath: typeof doc.sourcePath === "string" ? doc.sourcePath : undefined,
      baseUrl: typeof doc.baseUrl === "string" ? doc.baseUrl : undefined,
      release:
        typeof doc.release === "string" || typeof doc.release === "number"
          ? doc.release
          : undefined,
      taxonomyIds: normalizeTaxonomyIds(doc.taxonomyIds),
      contentHash: typeof doc.contentHash === "string" ? doc.contentHash : undefined,
      status: doc.error ? "error" : "ok",
      error: doc.error,
      available: structuredPreview(doc.available, EVIDENCE_PREVIEW_CHAR_LIMIT),
      contentChars,
      llmReturnedChars: body.length,
      llmTruncated,
      metadataOnly,
      headings: extractHeadings(source),
      humanPreview: previewText(source, EVIDENCE_PREVIEW_CHAR_LIMIT),
    });

    bodyLines.push(
      `<document ${documentAttributes(doc, {
        index: index + 1,
        title,
        contentChars,
        returnedChars: body.length,
        truncated: llmTruncated,
        metadataOnly,
        status: doc.error ? "error" : "ok",
        locale: slice.locale,
      })}>`,
    );
    if (doc.url) bodyLines.push(`Source URL: ${doc.url}`);
    const description = previewPlainText(
      typeof doc.description === "string" ? doc.description : "",
      500,
    );
    if (description) bodyLines.push(`Description: ${description}`);
    if (doc.error) {
      bodyLines.push(`Error: ${doc.error}`);
      const available = structuredPreview(doc.available, EVIDENCE_PREVIEW_CHAR_LIMIT);
      if (available) bodyLines.push(`Available: ${available}`);
    } else if (body) {
      bodyLines.push(body);
    } else if (metadataOnly) {
      bodyLines.push(
        "[No body text included because the global Docs Evidence Packet budget was exhausted.]",
      );
    }
    bodyLines.push("</document>", "");
  });

  const truncatedDocuments = documents.filter((doc) => doc.llmTruncated).length;
  const metadataOnlyDocuments = documents.filter((doc) => doc.metadataOnly).length;
  return {
    text: bodyLines.join("\n").trimEnd(),
    documents,
    totalContentChars: documents.reduce((sum, doc) => sum + doc.contentChars, 0),
    llmBudget: {
      perDocumentChars: FETCH_PER_DOCUMENT_CHAR_LIMIT,
      maxTotalChars: FETCH_TOTAL_CHAR_LIMIT,
      returnedChars,
      truncatedDocuments,
      metadataOnlyDocuments,
    },
  };
}

export function buildAnswerEvidencePacket(
  action: "answer" | "explain",
  response: AnswerResponse,
): AnswerEvidencePacket {
  const source = response.answer ?? response.explanation ?? "";
  const answer = source.slice(0, ANSWER_CHAR_LIMIT);
  const answerTruncated = answer.length < source.length;
  const citations = (response.citations ?? []).slice(0, ANSWER_CITATION_LIMIT).map(boundedCitation);
  const citationsTruncated = citations.length < (response.citations?.length ?? 0);
  const field = action === "explain" && !response.answer ? "explanation" : "answer";
  const answerText = answerTruncated
    ? `${answer}\n\n[SF Docs ${field} truncated after ${ANSWER_CHAR_LIMIT} characters.]`
    : answer;
  const citationText = citations
    .map((citation, index) => `${index + 1}. ${citation.title}\n   ${citation.url ?? ""}`)
    .join("\n");
  const citationNote = citationsTruncated
    ? `\n\n[SF Docs citations truncated after ${ANSWER_CITATION_LIMIT} sources.]`
    : "";
  return {
    text: citationText ? `${answerText}\n\nCitations:\n${citationText}${citationNote}` : answerText,
    details: {
      [field]: answer,
      citations,
    },
    answerChars: source.length,
    answerReturnedChars: answer.length,
    answerTruncated,
    citationsTruncated,
  };
}

export function previewPlainText(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function structuredPreview(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return undefined;
  }
}

function extractHeadings(value: string): string[] {
  const markdownHeadings = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^#{1,4}\s+\S/.test(line))
    .map((line) => line.replace(/^#{1,4}\s+/, "").trim());
  const htmlHeadings = Array.from(value.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/giu)).map(
    (match) => stripHtml(String(match[1] ?? "")).trim(),
  );
  return [...markdownHeadings, ...htmlHeadings].filter(Boolean).slice(0, 5);
}

function previewText(value: string, max: number): string {
  return stripHtml(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function stripHtml(value: string): string {
  const withoutBlocks = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/giu, " ");
  return decodeHtmlEntities(withoutBlocks.replace(/<[^>]+>/gu, " "));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function documentAttributes(
  doc: DocsDocument,
  base: {
    index: number;
    title: string;
    contentChars: number;
    returnedChars: number;
    truncated: boolean;
    metadataOnly: boolean;
    status: "ok" | "error";
    locale: string;
  },
): string {
  const attributes: Array<[string, string | number | boolean | undefined]> = [
    ["index", base.index],
    ["id", doc.id],
    ["title", base.title],
    ["url", doc.url],
    ["filename", doc.filename],
    ["sourcePath", doc.sourcePath],
    ["baseUrl", doc.baseUrl],
    ["locale", doc.locale ?? base.locale],
    ["product", doc.product],
    ["products", doc.products],
    ["guides", doc.guides],
    ["release", doc.release],
    ["contentChars", base.contentChars],
    ["returnedChars", base.returnedChars],
    ["truncated", base.truncated],
    ["metadataOnly", base.metadataOnly],
    ["status", base.status],
  ];
  return attributes
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}="${escapeAttribute(String(value))}"`)
    .join(" ");
}

function normalizeTaxonomyIds(value: unknown): string | string[] | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return undefined;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function boundedCitation(citation: DocsCitation): DocsCitation {
  return {
    id: citation.id,
    title: (citation.title ?? "Untitled").slice(0, CITATION_TITLE_CHAR_LIMIT),
    url: citation.url?.slice(0, CITATION_URL_CHAR_LIMIT),
    collection: citation.collection,
    version: citation.version,
    locale: citation.locale,
    product: citation.product,
    guides: citation.guides,
    release: citation.release,
  };
}
