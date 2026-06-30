/* SPDX-License-Identifier: Apache-2.0 */
import type { SfPiCommandAction } from "../../../lib/common/command-actions.ts";

export type SfDocsCommandAction =
  | "connect"
  | "disconnect"
  | "status"
  | "collections"
  | "refresh"
  | "cheatsheet"
  | "help";

export const SF_DOCS_ACTIONS: SfPiCommandAction<SfDocsCommandAction>[] = [
  {
    value: "connect",
    label: "Connect / Re-authenticate",
    description: "Paste an SF Docs token and store it in Pi's local auth store.",
    group: "Connection",
  },
  {
    value: "disconnect",
    label: "Disconnect",
    description: "Clear the saved SF Docs credential. Environment variables are left untouched.",
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
    "- `/sf-docs connect` — store a token in Pi's local auth store.",
    "- `/sf-docs disconnect` — clear the saved token; env vars are untouched.",
    "- `/sf-docs status` — show auth, endpoint, defaults, and cache status.",
    "- `/sf-docs collections` — list available docs collections.",
    "- `/sf-docs refresh` — refresh the collection catalog cache.",
    "- `/sf-docs cheatsheet` — show the extension-owned usage cheatsheet.",
    "",
    "Automation fallback:",
    "- `SF_DOCS_MCP_TOKEN` supplies the token without saving it.",
    "- `SF_DOCS_MCP_ENDPOINT` overrides the default endpoint for advanced testing.",
  ].join("\n");
}
