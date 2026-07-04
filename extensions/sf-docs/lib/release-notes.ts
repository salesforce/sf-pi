/* SPDX-License-Identifier: Apache-2.0 */
/** Release-note evidence helpers for SF Docs query plans and answer gates. */
import { getDocsCollectionProfile } from "./collection-profiles.ts";
import type { DocsSearchResult } from "./types.ts";

export type ReleaseNoteEvidenceStatus =
  | "ok"
  | "no_matches"
  | "wrong_release"
  | "not_release_note_evidence"
  | "coverage_gap"
  | "not_checked";

export interface ReleaseNoteEvidenceEvaluation {
  status: ReleaseNoteEvidenceStatus;
  message?: string;
}

export function evaluateReleaseNoteEvidence(input: {
  release?: string;
  releaseNoteIntent?: boolean;
  collection?: string;
  results: DocsSearchResult[];
}): ReleaseNoteEvidenceEvaluation {
  const release = normalizeReleaseValue(input.release);
  if (!release || !input.releaseNoteIntent) return { status: "not_checked" };

  if (!input.results.length) {
    if (hasBoundedReleaseNoteCoverage(input.collection)) {
      return {
        status: "coverage_gap",
        message: `No release-note evidence matched release ${release}. The ${input.collection} collection exposes current product docs plus a bounded Salesforce release-note window.`,
      };
    }
    return { status: "no_matches", message: `No documents matched release ${release}.` };
  }

  const releaseMatches = input.results.filter((result) => resultMatchesRelease(result, release));
  if (!releaseMatches.length) {
    return {
      status: "wrong_release",
      message: `Returned documents did not match release ${release}.`,
    };
  }

  if (!releaseMatches.some(resultHasReleaseNoteMarkers)) {
    return {
      status: "not_release_note_evidence",
      message: `Returned documents matched release ${release}, but did not carry release-note markers.`,
    };
  }

  return { status: "ok" };
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

function hasBoundedReleaseNoteCoverage(collection?: string): boolean {
  if (!collection) return false;
  const profile = getDocsCollectionProfile(collection);
  return Boolean(profile?.releaseNotes.toLowerCase().includes("latest three"));
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
