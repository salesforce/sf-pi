/* SPDX-License-Identifier: Apache-2.0 */
import { detectTokenSource, resolveEndpoint } from "./auth.ts";
import { formatCacheAge, readCatalogCache } from "./catalog-cache.ts";
import { readEffectiveDocsPreferences } from "./preferences.ts";

export function buildStatus(cwd: string): string {
  const tokenSource = detectTokenSource();
  const endpoint = resolveEndpoint();
  const cache = readCatalogCache();
  const prefs = readEffectiveDocsPreferences(cwd);
  const lines = [
    "📚 SF Docs status",
    "",
    `Connection: ${tokenSource !== "none" ? "connected" : "not configured"}`,
    `Token source: ${tokenSource}`,
  ];
  lines.push(`Endpoint: ${endpoint.endpoint} (${endpoint.source})`);
  if (endpoint.warning) lines.push(`Warning: ${endpoint.warning}`);
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
  lines.push(`- citations: ${prefs.includeCitations ? "on" : "off"}`);
  lines.push(`- display density: ${prefs.displayDensity}`);
  lines.push(`- catalog cache: ${prefs.cacheCatalog ? "on" : "off"}`);
  return lines.join("\n");
}
