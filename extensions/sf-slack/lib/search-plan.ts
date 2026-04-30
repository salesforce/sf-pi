/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Slack search query planner.
 *
 * Converts structured research intent into Slack search syntax. The planner is
 * deliberately deterministic: it chooses operators, normalizes dates, and
 * builds fallback queries so the LLM does not have to manually recover from
 * every zero-result search.
 */
import type { ResolvedUser, SlackSearchPlan } from "./types.ts";
import { resolveChannel, resolveUser } from "./resolve.ts";

export interface SlackSearchPlanOptions {
  resolved?: SlackSearchPlan["resolved"];
}

export interface SlackResearchInput {
  task?: "search" | "summarize" | "summarize_channel" | "find_threads";
  query: string;
  channel_ref?: string;
  from_ref?: string;
  with_ref?: string;
  exact_phrases?: string[];
  exclude_terms?: string[];
  content_filters?: Array<"link" | "pin" | "file" | "reaction">;
  reaction_names?: string[];
  since?: string;
  before?: string;
  during?: string;
  thread_only?: boolean;
  include_threads?: boolean;
  strategy?: "strict_then_broaden" | "broad" | "thread_first" | "artifact_first";
  fields?: "summary" | "preview" | "full";
  limit?: number;
  max_queries?: number;
}

interface QueryParts {
  terms: string[];
  exactPhrases: string[];
  channelName?: string;
  fromHandle?: string;
  withDisplayName?: string;
  after?: string;
  before?: string;
  during?: string;
  threadOnly?: boolean;
  contentFilters: string[];
  reactionNames: string[];
  excludeTerms: string[];
}

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "about",
  "can",
  "could",
  "find",
  "for",
  "from",
  "get",
  "give",
  "i",
  "in",
  "into",
  "me",
  "my",
  "of",
  "on",
  "please",
  "pull",
  "show",
  "since",
  "slack",
  "summarize",
  "summary",
  "the",
  "this",
  "to",
  "what",
  "when",
  "with",
]);

export async function buildSlackSearchPlan(
  token: string,
  input: SlackResearchInput,
  signal?: AbortSignal,
  options: SlackSearchPlanOptions = {},
): Promise<SlackSearchPlan> {
  const explanation: string[] = [];
  const resolved: SlackSearchPlan["resolved"] = { ...(options.resolved || {}) };

  if (input.channel_ref && !resolved.channel) {
    const channel = await resolveChannel(token, input.channel_ref, signal, { limit: 5 });
    if (channel.best) {
      resolved.channel = channel.best;
      explanation.push(
        `Resolved channel "${input.channel_ref}" → #${channel.best.name} (${channel.best.confidence.toFixed(2)}).`,
      );
    } else {
      explanation.push(`Could not resolve channel "${input.channel_ref}"; omitting in:#channel.`);
    }
  }

  if (input.from_ref) {
    if (input.from_ref.trim().toLowerCase() === "me") {
      resolved.fromUser = { handle: "me", displayName: "me" };
      explanation.push("Using from:me for current user's messages.");
    } else {
      const fromUser = await resolveUser(token, input.from_ref, signal, { limit: 5 });
      if (fromUser.best) {
        resolved.fromUser = fromUser.best;
        explanation.push(
          `Resolved author "${input.from_ref}" → from:${fromUser.best.handle} (${fromUser.best.confidence.toFixed(2)}).`,
        );
      } else {
        explanation.push(`Could not resolve author "${input.from_ref}"; omitting from: operator.`);
      }
    }
  }

  if (input.with_ref) {
    const withUser = await resolveUser(token, input.with_ref, signal, { limit: 5 });
    if (withUser.best && withUser.best.id !== "me") {
      resolved.withUser = withUser.best;
      explanation.push(
        `Resolved participant "${input.with_ref}" → with:@${withUser.best.displayName} (${withUser.best.confidence.toFixed(2)}).`,
      );
    } else {
      explanation.push(
        `Could not resolve participant "${input.with_ref}"; omitting with: operator.`,
      );
    }
  }

  const parts = buildQueryParts(input, resolved, explanation);
  const primary = compileSlackQuery(parts);
  const fallbacks = buildFallbackQueries(parts, input.strategy || "strict_then_broaden").filter(
    (query) => query && query !== primary,
  );

  return {
    primary,
    fallbacks: [...new Set(fallbacks)].slice(0, 8),
    explanation,
    resolved,
  };
}

export function buildQueryParts(
  input: SlackResearchInput,
  resolved: SlackSearchPlan["resolved"] = {},
  explanation: string[] = [],
): QueryParts {
  const extracted = extractQuotedPhrases(input.query || "");
  const exactPhrases = uniqueStrings([...(input.exact_phrases || []), ...extracted.phrases]);
  const terms = extractTerms(extracted.remainder);
  const time = resolveTimeOperators(input, explanation);
  const fromHandle = toFromHandle(resolved.fromUser);
  const withDisplayName = resolved.withUser ? cleanDisplayName(resolved.withUser) : undefined;

  return {
    terms,
    exactPhrases,
    channelName: resolved.channel?.name,
    fromHandle,
    withDisplayName,
    after: time.after,
    before: time.before,
    during: time.during,
    threadOnly:
      input.thread_only || input.task === "find_threads" || input.strategy === "thread_first",
    contentFilters: input.content_filters || [],
    reactionNames: input.reaction_names || [],
    excludeTerms: input.exclude_terms || [],
  };
}

export function compileSlackQuery(parts: QueryParts): string {
  const tokens: string[] = [];
  tokens.push(...parts.exactPhrases.map((phrase) => quotePhrase(phrase)));
  tokens.push(...parts.terms.map(escapeBareTerm));
  if (parts.channelName) tokens.push(`in:#${parts.channelName.replace(/^#/, "")}`);
  if (parts.fromHandle) tokens.push(`from:${parts.fromHandle.replace(/^@/, "")}`);
  if (parts.withDisplayName) tokens.push(`with:@${parts.withDisplayName.replace(/^@/, "")}`);
  if (parts.after) tokens.push(`after:${parts.after}`);
  if (parts.before) tokens.push(`before:${parts.before}`);
  if (parts.during) tokens.push(`during:${parts.during}`);
  for (const filter of parts.contentFilters) tokens.push(`has:${filter}`);
  for (const reaction of parts.reactionNames)
    tokens.push(`has::${reaction.replace(/^:+|:+$/g, "")}:`);
  if (parts.threadOnly) tokens.push("is:thread");
  for (const term of parts.excludeTerms) tokens.push(`-${escapeBareTerm(term).replace(/^-/, "")}`);
  return tokens.filter(Boolean).join(" ").trim();
}

function buildFallbackQueries(
  parts: QueryParts,
  strategy: NonNullable<SlackResearchInput["strategy"]>,
): string[] {
  const queries: string[] = [];

  if (strategy === "broad") {
    queries.push(
      compileSlackQuery({
        ...parts,
        exactPhrases: [],
        fromHandle: undefined,
        withDisplayName: undefined,
      }),
    );
  }

  if (strategy === "artifact_first") {
    queries.push(
      compileSlackQuery({
        ...parts,
        contentFilters: uniqueStrings([...parts.contentFilters, "link"]),
      }),
    );
    queries.push(
      compileSlackQuery({
        ...parts,
        contentFilters: uniqueStrings([...parts.contentFilters, "file"]),
      }),
    );
  }

  if (strategy === "thread_first") {
    queries.push(compileSlackQuery({ ...parts, threadOnly: true }));
    queries.push(compileSlackQuery({ ...parts, threadOnly: false }));
  }

  queries.push(compileSlackQuery({ ...parts, exactPhrases: [] }));
  queries.push(
    compileSlackQuery({
      ...parts,
      exactPhrases: [],
      fromHandle: undefined,
      withDisplayName: undefined,
    }),
  );
  queries.push(compileSlackQuery({ ...parts, exactPhrases: [], channelName: undefined }));
  queries.push(
    compileSlackQuery({
      ...parts,
      exactPhrases: [],
      channelName: undefined,
      fromHandle: undefined,
      withDisplayName: undefined,
      contentFilters: [],
      reactionNames: [],
      threadOnly: false,
    }),
  );

  return uniqueStrings(queries).filter(Boolean);
}

function resolveTimeOperators(
  input: SlackResearchInput,
  explanation: string[],
): { after?: string; before?: string; during?: string } {
  const out: { after?: string; before?: string; during?: string } = {};

  if (input.during) {
    out.during = normalizeDuring(input.during);
    explanation.push(`Using during:${out.during}.`);
  }

  if (input.since && !out.during) {
    const normalized = normalizeDateLike(input.since, "after");
    if (normalized.kind === "during") {
      out.during = normalized.value;
      explanation.push(`Normalized "${input.since}" → during:${out.during}.`);
    } else if (normalized.value) {
      out.after = normalized.value;
      explanation.push(`Normalized "${input.since}" → after:${out.after}.`);
    }
  }

  if (input.before) {
    const normalized = normalizeDateLike(input.before, "before");
    if (normalized.value && normalized.kind !== "during") {
      out.before = normalized.value;
      explanation.push(`Normalized before boundary → before:${out.before}.`);
    }
  }

  return out;
}

function normalizeDateLike(
  rawValue: string,
  mode: "after" | "before",
): { kind: "date" | "during"; value?: string } {
  const value = rawValue.trim().toLowerCase();
  if (!value) return { kind: "date" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { kind: "date", value };
  if (/^\d{4}$/.test(value)) return { kind: "during", value };
  if (["today", "yesterday", "week"].includes(value)) return { kind: "during", value };
  if (MONTHS[value] !== undefined) return { kind: "date", value: monthBoundary(value, mode) };

  const monthMatch = value.match(
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{4})$/,
  );
  if (monthMatch) {
    const month = MONTHS[monthMatch[1]];
    const year = Number(monthMatch[2]);
    return { kind: "date", value: formatDate(new Date(Date.UTC(year, month, 1))) };
  }

  return { kind: "date", value: value.replace(/\s+/g, "-") };
}

function monthBoundary(monthName: string, mode: "after" | "before"): string {
  const now = new Date();
  const month = MONTHS[monthName];
  let year = now.getUTCFullYear();
  if (mode === "after" && month > now.getUTCMonth()) year -= 1;
  if (mode === "before" && month < now.getUTCMonth()) year += 1;
  return formatDate(new Date(Date.UTC(year, month, 1)));
}

function normalizeDuring(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function extractQuotedPhrases(query: string): { phrases: string[]; remainder: string } {
  const phrases: string[] = [];
  const remainder = query.replace(/"([^"]+)"/g, (_match, phrase) => {
    phrases.push(String(phrase).trim());
    return " ";
  });
  return { phrases: phrases.filter(Boolean), remainder };
}

function extractTerms(text: string): string[] {
  return uniqueStrings(
    text
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean)
      .map((term) => term.replace(/^[^a-zA-Z0-9#@]+|[^a-zA-Z0-9:_-]+$/g, ""))
      .filter((term) => term.length > 1)
      .filter((term) => !STOPWORDS.has(term.toLowerCase()))
      .slice(0, 12),
  );
}

function toFromHandle(user: SlackSearchPlan["resolved"]["fromUser"]): string | undefined {
  if (!user) return undefined;
  if ("handle" in user) return user.handle;
  return undefined;
}

function cleanDisplayName(user: ResolvedUser): string {
  return user.displayName || user.realName || user.handle || user.id;
}

function quotePhrase(value: string): string {
  const escaped = value.trim().replace(/"/g, "");
  return escaped ? `"${escaped}"` : "";
}

function escapeBareTerm(value: string): string {
  return value.trim().replace(/\s+/g, "-");
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export const __internals = {
  buildQueryParts,
  compileSlackQuery,
  extractQuotedPhrases,
  extractTerms,
  normalizeDateLike,
};
