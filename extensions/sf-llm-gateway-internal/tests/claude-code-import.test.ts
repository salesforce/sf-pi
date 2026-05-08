/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for importing cleansed SF LLM Gateway settings from Claude Code. */
import { describe, expect, it } from "vitest";
import { findClaudeCodeGatewayConfig } from "../lib/claude-code-import.ts";

describe("findClaudeCodeGatewayConfig", () => {
  it("imports Anthropic-style env settings and cleanses route suffixes", () => {
    const result = findClaudeCodeGatewayConfig({
      env: {
        ANTHROPIC_BASE_URL: "https://gateway.example.com/bedrock/v1",
        ANTHROPIC_AUTH_TOKEN: "Bearer example-token-1234567890",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.baseUrl).toBe("https://gateway.example.com");
    expect(result.apiKey).toBe("example-token-1234567890");
    expect(result.baseUrlPath).toBe("env.ANTHROPIC_BASE_URL");
    expect(result.apiKeyPath).toBe("env.ANTHROPIC_AUTH_TOKEN");
  });

  it("chooses higher-confidence gateway values without leaking unrelated URLs", () => {
    const result = findClaudeCodeGatewayConfig({
      homepage: "https://docs.example.com/install",
      providers: {
        gateway: {
          baseUrl: "https://gateway.example.com/v1",
          apiKey: "gateway-token-1234567890",
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.baseUrl).toBe("https://gateway.example.com");
    expect(result.apiKey).toBe("gateway-token-1234567890");
  });

  it("returns a safe miss when no gateway values are detected", () => {
    const result = findClaudeCodeGatewayConfig({ model: "claude-sonnet", count: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("No gateway URL or API token");
  });
});
