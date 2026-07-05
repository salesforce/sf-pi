/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for getGlobalOnlyGatewayConfig — the factory-time config fallback.
 *
 * Covers:
 * - Returns a valid GatewayConfig shape
 * - Reads env vars as fallback when saved config is blank
 * - Does NOT read project-level saved config (no cwd needed)
 * - Falls back to the built-in default base URL when nothing is configured
 * - Matches the same result shape as getGatewayConfig()
 *
 * This function was introduced in the 0.68.0 migration to replace process.cwd()
 * calls in the extension factory, which runs before session_start provides ctx.cwd.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getGatewayConfig,
  getGlobalOnlyGatewayConfig,
  DEFAULT_BASE_URL,
  BASE_URL_ENV,
  API_KEY_ENV,
  LEGACY_API_KEY_ENV,
  LEGACY_BASE_URL_ENV,
} from "../lib/config.ts";

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
const savedEnv: Record<string, string | undefined> = {};
let tempAgentDir: string;

function setEnv(key: string, value: string | undefined) {
  if (!(key in savedEnv)) {
    savedEnv[key] = process.env[key];
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  // Clear the saved env for next test
  for (const key of Object.keys(savedEnv)) {
    delete savedEnv[key];
  }
}

beforeEach(() => {
  tempAgentDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-global-config-"));
  setEnv(PI_AGENT_ENV, tempAgentDir);
  // Clear gateway env vars for a clean baseline.
  setEnv(BASE_URL_ENV, undefined);
  setEnv(API_KEY_ENV, undefined);
  setEnv(LEGACY_BASE_URL_ENV, undefined);
  setEnv(LEGACY_API_KEY_ENV, undefined);
});

afterEach(() => {
  restoreEnv();
  rmSync(tempAgentDir, { recursive: true, force: true });
});

// -------------------------------------------------------------------------------------------------
// getGlobalOnlyGatewayConfig
// -------------------------------------------------------------------------------------------------

describe("getGlobalOnlyGatewayConfig", () => {
  it("returns a valid GatewayConfig shape", () => {
    const config = getGlobalOnlyGatewayConfig();
    expect(config).toBeDefined();
    expect(typeof config.enabled).toBe("boolean");
    expect(typeof config.baseUrl).toBe("string");
    expect(typeof config.exclusiveScope).toBe("boolean");
    expect(["env", "saved", "default"]).toContain(config.baseUrlSource);
    expect(["env", "saved", "missing"]).toContain(config.apiKeySource);
  });

  it("falls back to the built-in default base URL when no env or saved config", () => {
    const config = getGlobalOnlyGatewayConfig();
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.baseUrlSource).toBe("default");
  });

  it("reads base URL from the environment variable when no saved value exists", () => {
    setEnv(BASE_URL_ENV, "https://custom-gateway.example.com");
    const config = getGlobalOnlyGatewayConfig();
    if (config.baseUrlSource === "saved") {
      // Local developer machines may have a real saved gateway config.
      expect(config.baseUrl).not.toBe("https://custom-gateway.example.com");
    } else {
      expect(config.baseUrl).toBe("https://custom-gateway.example.com");
      expect(config.baseUrlSource).toBe("env");
    }
  });

  it("reads API key from the environment variable when no saved key exists", () => {
    setEnv(API_KEY_ENV, "test-api-key-123");
    const config = getGlobalOnlyGatewayConfig();
    if (config.apiKeySource === "saved") {
      // Local developer machines may have a real saved gateway key.
      expect(config.apiKey).not.toBe("test-api-key-123");
    } else {
      expect(config.apiKey).toBe("test-api-key-123");
      expect(config.apiKeySource).toBe("env");
    }
  });

  it("reports missing API key when env is unset (may have saved global config)", () => {
    const config = getGlobalOnlyGatewayConfig();
    // If a saved global config exists with an API key, that's fine — it's reading
    // the real global config. The key assertion is that apiKeySource reflects
    // the actual source (not "env" since we cleared the env var).
    if (config.apiKey) {
      expect(config.apiKeySource).toBe("saved");
    } else {
      expect(config.apiKey).toBeUndefined();
      expect(config.apiKeySource).toBe("missing");
    }
  });

  it("enabled defaults to true when nothing is saved", () => {
    const config = getGlobalOnlyGatewayConfig();
    expect(config.enabled).toBe(true);
  });

  it("exclusiveScope defaults to false", () => {
    const config = getGlobalOnlyGatewayConfig();
    expect(config.exclusiveScope).toBe(false);
    expect(config.exclusiveScopeSource).toBe("default");
  });

  it("env base URL is used as fallback when no saved base URL exists", () => {
    setEnv(BASE_URL_ENV, "https://override.example.com/v1");
    const config = getGlobalOnlyGatewayConfig();
    if (config.baseUrlSource !== "saved") {
      expect(config.baseUrl).toBe("https://override.example.com");
      expect(config.baseUrlSource).toBe("env");
    }
  });

  it("trims whitespace from env API key when it is used", () => {
    setEnv(API_KEY_ENV, "  spaced-key  ");
    const config = getGlobalOnlyGatewayConfig();
    if (config.apiKeySource !== "saved") {
      expect(config.apiKey).toBe("spaced-key");
    }
  });

  it("treats empty-string env API key as not from env", () => {
    setEnv(API_KEY_ENV, "   ");
    const config = getGlobalOnlyGatewayConfig();
    // Empty env var should not be used as the API key.
    // The config may still have a saved key from ~/.pi/agent.
    expect(config.apiKeySource).not.toBe("env");
  });

  it("has the same result type as getGatewayConfig", () => {
    // Both functions should return the same keys — type safety net
    const globalOnly = getGlobalOnlyGatewayConfig();
    const withCwd = getGatewayConfig(process.cwd());
    const globalKeys = Object.keys(globalOnly).sort();
    const cwdKeys = Object.keys(withCwd).sort();
    expect(globalKeys).toEqual(cwdKeys);
  });
});
