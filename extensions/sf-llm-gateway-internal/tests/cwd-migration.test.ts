/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the sf-llm-gateway-internal process.cwd() removal (0.68.0 breaking change).
 *
 * Covers:
 * - Extension factory body does NOT call process.cwd()
 * - session_start handler uses ctx.cwd for repair + discovery
 * - Lib function signatures require explicit cwd (no defaults)
 * - registerProviderIfConfigured allows optional cwd for factory bootstrap
 * - discoverAndRegister requires explicit cwd
 *
 * This is the most critical 0.68.0 migration: process.cwd() in the factory
 * used the launcher cwd, not the session cwd. After 0.68.0, Pi no longer
 * guarantees process.cwd() matches the session working directory.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const extensionDir = path.resolve(fileURLToPath(import.meta.url), "../..");

function readSource(file: string): string {
  return readFileSync(path.join(extensionDir, file), "utf-8");
}

// -------------------------------------------------------------------------------------------------
// Factory body: no process.cwd()
// -------------------------------------------------------------------------------------------------

describe("extension factory body", () => {
  const source = readSource("index.ts");

  it("does not call process.cwd() in the factory body", () => {
    // Extract the factory function body (between the export default and the first pi.on)
    // The factory body starts after "export default function" and before pi.registerMessageRenderer
    const factoryStart = source.indexOf("export default function");
    const firstEventHandler = source.indexOf('pi.on("session_start"');
    expect(factoryStart).toBeGreaterThan(-1);
    expect(firstEventHandler).toBeGreaterThan(-1);

    const factoryBody = source.slice(factoryStart, firstEventHandler);
    expect(factoryBody).not.toContain("process.cwd()");
  });

  it("uses registerProviderIfConfigured without cwd in the factory", () => {
    const factoryStart = source.indexOf("export default function");
    const firstEventHandler = source.indexOf('pi.on("session_start"');
    const factoryBody = source.slice(factoryStart, firstEventHandler);

    // The factory call should NOT pass process.cwd() as the cwd argument.
    // Beta state now lives in lib/beta-controls.ts so the factory reads it via
    // getBetaOverrides()/getBetaExtras() instead of in-file `runtime*` variables.
    expect(factoryBody).toContain(
      "registerProviderIfConfigured(pi, getBetaOverrides(), getBetaExtras())",
    );
  });
});

// -------------------------------------------------------------------------------------------------
// session_start handler: uses ctx.cwd
// -------------------------------------------------------------------------------------------------

describe("session_start handler", () => {
  const source = readSource("index.ts");

  it("calls repairGatewayEnabledModelSettings with ctx.cwd", () => {
    expect(source).toContain("repairGatewayEnabledModelSettings(ctx.cwd)");
  });

  it("calls repairGatewayDefaultModelSettings with ctx.cwd", () => {
    expect(source).toContain("repairGatewayDefaultModelSettings(ctx.cwd");
  });

  it("calls discoverAndRegister with ctx.cwd", () => {
    // session_start handler should pass ctx.cwd to discovery
    expect(source).toMatch(/discoverAndRegister\(pi,.*ctx\.cwd\)/);
  });
});

// -------------------------------------------------------------------------------------------------
// Lib function signatures: no process.cwd() defaults
// -------------------------------------------------------------------------------------------------

describe("lib function signatures", () => {
  it("getGatewayConfig requires explicit cwd (no default)", () => {
    const source = readSource("lib/config.ts");
    // Should have `cwd: string` not `cwd: string = process.cwd()`
    expect(source).toMatch(/getGatewayConfig\(cwd: string\)/);
    expect(source).not.toContain("getGatewayConfig(cwd: string = process.cwd())");
  });

  it("discoverAndRegister requires explicit cwd (no default)", () => {
    const source = readSource("lib/discovery.ts");
    // Should have `cwd: string,` not `cwd: string = process.cwd(),`
    expect(source).toMatch(/discoverAndRegister[\s\S]*?cwd: string,/);
    expect(source).not.toContain("cwd: string = process.cwd()");
  });

  it("refreshMonthlyUsage requires explicit cwd (no default)", () => {
    const source = readSource("lib/monthly-usage.ts");
    // After prettier formatting, the signature is on one line: (force: boolean, cwd: string)
    expect(source).toContain("cwd: string");
    expect(source).not.toContain("cwd: string = process.cwd()");
    expect(source).not.toContain("process.cwd()");
  });

  it("registerProviderIfConfigured accepts optional cwd", () => {
    const source = readSource("lib/discovery.ts");
    // Should have `cwd?: string` — optional for factory bootstrap
    expect(source).toMatch(/registerProviderIfConfigured[\s\S]*?cwd\?: string/);
  });
});

// -------------------------------------------------------------------------------------------------
// Setup overlay: no process.cwd()
// -------------------------------------------------------------------------------------------------

describe("setup overlay process.cwd() removal", () => {
  it("GatewaySetupOverlayComponent accepts cwd as a constructor parameter", () => {
    const source = readSource("lib/setup-overlay.ts");
    // cwd is forwarded into the inner config panel rather than stored as a
    // field; the contract is just that the overlay accepts a cwd from its
    // caller instead of calling process.cwd() itself.
    expect(source).toMatch(/GatewaySetupOverlayComponent[\s\S]*?constructor\([\s\S]*?cwd: string/);
  });

  it("setup overlay does not call process.cwd()", () => {
    const source = readSource("lib/setup-overlay.ts");
    expect(source).not.toContain("process.cwd()");
  });

  it("the overlay is constructed with ctx.cwd from the command handler", () => {
    const source = readSource("index.ts");
    expect(source).toContain("GatewaySetupOverlayComponent(theme, scope, ctx.cwd");
  });
});

// -------------------------------------------------------------------------------------------------
// getGlobalOnlyGatewayConfig exists for factory fallback
// -------------------------------------------------------------------------------------------------

describe("getGlobalOnlyGatewayConfig factory fallback", () => {
  it("is exported from config.ts", () => {
    const source = readSource("lib/config.ts");
    expect(source).toContain("export function getGlobalOnlyGatewayConfig");
  });

  it("is imported and used in discovery.ts", () => {
    const source = readSource("lib/discovery.ts");
    expect(source).toContain("getGlobalOnlyGatewayConfig");
  });
});
