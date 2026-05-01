/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke test for the unified single-provider registration.
 *
 * Asserts that:
 *   - exactly one provider is registered
 *   - the provider declares a friendly `name` for pi >= 0.71 `/login`
 *   - the provider declares an `oauth` block for paste-token login
 *   - registered models do not carry per-model `api` overrides, because pi
 *     would otherwise bypass the provider-level streamSimple dispatcher. The
 *     dispatcher routes Claude to anthropic-messages by model id internally.
 */
import { describe, expect, it } from "vitest";
import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { registerProviderIfConfigured } from "../lib/discovery.ts";
import { PROVIDER_NAME } from "../lib/config.ts";

interface CapturedRegistration {
  name: string;
  config: {
    name?: string;
    baseUrl?: string;
    api?: string;
    models?: ProviderModelConfig[];
    oauth?: { name?: string };
    streamSimple?: unknown;
  };
}

function makeFakePi(captured: CapturedRegistration[]) {
  return {
    registerProvider(name: string, config: CapturedRegistration["config"]) {
      captured.push({ name, config });
    },
    unregisterProvider(_name: string) {
      // no-op
    },
  };
}

describe("unified gateway provider", () => {
  it("registers exactly one provider with friendly name and oauth block", () => {
    const originalBaseUrl = process.env.SF_LLM_GATEWAY_INTERNAL_BASE_URL;
    const originalApiKey = process.env.SF_LLM_GATEWAY_INTERNAL_API_KEY;
    process.env.SF_LLM_GATEWAY_INTERNAL_BASE_URL = "https://gateway.test";
    process.env.SF_LLM_GATEWAY_INTERNAL_API_KEY = "test-key";

    try {
      const captured: CapturedRegistration[] = [];

      registerProviderIfConfigured(makeFakePi(captured) as any, null, new Set());

      expect(captured).toHaveLength(1);
      const only = captured[0];
      expect(only.name).toBe(PROVIDER_NAME);
      expect(only.config.name).toBe("SF LLM Gateway (Salesforce Internal)");
      expect(only.config.api).toBe("openai-completions");
      expect(only.config.oauth).toBeDefined();
      expect(only.config.oauth?.name).toBe("SF LLM Gateway (Salesforce Internal)");
      expect(typeof only.config.streamSimple).toBe("function");
    } finally {
      // Restore original env state so other suites are not affected.
      restoreEnv("SF_LLM_GATEWAY_INTERNAL_BASE_URL", originalBaseUrl);
      restoreEnv("SF_LLM_GATEWAY_INTERNAL_API_KEY", originalApiKey);
    }
  });

  it("keeps model api overrides out of Pi's registry so streamSimple handles every model", () => {
    const originalBaseUrl = process.env.SF_LLM_GATEWAY_INTERNAL_BASE_URL;
    const originalApiKey = process.env.SF_LLM_GATEWAY_INTERNAL_API_KEY;
    process.env.SF_LLM_GATEWAY_INTERNAL_BASE_URL = "https://gateway.test";
    process.env.SF_LLM_GATEWAY_INTERNAL_API_KEY = "test-key";

    try {
      const captured: CapturedRegistration[] = [];

      registerProviderIfConfigured(makeFakePi(captured) as any, null, new Set());

      const models = captured[0]?.config.models ?? [];
      expect(models.length).toBeGreaterThan(0);

      const claude = models.find((m) => m.id.startsWith("claude-"));
      expect(claude).toBeDefined();
      expect(claude?.api).toBeUndefined();
      expect(models.every((model) => model.api === undefined)).toBe(true);
    } finally {
      restoreEnv("SF_LLM_GATEWAY_INTERNAL_BASE_URL", originalBaseUrl);
      restoreEnv("SF_LLM_GATEWAY_INTERNAL_API_KEY", originalApiKey);
    }
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
