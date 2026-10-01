/* SPDX-License-Identifier: Apache-2.0 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createToolTestContext } from "../../../lib/common/tests/extension-tool-context.ts";
import {
  clearMcpTargetAttestations,
  takeMcpTargetAttestation,
} from "../../../lib/common/mcp-target-attestation/store.ts";
import {
  registerMcpTargetVerificationTool,
  SF_MCP_VERIFY_TARGET_TOOL_NAME,
} from "../lib/target-verification-tool.ts";

const ORG_ID = "00D000000000001AAA";

describe("SF MCP exact target verification", () => {
  beforeEach(() => clearMcpTargetAttestations());

  it("records a one-use attestation after comparing the same MCP and CLI org", async () => {
    let definition: any;
    const pi = {
      registerTool: vi.fn((value) => {
        definition = value;
      }),
    };
    registerMcpTargetVerificationTool(pi as never, {
      resolveServer: () => ({
        configuredName: "salesforce-sobject-mutations",
        configFingerprint: "config-1",
        targetType: "sandbox",
      }),
      resolveCliOrg: vi.fn().mockResolvedValue({ orgId: ORG_ID, isSandbox: true }),
      now: () => 1_000,
    });

    expect(definition.name).toBe(SF_MCP_VERIFY_TARGET_TOOL_NAME);
    const ctx = createToolTestContext({
      cwd: "/workspace",
      isProjectTrusted: () => true,
      sessionManager: { getSessionId: () => "session-1" },
      executeTool: vi.fn().mockResolvedValue({
        isError: false,
        result: {
          content: [{ type: "text", text: JSON.stringify([{ Id: ORG_ID, IsSandbox: true }]) }],
          details: undefined,
        },
      }),
    });

    const result = await definition.execute(
      "verify-1",
      {
        server_name: "salesforce-sobject-mutations",
        target_org: "DevSandbox",
        next_tool: "updateSobjectRecord",
      },
      undefined,
      undefined,
      ctx,
    );

    expect(result.content[0].text).toContain("verified");
    expect(ctx.executeTool).toHaveBeenCalledWith(
      "mcp__salesforce_sobject_mutations__soqlQuery",
      { query: "SELECT Id, IsSandbox FROM Organization LIMIT 1" },
      { signal: undefined },
    );
    expect(
      takeMcpTargetAttestation(
        {
          sessionId: "session-1",
          serverName: "salesforce-sobject-mutations",
          nextTool: "updateSobjectRecord",
          configFingerprint: "config-1",
        },
        1_000,
      ),
    ).toMatchObject({ orgId: ORG_ID, isSandbox: true, expiresAt: 121_000 });
  });

  it("refuses a mismatched MCP OAuth org", async () => {
    let definition: any;
    const pi = { registerTool: (value: unknown) => (definition = value) };
    registerMcpTargetVerificationTool(pi as never, {
      resolveServer: () => ({
        configuredName: "salesforce-sobject-mutations",
        configFingerprint: "config-1",
        targetType: "sandbox",
      }),
      resolveCliOrg: vi.fn().mockResolvedValue({ orgId: ORG_ID, isSandbox: true }),
      now: () => 1_000,
    });
    const ctx = createToolTestContext({
      cwd: "/workspace",
      isProjectTrusted: () => true,
      sessionManager: { getSessionId: () => "session-1" },
      executeTool: vi.fn().mockResolvedValue({
        isError: false,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify([{ Id: `${ORG_ID.slice(0, -4)}2AAA`, IsSandbox: true }]),
            },
          ],
          details: undefined,
        },
      }),
    });

    await expect(
      definition.execute(
        "verify-1",
        {
          server_name: "salesforce-sobject-mutations",
          target_org: "DevSandbox",
          next_tool: "updateSobjectRecord",
        },
        undefined,
        undefined,
        ctx,
      ),
    ).rejects.toThrow("does not match");
  });
});
