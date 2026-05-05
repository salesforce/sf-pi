/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for the SSO onboarding deep-link builder. */
import { describe, expect, it } from "vitest";
import { buildOnboardingUrl, OnboardingTarget } from "../lib/onboarding.ts";

describe("buildOnboardingUrl", () => {
  it("returns an empty string when base URL is missing", () => {
    expect(buildOnboardingUrl(undefined)).toBe("");
    expect(buildOnboardingUrl("")).toBe("");
  });

  it("strips known deployment suffixes before building the URL", () => {
    // /v1, /bedrock, /bedrock/v1 all canonicalize to the gateway root.
    expect(buildOnboardingUrl("https://gateway.example.com/v1")).toBe(
      "https://gateway.example.com/oauth2/start?rd=/ui/?page=api-keys",
    );
    expect(buildOnboardingUrl("https://gateway.example.com/bedrock")).toBe(
      "https://gateway.example.com/oauth2/start?rd=/ui/?page=api-keys",
    );
  });

  it("defaults to the Virtual Keys tab", () => {
    const url = buildOnboardingUrl("https://gateway.example.com");
    expect(url).toContain("/oauth2/start");
    expect(url).toContain("rd=/ui/?page=api-keys");
  });

  it("honors an explicit target", () => {
    const url = buildOnboardingUrl("https://gateway.example.com", OnboardingTarget.ApiKeys);
    expect(url.endsWith("api-keys")).toBe(true);
  });
});
