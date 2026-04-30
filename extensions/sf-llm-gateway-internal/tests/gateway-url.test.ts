/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for gateway root vs OpenAI-compatible endpoint normalization. */
import { describe, expect, it } from "vitest";
import { toGatewayOpenAiBaseUrl, toGatewayRootBaseUrl } from "../lib/gateway-url.ts";

describe("gateway URL normalization", () => {
  it("adds /v1 for OpenAI-compatible routes when the configured URL is the gateway root", () => {
    expect(toGatewayOpenAiBaseUrl("https://gateway.example.com")).toBe(
      "https://gateway.example.com/v1",
    );
  });

  it("keeps /v1 for OpenAI-compatible routes when the configured URL already includes it", () => {
    expect(toGatewayOpenAiBaseUrl("https://gateway.example.com/v1/ ")).toBe(
      "https://gateway.example.com/v1",
    );
  });

  it("strips /v1 for gateway admin routes", () => {
    expect(toGatewayRootBaseUrl("https://gateway.example.com/v1")).toBe(
      "https://gateway.example.com",
    );
  });

  it("keeps root URLs unchanged for gateway admin routes", () => {
    expect(toGatewayRootBaseUrl("https://gateway.example.com/")).toBe(
      "https://gateway.example.com",
    );
  });
});
