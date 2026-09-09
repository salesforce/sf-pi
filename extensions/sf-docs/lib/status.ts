/* SPDX-License-Identifier: Apache-2.0 */
import { resolveEndpoint } from "./auth.ts";
import { formatCacheAge, readCatalogCache } from "./catalog-cache.ts";
import { readEffectiveDocsPreferences } from "./preferences.ts";

export function buildStatus(cwd: string): string {
  const endpoint = resolveEndpoint();
  const cache = readCatalogCache();
  const prefs = readEffectiveDocsPreferences(cwd);
  const lines = [
    "📚 SF Docs status",
    "",
    `Configuration: ${endpoint.ok ? "ready" : "not configured"}`,
    `Endpoint source: ${endpoint.source}`,
    "Authentication: not required",
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
