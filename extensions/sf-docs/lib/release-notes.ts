/* SPDX-License-Identifier: Apache-2.0 */
/** Release-note evidence helpers for explicit SF Docs grounding. */
import type { DocsSearchResult } from "./types.ts";

const BOUNDED_RELEASE_NOTE_COLLECTIONS = new Set(["admin"]);
const GENERIC_RELEASE_SUBJECT_TOKENS = new Set([
  "change",
  "changed",
  "changes",
  "feature",
  "features",
  "language",
  "new",
  "note",
  "notes",
  "release",
  "releases",
  "salesforce",
  "spring",
  "summer",
  "syntax",
  "update",
  "updated",
  "updates",
  "winter",
]);

export type ReleaseNoteEvidenceStatus =
  | "ok"
  | "no_matches"
  | "wrong_release"
  | "not_release_note_evidence"
  | "irrelevant_release_note_evidence"
  | "coverage_gap"
  | "not_checked";

export interface ReleaseNoteEvidenceEvaluation {
  status: ReleaseNoteEvidenceStatus;
  message?: string;
  candidates: DocsSearchResult[];
}

export function evaluateReleaseNoteEvidence(input: {
  release?: string;
  releaseNoteIntent?: boolean;
  collection?: string;
  subjectTokens?: string[];
  results: DocsSearchResult[];
}): ReleaseNoteEvidenceEvaluation {
  const release = normalizeReleaseValue(input.release);
  if (!release || !input.releaseNoteIntent) {
    return { status: "not_checked", candidates: input.results };
  }

  if (!input.results.length) {
    if (hasBoundedReleaseNoteCoverage(input.collection)) {
      return {
        status: "coverage_gap",
        message: `No release-note evidence matched release ${release}. The ${input.collection} collection exposes current product docs plus a bounded Salesforce release-note window.`,
        candidates: [],
      };
    }
    return {
      status: "no_matches",
      message: `No documents matched release ${release}.`,
      candidates: [],
    };
  }

  const releaseMatches = input.results.filter((result) => resultMatchesRelease(result, release));
  if (!releaseMatches.length) {
    return {
      status: "wrong_release",
      message: `Returned documents did not match release ${release}.`,
      candidates: [],
    };
  }

  const releaseNoteMatches = releaseMatches.filter(resultHasReleaseNoteMarkers);
  if (!releaseNoteMatches.length) {
    return {
      status: "not_release_note_evidence",
      message: `Returned documents matched release ${release}, but did not carry release-note markers.`,
      candidates: [],
    };
  }

  const subjectTokens = normalizeSubjectTokens(input.subjectTokens ?? []);
  const candidates = subjectTokens.length
    ? releaseNoteMatches.filter((result) => resultMatchesSubject(result, subjectTokens))
    : releaseNoteMatches;
  if (!candidates.length) {
    return {
      status: "irrelevant_release_note_evidence",
      message: `Release ${release} release-note documents were found, but none matched the requested subject.`,
      candidates: [],
    };
  }

  return { status: "ok", candidates };
}

export function resultMatchesRelease(result: DocsSearchResult, release: string): boolean {
  return (
    normalizeReleaseValue(result.release) === release ||
    Boolean(result.url?.match(new RegExp(`[?&]release=${escapeRegExp(release)}(?:\\D|$)`, "u")))
  );
}

export function resultHasReleaseNoteMarkers(result: DocsSearchResult): boolean {
  const url = typeof result.url === "string" ? result.url : "";
  const filename = typeof result.filename === "string" ? result.filename : "";
  const title = typeof result.title === "string" ? result.title : "";
  const guides = typeof result.guides === "string" ? result.guides : "";
  const articleId = articleIdFromUrl(url);
  const locatorText = [url, filename, articleId].join(" ").toLowerCase();
  const visibleText = [title, guides].join(" ").toLowerCase().replace(/[_-]/gu, " ");

  return (
    /\brelease notes?\b/u.test(visibleText) ||
    locatorText.includes("release-notes") ||
    locatorText.includes("release_notes") ||
    locatorText.includes("salesforce_release_notes") ||
    /(?:^|[./])rn[_-]/u.test(locatorText)
  );
}

export function normalizeReleaseValue(value: unknown): string | undefined {
  if (typeof value === "number") return String(Math.trunc(value));
  if (typeof value !== "string") return undefined;
  return value.match(/^\d+/u)?.[0];
}

function normalizeSubjectTokens(tokens: string[]): string[] {
  return [
    ...new Set(
      tokens
        .map(normalizeToken)
        .filter(
          (token) =>
            token.length > 1 &&
            !/^(?:\d{2}|20\d{2})$/u.test(token) &&
            !GENERIC_RELEASE_SUBJECT_TOKENS.has(token),
        ),
    ),
  ];
}

function resultMatchesSubject(result: DocsSearchResult, subjectTokens: string[]): boolean {
  const searchable = [
    result.title,
    result.description,
    result.url,
    result.filename,
    result.product,
    result.products,
    result.guides,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const resultTokens = new Set(tokenize(searchable));
  const matches = subjectTokens.filter((token) => resultTokens.has(token)).length;
  return matches >= Math.min(2, subjectTokens.length);
}

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .split(/[^a-z0-9]+/iu)
    .map(normalizeToken)
    .filter(Boolean);
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/giu, "");
}

function hasBoundedReleaseNoteCoverage(collection?: string): boolean {
  return Boolean(collection && BOUNDED_RELEASE_NOTE_COLLECTIONS.has(collection));
}

function articleIdFromUrl(value: string): string {
  try {
    return new URL(value).searchParams.get("id") ?? "";
  } catch {
    return "";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
