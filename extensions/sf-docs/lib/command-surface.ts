/* SPDX-License-Identifier: Apache-2.0 */
import type { SfPiCommandAction } from "../../../lib/common/command-actions.ts";

export type SfDocsCommandAction =
  "connect" | "disconnect" | "status" | "collections" | "refresh" | "cheatsheet" | "help";

export const SF_DOCS_ACTIONS: SfPiCommandAction<SfDocsCommandAction>[] = [
  {
    value: "connect",
    label: "Configure endpoint",
    description: "Prepare native /login to save an internally supplied endpoint URL.",
    group: "Connection",
  },
  {
    value: "disconnect",
    label: "Disconnect",
    description:
      "Prepare native logout for the saved endpoint. Environment variables are untouched.",
    group: "Connection",
  },
  {
    value: "status",
    label: "Show status",
    description: "Show connection, endpoint, defaults, and catalog-cache status.",
    group: "Connection",
  },
  {
    value: "collections",
    label: "List collections",
    description: "List docs collections using the catalog cache when available.",
    group: "Docs",
  },
  {
    value: "refresh",
    label: "Refresh catalog",
    description: "Refetch and cache the collection catalog from the docs service.",
    group: "Docs",
  },
  {
    value: "cheatsheet",
    label: "Open cheatsheet",
    description: "Show the extension-owned SF Docs usage cheatsheet.",
    group: "Reference",
  },
  {
    value: "help",
    label: "Show help",
    description: "Show command usage and setup guidance.",
    group: "Reference",
  },
];

export function renderHelp(): string {
  return [
    "# SF Docs",
    "",
    "Use SF Docs for official Salesforce documentation lookup through the `sf_docs` family tool.",
    "",
    "Commands:",
    "- `/sf-docs` — open the SF Pi Manager detail page.",
    "- `/sf-docs connect` — prepare native `/login sf-docs` for endpoint configuration.",
    "- `/sf-docs disconnect` — prefill native logout for the saved endpoint; env vars are untouched.",
    "- `/sf-docs status` — show endpoint configuration, defaults, and cache status.",
    "- `/sf-docs collections` — list available docs collections.",
    "- `/sf-docs refresh` — refresh the collection catalog cache.",
    "- `/sf-docs cheatsheet` — show the extension-owned usage cheatsheet.",
    "",
    "Endpoint setup:",
    "- `/login sf-docs` collects and persists only an internally supplied docs endpoint URL.",
    "- No access token is required, stored, or transmitted.",
    "- `SF_DOCS_MCP_ENDPOINT` remains the non-persisted automation fallback.",
    "- SF Docs ships with no default endpoint.",
  ].join("\n");
}
