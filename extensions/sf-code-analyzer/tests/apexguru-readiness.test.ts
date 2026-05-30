/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  return { ...actual, getAgentDir: () => tempAgentDir };
});

vi.mock("../lib/apexguru.ts", () => ({
  validateApexGuru: vi.fn(),
}));

describe("ApexGuru readiness", () => {
  beforeEach(() => {
    tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-code-analyzer-apexguru-"));
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tempAgentDir, { recursive: true, force: true });
  });

  it("stores readiness by org/user/instance/api tuple", async () => {
    const apex = await import("../lib/apexguru.ts");
    const readiness = await import("../lib/apexguru-readiness.ts");
    vi.mocked(apex.validateApexGuru)
      .mockResolvedValueOnce({
        access: "enabled",
        message: "enabled A",
        orgId: "00D1",
        userId: "0051",
        instanceUrl: "https://example.my.salesforce.com",
        apiVersion: "67.0",
      })
      .mockResolvedValueOnce({
        access: "ineligible",
        message: "no B",
        orgId: "00D1",
        userId: "0052",
        instanceUrl: "https://example.my.salesforce.com",
        apiVersion: "67.0",
      });

    await readiness.refreshApexGuruReadiness("a");
    await readiness.refreshApexGuruReadiness("b");

    const state = readiness.readApexGuruReadinessState();
    expect(Object.keys(state.entries)).toHaveLength(2);
    expect(
      readiness.readApexGuruReadinessForKey({
        orgId: "00D1",
        userId: "0051",
        instanceUrl: "https://example.my.salesforce.com",
        apiVersion: "67.0",
      }).access,
    ).toBe("enabled");
    expect(readiness.readApexGuruReadiness().access).toBe("ineligible");
  });
});
