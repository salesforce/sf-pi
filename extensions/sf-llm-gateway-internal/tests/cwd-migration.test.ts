/* SPDX-License-Identifier: Apache-2.0 */
/** Secondary source guards for explicit session-cwd ownership. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const extensionDir = path.resolve(fileURLToPath(import.meta.url), "../..");

function readSource(file: string): string {
  return readFileSync(path.join(extensionDir, file), "utf8");
}

describe("Gateway session cwd guards", () => {
  const indexSource = readSource("index.ts");

  it("registers the complete Provider without consulting process.cwd()", () => {
    const factoryStart = indexSource.indexOf("export default function");
    const firstEventHandler = indexSource.indexOf('pi.on("session_start"');
    const factoryBody = indexSource.slice(factoryStart, firstEventHandler);

    expect(factoryBody).toContain("pi.registerProvider(gatewayProviderRuntime.provider)");
    expect(factoryBody).not.toContain("process.cwd()");
  });

  it("binds the complete Provider to the active session cwd", () => {
    expect(indexSource).toContain(
      "gatewayProviderRuntime.bind(ctx.cwd, ctx.ui, ctx.mode, ctx.modelRegistry)",
    );
    expect(indexSource).toContain("repairGatewayEnabledModelSettings(ctx.cwd)");
    expect(indexSource).toContain("repairGatewayDefaultModelSettings(ctx.cwd");
  });

  it("keeps config and monthly usage APIs explicit about cwd", () => {
    const configSource = readSource("lib/config.ts");
    const usageSource = readSource("lib/monthly-usage.ts");

    expect(configSource).toMatch(/getGatewayConfig\(cwd: string\)/u);
    expect(configSource).not.toContain("getGatewayConfig(cwd: string = process.cwd())");
    expect(usageSource).toContain("cwd: string");
    expect(usageSource).not.toContain("cwd: string = process.cwd()");
    expect(usageSource).not.toContain("process.cwd()");
  });

  it("passes command cwd into the setup overlay", () => {
    const setupSource = readSource("lib/setup-overlay.ts");
    expect(setupSource).toMatch(
      /GatewaySetupOverlayComponent[\s\S]*?constructor\([\s\S]*?cwd: string/u,
    );
    expect(setupSource).not.toContain("process.cwd()");
    expect(indexSource).toContain("GatewaySetupOverlayComponent(theme, scope, ctx.cwd");
  });
});
