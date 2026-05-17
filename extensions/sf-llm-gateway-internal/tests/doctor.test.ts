/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for gateway doctor interpretation and formatting. */
import { describe, expect, it } from "vitest";
import {
  aggregateFailureClass,
  classifyHttpResult,
  classifyThrownError,
  formatGatewayDoctorReport,
  interpretGatewayHttpResult,
  TLS_ERROR_FRAGMENTS,
} from "../lib/doctor.ts";

describe("interpretGatewayHttpResult", () => {
  it("recognizes authentication failures", () => {
    expect(interpretGatewayHttpResult(401, "Authentication Error, No api key passed in")).toContain(
      "Authentication failed",
    );
  });

  it("points blocked keys at /login instead of env or Keychain rotation", () => {
    expect(interpretGatewayHttpResult(401, "Authentication Error, Key is blocked")).toContain(
      "Run /login",
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
      openAiBaseUrl: "https://gateway.example.com/v1",
      anthropicRootUrl: "https://gateway.example.com",
      checks: [
        {
          name: "Model discovery",
          url: "https://gateway.example.com/v1/models",
          status: 200,
          ok: true,
          interpretation: "OK",
          failureClass: null,
        },
      ],
      recommendations: ["Gateway preflight passed."],
      failureClass: null,
    });

    expect(out).toContain("SF LLM Gateway Doctor");
    expect(out).toContain("OpenAI route: https://gateway.example.com/v1");
    expect(out).toContain("Claude/admin root: https://gateway.example.com");
    expect(out).toContain("Model discovery: OK (200)");
    expect(out).toContain("Gateway preflight passed.");
  });
});

describe("classifyThrownError", () => {
  it("classifies every TLS fragment as tls", () => {
    for (const fragment of TLS_ERROR_FRAGMENTS) {
      // Match runtime path: classifier lowercases input, fragments are
      // already lowercase, so feeding them in directly is faithful.
      expect(classifyThrownError(fragment)).toBe("tls");
    }
  });

  it("classifies the realistic Node-undici message that prompted this work", () => {
    expect(
      classifyThrownError(
        "TypeError: fetch failed\n  at node:internal/deps/undici/undici:13392:11",
      ),
    ).toBe("tls");
  });

  it("falls back to other for non-TLS thrown errors", () => {
    expect(classifyThrownError("AbortError: The operation was aborted")).toBe("other");
    expect(classifyThrownError("getaddrinfo ENOTFOUND gateway.example.com")).toBe("other");
  });
});

describe("classifyHttpResult", () => {
  it("maps 401 to auth", () => {
    expect(classifyHttpResult(401, "Authentication Error, No api key passed in")).toBe("auth");
  });

  it("maps SSO redirects to redirect", () => {
    expect(classifyHttpResult(302, "openid-connect/auth")).toBe("redirect");
    expect(classifyHttpResult(307, "")).toBe("redirect");
  });

  it("maps 5xx + 404 + 405 to other", () => {
    expect(classifyHttpResult(500, "")).toBe("other");
    expect(classifyHttpResult(404, "")).toBe("other");
    expect(classifyHttpResult(405, "")).toBe("other");
  });

  it("maps 2xx to null", () => {
    expect(classifyHttpResult(200, "{}")).toBe(null);
    expect(classifyHttpResult(204, "")).toBe(null);
  });
});

describe("aggregateFailureClass", () => {
  it("prefers tls over every other class so the splash nudge always wins on tls", () => {
    expect(aggregateFailureClass(["tls", "auth", "redirect", "other"])).toBe("tls");
    expect(aggregateFailureClass(["other", "tls"])).toBe("tls");
  });

  it("prefers auth over redirect/other when no tls is present", () => {
    expect(aggregateFailureClass(["auth", "redirect", "other"])).toBe("auth");
  });

  it("prefers redirect over other", () => {
    expect(aggregateFailureClass(["redirect", "other"])).toBe("redirect");
  });

  it("returns null when every check passed", () => {
    expect(aggregateFailureClass([null, null, null])).toBe(null);
  });
});
