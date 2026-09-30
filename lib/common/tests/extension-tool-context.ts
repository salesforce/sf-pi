/* SPDX-License-Identifier: Apache-2.0 */
/** Native Pi tool-execution context fixture for focused extension tests. */
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";

export function createToolTestContext(overrides: Record<string, unknown>): ExtensionToolContext {
  return {
    tools: [],
    async executeTool() {
      throw new Error("Unexpected nested tool execution in focused test.");
    },
    ...overrides,
  } as unknown as ExtensionToolContext;
}
