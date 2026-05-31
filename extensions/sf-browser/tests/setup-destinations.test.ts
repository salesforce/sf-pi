/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for curated Salesforce Setup destinations. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatKnownSetupDestinations,
  getSetupDestination,
  knownSetupDestinationRecords,
  resolveSetupDestination,
} from "../lib/setup-destinations.ts";
import { resolveOpenPath } from "../lib/salesforce-open.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("setup destinations", () => {
  it("resolves curated setup destinations", () => {
    expect(resolveSetupDestination("agentforce-agents")).toBe(
      "/lightning/setup/EinsteinCopilot/home",
    );
    expect(resolveSetupDestination("object_manager")).toBe("/lightning/setup/ObjectManager/home");
    expect(resolveSetupDestination("data cloud setup")).toBe("/lightning/setup/CDPSetupHome/home");
    expect(resolveSetupDestination("external-client-apps")).toBe(
      "/lightning/setup/ManageExternalClientApplication/home",
    );
    expect(resolveSetupDestination("permission set groups")).toBe(
      "/lightning/setup/PermSetGroups/home",
    );
    expect(resolveSetupDestination("named-credentials")).toBe(
      "/lightning/setup/NamedCredential/home",
    );
    expect(resolveSetupDestination("single sign on settings")).toBe(
      "/lightning/setup/SingleSignOn/home",
    );
  });

  it("rejects combining setup and path", () => {
    expect(() =>
      resolveOpenPath({ setup: "setup-home", path: "/lightning/setup/Flows/home" }),
    ).toThrow("Pass exactly one of path, setup, or route");
  });

  it("lists known destinations for unknown setup names", () => {
    expect(() => resolveOpenPath({ setup: "not-a-real-page" })).toThrow(
      formatKnownSetupDestinations(),
    );
  });

  it("keeps agent navigation metadata with each destination", () => {
    const destination = getSetupDestination("permission sets");

    expect(destination?.label).toBe("Permission Sets");
    expect(destination?.suggestedWait).toEqual({ lightning: "navigation-ready" });
    expect(destination?.defaultFocus).toContain("Manage Assignments");
    expect(destination?.runbookRefs.length).toBeGreaterThan(0);
  });

  it("keeps the Markdown reference table in sync with the runtime registry", () => {
    const markdown = readFileSync(
      path.resolve(__dirname, "../skills/sf-browser/references/setup-destinations.md"),
      "utf8",
    );
    const documented = new Map<string, string>();
    for (const line of markdown.split(/\r?\n/)) {
      const match = line.match(/^\| `([^`]+)`\s+\| `([^`]+)`\s+\|/);
      if (match) documented.set(match[1] as string, match[2] as string);
    }

    const registry = knownSetupDestinationRecords();
    for (const destination of registry) {
      expect(documented.get(destination.id), `${destination.id} is documented`).toBe(
        destination.path,
      );
    }
    expect([...documented.keys()].sort()).toEqual(registry.map((destination) => destination.id));
  });
});
