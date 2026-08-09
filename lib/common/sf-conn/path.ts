/* SPDX-License-Identifier: Apache-2.0 */
/** Internal path construction for the Salesforce Connection Module. */

export type SalesforceQueryValue =
  string | number | boolean | null | undefined | SalesforceQueryValue[];
export type SalesforceQueryParams = Record<string, SalesforceQueryValue>;

const SERVICES_DATA_RE = /^\/services\/data\/v\d+(?:\.\d+)?(?=\/|$)/i;

export function buildSalesforceApiPath(
  resource: string,
  apiVersion: string,
  query?: SalesforceQueryParams,
): string {
  const normalized = normalizeSalesforceResource(resource);
  const separator = normalized.includes("?") ? "&" : "?";
  const queryString = buildSalesforceQueryString(query);
  return `/services/data/v${apiVersion}${normalized}${queryString ? `${separator}${queryString}` : ""}`;
}

export function isVersionedSalesforceResource(resource: string): boolean {
  const trimmed = resource.trim();
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return SERVICES_DATA_RE.test(withLeadingSlash);
}

export function normalizeSalesforceResource(resource: string): string {
  const trimmed = resource.trim();
  if (!trimmed) throw new Error("Salesforce resource path is required.");
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("//")) {
    throw new Error("Salesforce resource paths must be relative to the target org instance URL.");
  }
  assertSafeResourcePath(trimmed);

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(SERVICES_DATA_RE, "") || "/";
}

function assertSafeResourcePath(resource: string): void {
  try {
    const encodedPath = resource.split(/[?#]/, 1)[0] ?? "";
    const decodedPath = decodeURIComponent(encodedPath);
    if (decodedPath.includes("\\")) throw new Error("backslash");
    const segments = decodedPath.split("/");
    if (segments.some((segment) => segment === "." || segment === "..")) {
      throw new Error("traversal");
    }
  } catch {
    throw new Error("Salesforce resource paths cannot contain traversal or invalid encoding.");
  }
}

export function buildSalesforceQueryString(query?: SalesforceQueryParams): string {
  if (!query) return "";

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) appendQueryValue(params, key, value);
  return params.toString();
}

function appendQueryValue(params: URLSearchParams, key: string, value: SalesforceQueryValue): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(params, key, item);
    return;
  }
  params.append(key, String(value));
}
