/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior tests for explicit legacy Gateway-token cleanup. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  projectGatewayConfigPath,
  readGatewaySavedConfig,
  writeGatewaySavedConfig,
} from "../lib/config.ts";
import { hasLegacyGatewayToken, removeLegacyGatewayToken } from "../lib/legacy-token-migration.ts";

function fixture() {
  const cwd = mkdtempSync(path.join(tmpdir(), "sf-pi-m3a-legacy-token-"));
  const file = projectGatewayConfigPath(cwd);
  writeGatewaySavedConfig(file, {
    enabled: true,
    baseUrl: "https://gateway.example.test",
    apiKey: "legacy-private-value",
    exclusiveScope: true,
  });
  return { cwd, file };
}

describe("legacy Gateway token removal", () => {
  it("does nothing until native verification and explicit confirmation both pass", () => {
    const { cwd, file } = fixture();

    expect(
      removeLegacyGatewayToken({
        cwd,
        scope: "project",
        nativeVerified: false,
        confirmed: true,
      }).status,
    ).toBe("native-verification-required");
    expect(readGatewaySavedConfig(file).apiKey).toBe("legacy-private-value");

    expect(
      removeLegacyGatewayToken({
        cwd,
        scope: "project",
        nativeVerified: true,
        confirmed: false,
      }).status,
    ).toBe("confirmation-required");
    expect(readGatewaySavedConfig(file).apiKey).toBe("legacy-private-value");
  });

  it("removes only the legacy field after both gates pass", () => {
    const { cwd, file } = fixture();

    const result = removeLegacyGatewayToken({
      cwd,
      scope: "project",
      nativeVerified: true,
      confirmed: true,
    });

    expect(result.status).toBe("removed");
    expect(hasLegacyGatewayToken(cwd, "project")).toBe(false);
    expect(readGatewaySavedConfig(file)).toMatchObject({
      enabled: true,
      baseUrl: "https://gateway.example.test",
      exclusiveScope: true,
    });
    expect(readGatewaySavedConfig(file).apiKey).toBeUndefined();
  });
});
