/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Small lazy adapter around the official AgentScript LSP document pipeline.
 *
 * SF Pi keeps its model-facing output shapes, but generic AgentScript parsing,
 * lint context, references, definitions, and code actions should come from the
 * official @sf-agentscript packages rather than duplicated local walkers. The
 * imports stay lazy so normal pi startup does not load the full AgentScript
 * toolchain until a `.agent` workflow needs it.
 */

import type { DocumentState, LspParser } from "@sf-agentscript/lsp";

export const AGENTFORCE_DOCUMENT_URI = "file:///sf-pi/agent.agent";

export async function processAgentforceDocument(
  source: string,
  uri = AGENTFORCE_DOCUMENT_URI,
): Promise<DocumentState> {
  const [{ getParser }, { defaultDialects, processDocument }] = await Promise.all([
    import("@sf-agentscript/agentforce"),
    import("@sf-agentscript/lsp"),
  ]);

  const agentforceDialect = defaultDialects.find((dialect) => dialect.name === "agentforce");
  if (!agentforceDialect) {
    throw new Error("@sf-agentscript/lsp did not expose the agentforce dialect.");
  }

  return processDocument(uri, source, {
    dialects: [agentforceDialect],
    defaultDialect: agentforceDialect.name,
    parser: getParser() as unknown as LspParser,
  });
}
