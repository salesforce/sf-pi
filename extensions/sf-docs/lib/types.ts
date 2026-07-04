/* SPDX-License-Identifier: Apache-2.0 */

export const PROVIDER_NAME = "sf-docs";
export const COMMAND_NAME = "sf-docs";
export const TOOL_NAME = "sf_docs";
export const ENV_TOKEN = "SF_DOCS_MCP_TOKEN";
export const ENV_ENDPOINT = "SF_DOCS_MCP_ENDPOINT";
export const DEFAULT_ENDPOINT = "https://mcp.docs.salesforce.com/";
export const LONG_LIVED_EXPIRY_MS = 1000 * 60 * 60 * 24 * 365 * 10;
export const MANUAL_REFRESH_SENTINEL = "manual-token";

export type DocsAction =
  "status" | "collections" | "search" | "fetch" | "answer" | "explain" | "cheatsheet";

export type TokenSource = "pi-auth" | "env" | "none";
export type EndpointSource = "default" | "env";
export type DocsScope = "global" | "project";
export type SfDocsDisplayDensity = "compact" | "balanced" | "verbose";

export interface TokenResolution {
  source: Exclude<TokenSource, "none">;
  token: string;
}

export interface EndpointResolution {
  source: EndpointSource;
  endpoint: string;
  warning?: string;
}

export interface SfDocsPreferences {
  defaultCollection: string;
  defaultVersion: string;
  defaultLocale: string;
  defaultFetchFormat: "text" | "markdown" | "html";
  defaultPageSize: number;
  includeCitations: boolean;
  displayDensity: SfDocsDisplayDensity;
  cacheCatalog: boolean;
}

export interface SfDocsSettingsSource {
  scope: "project" | "global" | "default";
  path?: string;
}

export interface EffectiveSfDocsPreferences extends SfDocsPreferences {
  sources: Record<keyof SfDocsPreferences, SfDocsSettingsSource>;
}

export interface DocsCollection {
  collection: string;
  versions?: string[];
  versionLabels?: Record<string, string>;
  locales?: string[];
  formats?: string[];
  retrievalHints?: string;
  fetchHints?: string;
  landmarks?: Array<{ slug?: string; label?: string; members?: unknown[] }>;
  extraFields?: string[];
}

export interface DocsSearchResult {
  id?: string;
  url?: string;
  title?: string;
  description?: string;
  collection?: string;
  version?: string;
  locale?: string;
  product?: string;
  products?: string;
  guides?: string;
  filename?: string;
  sourcePath?: string;
  baseUrl?: string;
  release?: string | number;
  taxonomyIds?: string | string[];
  contentHash?: string;
  content?: string;
  [key: string]: unknown;
}

export type DocsCitation = DocsSearchResult;

export interface DocsDocument extends DocsSearchResult {
  content?: string;
  error?: string;
}

export interface ToolResultShape {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}
