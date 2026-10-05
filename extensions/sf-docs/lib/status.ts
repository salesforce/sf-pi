/* SPDX-License-Identifier: Apache-2.0 */
import { detectTokenSource, isDocsConfigured, resolveEndpoint } from "./auth.ts";
import { formatCacheAge, readCatalogCache } from "./catalog-cache.ts";
import { readEffectiveDocsPreferences } from "./preferences.ts";

export function buildStatus(cwd: string): string {
  const tokenSource = detectTokenSource();
  const endpoint = resolveEndpoint();
  const cache = readCatalogCache(Date.now(), endpoint.ok ? endpoint.endpoint : undefined);
  const prefs = readEffectiveDocsPreferences(cwd);
  const partiallyConfigured = tokenSource !== "none" || endpoint.source !== "none";
  const lines = [
    "📚 SF Docs status",
    "",
    `Configuration: ${isDocsConfigured() ? "ready" : partiallyConfigured ? "setup required" : "not configured"}`,
    `Token source: ${tokenSource}`,
    `Endpoint source: ${endpoint.source}`,
    "Authentication: bearer token required",
  ];
  if (endpoint.ok && endpoint.warning) lines.push(`Warning: ${endpoint.warning}`);
  if (endpoint.ok === false && endpoint.source !== "none") {
    lines.push(`Warning: ${endpoint.error}`);
  }
  lines.push("Network verification: not checked");
  lines.push(
    `Catalog cache: ${cache.hit ? `${cache.collections?.length ?? 0} collections, ${formatCacheAge(cache.fetchedAt)}` : "empty"}`,
  );
  lines.push("");
  lines.push("Defaults:");
  lines.push(`- collection: ${prefs.defaultCollection}`);
  lines.push(`- version: ${prefs.defaultVersion}`);
  lines.push(`- locale: ${prefs.defaultLocale}`);
  lines.push(`- fetch format: ${prefs.defaultFetchFormat}`);
  lines.push(`- page size: ${prefs.defaultPageSize}`);
  lines.push("- citations: always on for answer/explain");
  lines.push(`- display density: ${prefs.displayDensity}`);
  lines.push(`- catalog cache: ${prefs.cacheCatalog ? "on" : "off"}`);
  return lines.join("\n");
}
