/* SPDX-License-Identifier: Apache-2.0 */
/** Official SOQL language-server validator integration. */

import { createRequire } from "node:module";
import { buildDigest, row, section, toolResultFromDigest } from "./digest.ts";
import type { SfSoqlParams, ToolResult } from "./types.ts";

const require = createRequire(import.meta.url);
const { Validator } = require("@salesforce/soql-language-server/lib/validator") as {
  Validator: { validateSoqlText: (doc: unknown) => SoqlLspDiagnostic[] };
};
const { TextDocument } = require("vscode-languageserver-textdocument") as {
  TextDocument: {
    create: (uri: string, languageId: string, version: number, content: string) => unknown;
  };
};

export interface SoqlLspDiagnostic {
  severity?: number;
  message: string;
  source?: string;
  range?: {
    start?: { line?: number; character?: number };
    end?: { line?: number; character?: number };
  };
}

export function validateWithSoqlLsp(
  query: string,
  uri = "inmemory://sf-soql/query.soql",
): SoqlLspDiagnostic[] {
  const doc = TextDocument.create(uri, "soql", 1, query);
  return Validator.validateSoqlText(doc);
}

export function lspStatus(params: SfSoqlParams): ToolResult {
  const digest = buildDigest({
    action: "lsp.status",
    status: "pass",
    icon: "🧠",
    title: "SOQL LSP Status",
    org: { alias: params.target_org },
    sections: [
      section("🧠", "Diagnostics Mode", [
        row("✅", "Official LSP", "@salesforce/soql-language-server Validator active"),
        row("✅", "Schema layer", "Parser + describe-backed sf_soql diagnostics active"),
        row("⚪", "Background", "No long-running LSP process is started in V1.1"),
      ]),
    ],
  });
  return toolResultFromDigest(digest);
}
