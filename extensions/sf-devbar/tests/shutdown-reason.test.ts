/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for session_shutdown reason awareness across extensions.
 *
 * Covers:
 * - sf-devbar: skips teardown on reload
 * - sf-lsp: skips LSP shutdown on reload
 * - sf-skills-hud: preserves state on reload
 *
 * These are source-level contract tests that verify the extensions read the
 * `event.reason` field from SessionShutdownEvent (added in 0.68.0) and use
 * it to optimize their shutdown paths. The runtime behavior is tested via
 * manual QA — these tests verify the contract is wired correctly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const extensionsDir = path.resolve(fileURLToPath(import.meta.url), "../../..");

function readExtensionSource(extensionId: string, file = "index.ts"): string {
  return readFileSync(path.join(extensionsDir, extensionId, file), "utf-8");
}

// -------------------------------------------------------------------------------------------------
// sf-devbar session_shutdown reason
// -------------------------------------------------------------------------------------------------

describe("sf-devbar session_shutdown reason", () => {
  const source = readExtensionSource("sf-devbar");

  it("reads event.reason in session_shutdown handler", () => {
    // Must destructure or read the event parameter, not ignore it with _event
    expect(source).toMatch(/pi\.on\("session_shutdown",\s*async\s*\(event/);
  });

  it("skips teardown on reload", () => {
    expect(source).toContain('event.reason === "reload"');
  });

  it("still cleans up footer and widget on non-reload shutdown", () => {
    expect(source).toContain("setFooter(undefined)");
    expect(source).toContain("setWidget(WIDGET_KEY, undefined)");
  });
});

// -------------------------------------------------------------------------------------------------
// sf-lsp session_shutdown reason
// -------------------------------------------------------------------------------------------------

describe("sf-lsp session_shutdown reason", () => {
  const source = readExtensionSource("sf-lsp");

  it("reads event.reason in session_shutdown handler", () => {
    expect(source).toMatch(/pi\.on\("session_shutdown",\s*async\s*\(event/);
  });

  it("skips LSP server shutdown on reload", () => {
    expect(source).toContain('event.reason !== "reload"');
  });

  it("still resets state on all shutdown paths", () => {
    // resetState should be called unconditionally
    expect(source).toContain("resetState(state)");
  });
});

// -------------------------------------------------------------------------------------------------
// sf-skills-hud session_shutdown reason
// -------------------------------------------------------------------------------------------------

describe("sf-skills-hud session_shutdown reason", () => {
  const source = readExtensionSource("sf-skills-hud");

  it("reads event.reason in session_shutdown handler", () => {
    expect(source).toMatch(/pi\.on\("session_shutdown",\s*async\s*\(event/);
  });

  it("preserves HUD state on reload", () => {
    expect(source).toContain('event.reason !== "reload"');
  });

  it("still dismisses overlay on all shutdown paths", () => {
    // dismissOverlay should be called unconditionally
    expect(source).toContain("dismissOverlay()");
  });
});

// -------------------------------------------------------------------------------------------------
// Status cleanup on shutdown
// -------------------------------------------------------------------------------------------------

describe("sf-slack session_shutdown cleanup", () => {
  const source = readExtensionSource("sf-slack");

  it("registers a session_shutdown handler", () => {
    expect(source).toMatch(/pi\.on\("session_shutdown",\s*async\s*\(_event,\s*ctx\)/);
  });

  it("clears the Slack footer status", () => {
    expect(source).toContain("setStatus(WIDGET_KEY, undefined)");
  });
});

describe("sf-pi-manager session_shutdown cleanup", () => {
  const source = readExtensionSource("sf-pi-manager");

  it("registers a session_shutdown handler", () => {
    expect(source).toMatch(/pi\.on\("session_shutdown",\s*async\s*\(_event,\s*ctx\)/);
  });

  it("clears the manager footer status", () => {
    expect(source).toContain("setStatus(STATUS_KEY, undefined)");
  });
});

describe("sf-llm-gateway-internal session_shutdown cleanup", () => {
  const source = readExtensionSource("sf-llm-gateway-internal");

  it("registers a session_shutdown handler", () => {
    expect(source).toMatch(/pi\.on\("session_shutdown",\s*async\s*\(_event,\s*ctx\)/);
  });

  it("clears the gateway footer status", () => {
    expect(source).toContain("setStatus(STATUS_KEY, undefined)");
  });
});
