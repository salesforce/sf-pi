/* SPDX-License-Identifier: Apache-2.0 */
/** Documented Salesforce Docs action payloads and strict response validation. */
import type { DocsCitation, DocsCollection, DocsDocument, DocsSearchResult } from "./types.ts";

export class DocsProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocsProtocolError";
  }
}

export type DocsFormat = "text" | "markdown" | "html";

export interface DocsRemoteSlice {
  collection: string;
  version: string;
  locale?: string;
}

export interface SearchRequest extends DocsRemoteSlice {
  query: string;
  page: number;
  pageSize: number;
  format?: DocsFormat;
}

export interface FetchRequest extends DocsRemoteSlice {
  ids?: string[];
  urls?: string[];
  format: DocsFormat;
}

export interface AnswerRequest extends DocsRemoteSlice {
  query: string;
  cite: true;
}

export interface ExplainRequest {
  query: string;
  id?: string;
  url?: string;
  cite: true;
}

export function buildSearchRequest(input: SearchRequest): Record<string, unknown> {
  return remoteArgs(input);
}

export function buildFetchRequest(input: FetchRequest): Record<string, unknown> {
  return remoteArgs(input);
}

export function buildAnswerRequest(input: AnswerRequest): Record<string, unknown> {
  return remoteArgs(input);
}

export function buildExplainRequest(input: ExplainRequest): Record<string, unknown> {
  return { ...input };
}

export interface DocsServiceResponse {
  error?: string;
  requested?: Record<string, unknown>;
  available?: unknown;
  [key: string]: unknown;
}

export interface ListResponse extends DocsServiceResponse {
  collections?: DocsCollection[];
}

export interface SearchResponse extends DocsServiceResponse {
  results?: DocsSearchResult[];
  totalCount?: number;
}

export interface FetchResponse extends DocsServiceResponse {
  documents?: DocsDocument[];
}

export interface AnswerResponse extends DocsServiceResponse {
  answer?: string;
  explanation?: string;
  citations?: DocsCitation[];
}

export function parseListResponse(value: unknown): ListResponse {
  const response = responseRecord("list", value);
  if (hasServiceError(response)) return response;
  if (!Array.isArray(response.collections) || !response.collections.every(isCollection)) {
    throw new DocsProtocolError("SF Docs list response requires a collections array.");
  }
  return response as ListResponse;
}

export function parseSearchResponse(value: unknown): SearchResponse {
  const response = responseRecord("search", value);
  if (hasServiceError(response)) return response;
  if (!Array.isArray(response.results) || !response.results.every(isRecord)) {
    throw new DocsProtocolError("SF Docs search response requires a results array.");
  }
  if (response.totalCount !== undefined && typeof response.totalCount !== "number") {
    throw new DocsProtocolError("SF Docs search totalCount must be a number when present.");
  }
  return response as SearchResponse;
}

export function parseFetchResponse(value: unknown): FetchResponse {
  const response = responseRecord("fetch", value);
  if (hasServiceError(response)) return response;
  if (!Array.isArray(response.documents) || !response.documents.every(isRecord)) {
    throw new DocsProtocolError("SF Docs fetch response requires a documents array.");
  }
  return response as FetchResponse;
}

export function parseAnswerResponse(action: "answer" | "explain", value: unknown): AnswerResponse {
  const response = responseRecord(action, value);
  if (hasServiceError(response)) return response;
  if (action === "answer") {
    if (typeof response.answer !== "string" || !response.answer.trim()) {
      throw new DocsProtocolError("SF Docs answer response requires a non-empty answer.");
    }
  } else {
    const answer = typeof response.answer === "string" ? response.answer.trim() : "";
    const explanation = typeof response.explanation === "string" ? response.explanation.trim() : "";
    if (!answer && !explanation) {
      throw new DocsProtocolError(
        "SF Docs explain response requires a non-empty answer or explanation.",
      );
    }
  }
  if (!Array.isArray(response.citations) || !response.citations.every(isRecord)) {
    throw new DocsProtocolError(`SF Docs ${action} response requires a citations array.`);
  }
  return response as AnswerResponse;
}

function remoteArgs<T extends { locale?: string }>(args: T): Record<string, unknown> {
  const result: Record<string, unknown> = { ...args };
  if (args.locale === "auto") delete result.locale;
  return result;
}

function responseRecord(action: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DocsProtocolError(`SF Docs ${action} response must be an object.`);
  }
  return value;
}

function hasServiceError(value: Record<string, unknown>): value is Record<string, unknown> & {
  error: string;
} {
  if (value.error === undefined) return false;
  if (typeof value.error !== "string" || !value.error.trim()) {
    throw new DocsProtocolError("SF Docs service error must be a non-empty string.");
  }
  return true;
}

function isCollection(value: unknown): value is DocsCollection {
  return (
    isRecord(value) && typeof value.collection === "string" && Boolean(value.collection.trim())
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
