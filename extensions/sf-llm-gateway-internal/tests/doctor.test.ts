/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for gateway doctor interpretation and formatting. */
import { describe, expect, it } from "vitest";
import { formatGatewayDoctorReport, interpretGatewayHttpResult } from "../lib/doctor.ts";

describe("interpretGatewayHttpResult", () => {
  it("recognizes authentication failures", () => {
    expect(interpretGatewayHttpResult(401, "Authentication Error, No api key passed in")).toContain(
      "Authentication failed",
    );
  });

  it("recognizes browser/SSO redirects", () => {
    expect(interpretGatewayHttpResult(302, "openid-connect/auth")).toContain(
      "interactive login route",
    );
  });

  it("recognizes model=v1 routing errors", () => {
    expect(interpretGatewayHttpResult(400, "Invalid model name passed in model=v1")).toContain(
      "Routing issue",
    );
  });

  it("treats 2xx as ok", () => {
    expect(interpretGatewayHttpResult(200, "{}")).toBe("OK");
  });
});

describe("formatGatewayDoctorReport", () => {
  it("renders routes, checks, and recommendations", () => {
    const out = formatGatewayDoctorReport({
      enabled: true,
      baseUrl: "https://gateway.example.com/bedrock",
      baseUrlSource: "saved",
      apiKeyPresent: true,
      apiKeyDescription: "sk-1…abcd (saved)",
      openAiBaseUrl: "https://gateway.example.com/bedrock/v1",
      anthropicRootUrl: "https://gateway.example.com",
      checks: [
        {
          name: "Model discovery",
          url: "https://gateway.example.com/bedrock/v1/models",
          status: 200,
          ok: true,
          interpretation: "OK",
        },
      ],
      recommendations: ["Gateway preflight passed."],
    });

    expect(out).toContain("SF LLM Gateway Doctor");
    expect(out).toContain("OpenAI route: https://gateway.example.com/bedrock/v1");
    expect(out).toContain("Claude/admin root: https://gateway.example.com");
    expect(out).toContain("Model discovery: OK (200)");
    expect(out).toContain("Gateway preflight passed.");
  });
});
