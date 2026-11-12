/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Salesforce Help article URL recovery for the ground workflow.
 *
 * The docs service matches a Help URL against the exact form it indexed:
 * `https://help.salesforce.com/s/articleView?id=<article>&release=<n>&type=5`.
 * Pasted URLs usually lack `release=` or carry extras such as
 * `&language=en_US`, so the service answers `not_found` even though the
 * article is indexed. Ground's recovery search can't always find the article
 * by name, but every Help result it returns carries the indexed release, so
 * the one allowed refetch can use the exact indexed URL instead.
 */
import type { DocsSearchResult } from "./types.ts";

const HELP_HOST = "help.salesforce.com";
const ARTICLE_PATH = "/s/articleview";
const RELEASE_PATTERN = /^\d{3}(?:\.\d+){0,2}$/u;

function helpArticleUrl(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.hostname.toLowerCase() !== HELP_HOST) return undefined;
  if (url.pathname.toLowerCase() !== ARTICLE_PATH) return undefined;
  return url.searchParams.get("id")?.trim() ? url : undefined;
}

/**
 * The indexed form of a Help article URL for `release`, or undefined when the
 * input isn't a Help article URL or is already in that exact form.
 */
export function indexedHelpArticleUrl(value: string, release: string): string | undefined {
  const url = helpArticleUrl(value);
  if (!url || !RELEASE_PATTERN.test(release)) return undefined;
  const id = url.searchParams.get("id")?.trim() ?? "";
  const type = url.searchParams.get("type")?.trim() || "5";
  const indexed = `https://${HELP_HOST}/s/articleView?id=${encodeURIComponent(id)}&release=${release}&type=${encodeURIComponent(type)}`;
  return indexed === value ? undefined : indexed;
}

/**
 * The indexed release most Help articles in `results` carry. Release-notes
 * pages are skipped: they keep the release they shipped in (260, 262, …), not
 * the current one. Ties go to the earliest result.
 */
export function releaseFromSearchResults(
  results: DocsSearchResult[] | undefined,
): string | undefined {
  const counts = new Map<string, number>();
  for (const result of results ?? []) {
    const url = result.url ? helpArticleUrl(result.url) : undefined;
    if (!url || url.searchParams.get("id")?.toLowerCase().startsWith("release-notes.")) continue;
    const release = url.searchParams.get("release")?.trim();
    if (release && RELEASE_PATTERN.test(release)) {
      counts.set(release, (counts.get(release) ?? 0) + 1);
    }
  }
  let best: string | undefined;
  for (const [release, count] of counts) {
    if (best === undefined || count > (counts.get(best) ?? 0)) best = release;
  }
  return best;
}
