/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the Data Cloud Destination Pack and its runtime navigation guard. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  dataCloudDestinationRecords,
  getDataCloudDestination,
  isNavigable,
  navigableDataCloudDestinations,
} from "../lib/data-cloud-pack.ts";
import {
  isResolvedSalesforcePath,
  resolveSalesforcePath,
} from "../lib/salesforce-path-resolver.ts";

describe("data cloud destination pack", () => {
  it("only marks entries with a concrete path and verified status as navigable", () => {
    for (const record of dataCloudDestinationRecords()) {
      if (record.status === "verified") {
        expect(record.path.trim().length).toBeGreaterThan(0);
      }
      if (isNavigable(record)) {
        expect(record.status).toBe("verified");
        expect(record.path.startsWith("/")).toBe(true);
      }
    }
  });

  it("ships the grounded Data Cloud setup home as verified and navigable", () => {
    const home = getDataCloudDestination("setup-home");
    expect(home).toBeDefined();
    expect(home?.status).toBe("verified");
    expect(home?.path).toBe("/lightning/setup/CDPSetupHome/home");
    expect(navigableDataCloudDestinations()).toContain("setup-home");
  });

  it("keeps the org-specific app entry as a non-navigable candidate with a discovery hint", () => {
    const app = getDataCloudDestination("app");
    expect(app?.status).toBe("candidate");
    expect(app?.path).toBe("");
    expect(isNavigable(app!)).toBe(false);
    expect(app?.discoveryHint?.app).toBe("Audience360");
    expect(navigableDataCloudDestinations()).not.toContain("app");
  });

  it("exposes the discovered Data Cloud Settings menu nodes as verified portable paths", () => {
    const dataSpaces = getDataCloudDestination("data-spaces");
    expect(dataSpaces?.surface).toBe("setup-node");
    expect(dataSpaces?.status).toBe("verified");
    expect(dataSpaces?.path).toBe("/lightning/setup/CdpDataSpaces/home");
    expect(navigableDataCloudDestinations()).toContain("ingestion-api");
  });
});

describe("data-cloud route resolution", () => {
  it("resolves a verified entry to its Lightning path", () => {
    expect(
      resolveSalesforcePath({ route: { type: "data-cloud", destination: "setup-home" } }),
    ).toMatchObject({
      ok: true,
      path: "/lightning/setup/CDPSetupHome/home",
      kind: "data-cloud",
      destination: "setup-home",
    });
  });

  it("normalizes destination ids before lookup", () => {
    expect(
      resolveSalesforcePath({ route: { type: "data-cloud", destination: "Setup_Home" } }),
    ).toMatchObject({ ok: true, destination: "setup-home" });
  });

  it("refuses to navigate to candidate entries at runtime", () => {
    const result = resolveSalesforcePath({
      route: { type: "data-cloud", destination: "app" },
    });
    if (isResolvedSalesforcePath(result)) {
      throw new Error("expected candidate entry to be non-navigable");
    }
    expect(result.reason).toBe("unverified_data_cloud_destination");
  });

  it("rejects unknown destinations with a helpful message", () => {
    const result = resolveSalesforcePath({
      route: { type: "data-cloud", destination: "does-not-exist" },
    });
    if (isResolvedSalesforcePath(result)) {
      throw new Error("expected unknown destination to fail");
    }
    expect(result.reason).toBe("unknown_data_cloud_destination");
  });

  it("requires a destination value", () => {
    const result = resolveSalesforcePath({ route: { type: "data-cloud", destination: "" } });
    expect(result.ok).toBe(false);
  });
});

describe("data cloud destinations reference", () => {
  it("keeps the Markdown reference table in sync with the verified registry", () => {
    const markdown = readFileSync(
      path.resolve(__dirname, "../skills/sf-browser/references/data-cloud-destinations.md"),
      "utf8",
    );
    const documented = new Map<string, string>();
    for (const line of markdown.split(/\r?\n/)) {
      const match = line.match(/^\| `([^`]+)`\s+\| `([^`]+)`\s+\|/);
      if (match) documented.set(match[1] as string, match[2] as string);
    }

    const verified = dataCloudDestinationRecords().filter((r) => isNavigable(r));
    for (const record of verified) {
      expect(documented.get(record.id), `${record.id} is documented`).toBe(record.path);
    }
    expect([...documented.keys()].sort()).toEqual(verified.map((r) => r.id).sort());
  });
});
