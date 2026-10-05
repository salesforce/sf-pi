/* SPDX-License-Identifier: Apache-2.0 */
import type { SfPiCommandAction } from "../../../lib/common/command-actions.ts";

export type SfDocsCommandAction =
  "connect" | "disconnect" | "status" | "collections" | "refresh" | "cheatsheet" | "help";

export const SF_DOCS_ACTIONS: SfPiCommandAction<SfDocsCommandAction>[] = [
  {
    value: "connect",
    label: "Connect",
    description: "Prepare native /login to save the docs endpoint and masked access token.",
    group: "Connection",
  },
  {
    value: "disconnect",
    label: "Disconnect",
    description:
      "Prepare native logout for the saved credential. Environment variables are untouched.",
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
    "- `/sf-docs connect` — prepare native `/login sf-docs` for endpoint and token configuration.",
    "- `/sf-docs disconnect` — prefill native logout for the saved credential; env vars are untouched.",
    "- `/sf-docs status` — show credential configuration, defaults, and cache status.",
    "- `/sf-docs collections` — list available docs collections.",
    "- `/sf-docs refresh` — refresh the collection catalog cache.",
    "- `/sf-docs cheatsheet` — show the extension-owned usage cheatsheet.",
    "",
    "Credential setup:",
    "- `/login sf-docs` collects the docs endpoint URL, then masks the access token.",
    "- Pi owns credential persistence and `/logout sf-docs` owns removal.",
    "- `SF_DOCS_MCP_TOKEN` and `SF_DOCS_MCP_ENDPOINT` remain automation fallbacks.",
    "- SF Docs ships with no default endpoint.",
  ].join("\n");
}
