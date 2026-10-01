/* SPDX-License-Identifier: Apache-2.0 */
/** Non-model command that captures the connected Salesforce DX MCP runtime contract. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PREFIX = "mcp__salesforce_dx__";

export default function sfMcpContractCapture(pi: ExtensionAPI): void {
  pi.registerCommand("sf-mcp-contract-capture", {
    description: "Capture the connected Salesforce DX MCP contract as JSON",
    handler: async () => {
      const deadline = Date.now() + 120_000;
      let tools = pi.getAllTools().filter((tool) => tool.name.startsWith(PREFIX));
      while (tools.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        tools = pi.getAllTools().filter((tool) => tool.name.startsWith(PREFIX));
      }
      if (tools.length === 0) {
        throw new Error("Salesforce DX MCP did not publish a tool contract within 120 seconds.");
      }
      console.info(
        JSON.stringify({
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            annotations: tool.annotations,
          })),
        }),
      );
    },
  });
}
