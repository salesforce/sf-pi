/* SPDX-License-Identifier: Apache-2.0 */
/** Compatibility status action for the built-in SOQL parser pipeline. */

import type { SoqlConnection as Connection } from "./api.ts";
import { apiVersion } from "./api.ts";
import { buildDigest, row, section, toolResultFromDigest } from "./digest.ts";
import type { SfSoqlParams, ToolResult } from "./types.ts";

export function lspStatus(conn: Connection, params: SfSoqlParams): ToolResult {
  const digest = buildDigest({
    action: "lsp.status",
    status: "pass",
    icon: "🧠",
    title: "SOQL Parser Status",
    org: { alias: params.target_org, api_version: apiVersion(conn) },
    sections: [
      section("🧠", "Diagnostics Mode", [
        row("✅", "Syntax", `Built-in parser · org API v${apiVersion(conn)}`),
        row("✅", "Context", "REST/Tooling and Apex bind rules are separated"),
        row("✅", "Schema", "Describe-backed recursive validation active"),
        row("⚪", "Background", "No language-server process is required"),
      ]),
    ],
  });
  return toolResultFromDigest(digest);
}
