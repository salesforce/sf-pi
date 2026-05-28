/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared Salesforce REST path helpers.
 *
 * Tools and TUIs usually think in resources relative to
 * `/services/data/vXX.X` (for example `/query`, `/sobjects`, `/ssot/...`). If
 * callers include a full `/services/data/vNN.N/...` prefix, normalize it back
 * to the active org API version instead of trusting the supplied version.
 */

export type QueryValue = string | number | boolean | null | undefined | QueryValue[];
export type QueryParams = Record<string, QueryValue>;

const SERVICES_DATA_RE = /^\/services\/data\/v\d+(?:\.\d+)?(?=\/|$)/i;

export function normalizeRestPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("path is required");

  const withoutVersion = trimmed.replace(SERVICES_DATA_RE, "") || "/";
  if (!withoutVersion.startsWith("/")) {
    return `/${withoutVersion}`;
  }
  return withoutVersion;
}

/** Back-compat alias for Data 360 callers that imported the old name. */
export const normalizeD360Path = normalizeRestPath;

export function buildApiPath(path: string, apiVersion: string, query?: QueryParams): string {
  const normalized = normalizeRestPath(path);
  const base = `/services/data/v${apiVersion}${normalized}`;
  const queryString = buildQueryString(query);
  return queryString ? `${base}?${queryString}` : base;
}

export function buildQueryString(query?: QueryParams): string {
  if (!query) return "";

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    appendQueryValue(params, key, value);
  }
  return params.toString();
}

function appendQueryValue(params: URLSearchParams, key: string, value: QueryValue): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(params, key, item);
    return;
  }
  params.append(key, String(value));
}
