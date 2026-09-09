/* SPDX-License-Identifier: Apache-2.0 */

export const PROVIDER_NAME = "sf-docs";
export const COMMAND_NAME = "sf-docs";
export const TOOL_NAME = "sf_docs";
export const ENV_ENDPOINT = "SF_DOCS_MCP_ENDPOINT";
export const WIDGET_KEY = "sf-docs-status";

export type DocsAction =
  "status" | "collections" | "search" | "fetch" | "answer" | "explain" | "cheatsheet";

export type EndpointSource = "pi-auth" | "env" | "none";
export type DocsScope = "global" | "project";
export type SfDocsDisplayDensity = "compact" | "balanced" | "verbose";

export type EndpointResolution =
  | {
      ok: true;
      source: Exclude<EndpointSource, "none">;
      endpoint: string;
      warning?: string;
    }
  | {
      ok: false;
      source: EndpointSource;
      error: string;
    };

export interface SfDocsPreferences {
  defaultCollection: string;
  defaultVersion: string;
  defaultLocale: string;
  defaultFetchFormat: "text" | "markdown" | "html";
  defaultPageSize: number;
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

export interface DocsLandmark {
  slug?: string;
  label?: string;
  members?: string[];
}

export interface DocsLandmarkLocaleDiff {
  locales?: string[];
  added?: DocsLandmark[];
  removed?: DocsLandmark[];
}

export interface DocsLandmarkSlice {
  version?: string;
  landmarks?: DocsLandmark[];
  localeDiffs?: DocsLandmarkLocaleDiff[];
}

export interface DocsCollection {
  collection: string;
  description?: string;
  status?: string;
  versions?: string[];
  versionLabels?: Record<string, string>;
  locales?: string[];
  formats?: string[];
  retrievalHints?: string;
  fetchHints?: string;
  landmarks?: DocsLandmarkSlice[];
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
