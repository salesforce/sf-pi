/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the per-extension doctor registry.
 *
 * Coverage:
 *   - registration / re-registration / unregistration
 *   - successful provider returns
 *   - thrown provider returns "error"
 *   - timed-out provider returns "timeout" without blocking the rest
 *   - results are sorted by extensionId for stable render order
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  getRegisteredDoctors,
  registerExtensionDoctor,
  resetExtensionDoctorRegistry,
  runRegisteredDoctors,
  type ExtensionDoctorReport,
} from "../registry.ts";

afterEach(() => {
  resetExtensionDoctorRegistry();
});

function buildReport(extensionId: string, severity: "ok" | "warn" = "ok"): ExtensionDoctorReport {
  return {
    extensionId,
    title: extensionId,
    checks: [
      {
        id: `${extensionId}.basic`,
        severity,
        title: `${extensionId} basic check`,
        detail: "All good",
      },
    ],
    summary: severity === "ok" ? "✓" : "!",
  };
}

describe("doctor registry", () => {
  it("returns an empty list when no providers are registered", () => {
    expect(getRegisteredDoctors()).toEqual([]);
  });

  it("registers and lists providers sorted by extensionId", () => {
    registerExtensionDoctor("sf-zeta", async () => buildReport("sf-zeta"));
    registerExtensionDoctor("sf-alpha", async () => buildReport("sf-alpha"));
    expect(getRegisteredDoctors().map((d) => d.extensionId)).toEqual(["sf-alpha", "sf-zeta"]);
  });

  it("replaces a provider when the same id registers twice (post-reload behavior)", () => {
    const first = async () => buildReport("sf-foo", "warn");
    const second = async () => buildReport("sf-foo", "ok");
    registerExtensionDoctor("sf-foo", first);
    registerExtensionDoctor("sf-foo", second);
    const providers = getRegisteredDoctors();
    expect(providers).toHaveLength(1);
    expect(providers[0]!.provider).toBe(second);
  });

  it("unregister callback only removes the matching provider", () => {
    const first = async () => buildReport("sf-foo");
    const unregister = registerExtensionDoctor("sf-foo", first);
    const second = async () => buildReport("sf-foo");
    registerExtensionDoctor("sf-foo", second); // overwrites first
    unregister(); // first is no longer the registered provider
    expect(getRegisteredDoctors()).toHaveLength(1);
    expect(getRegisteredDoctors()[0]!.provider).toBe(second);
  });

  it("runs registered providers and returns ok outcomes", async () => {
    registerExtensionDoctor("sf-alpha", async () => buildReport("sf-alpha"));
    registerExtensionDoctor("sf-beta", async () => buildReport("sf-beta", "warn"));
    const outcomes = await runRegisteredDoctors({ cwd: "/tmp" });
    expect(outcomes.map((o) => o.extensionId)).toEqual(["sf-alpha", "sf-beta"]);
    expect(outcomes.every((o) => o.status === "ok")).toBe(true);
    expect(outcomes[0]!.report?.title).toBe("sf-alpha");
    expect(outcomes[0]!.report?.durationMs).toBeTypeOf("number");
  });

  it("captures provider exceptions as 'error' without blocking the rest", async () => {
    registerExtensionDoctor("sf-good", async () => buildReport("sf-good"));
    registerExtensionDoctor("sf-bad", async () => {
      throw new Error("kaboom");
    });
    const outcomes = await runRegisteredDoctors({ cwd: "/tmp" });
    const bad = outcomes.find((o) => o.extensionId === "sf-bad")!;
    const good = outcomes.find((o) => o.extensionId === "sf-good")!;
    expect(bad.status).toBe("error");
    expect(bad.error).toBe("kaboom");
    expect(good.status).toBe("ok");
  });

  it("flags slow providers as 'timeout' and aborts their signal", async () => {
    let abortFired = false;
    registerExtensionDoctor("sf-slow", async (_cwd, signal) => {
      signal?.addEventListener("abort", () => {
        abortFired = true;
      });
      return new Promise<ExtensionDoctorReport>((resolve) => {
        setTimeout(() => resolve(buildReport("sf-slow")), 1_000);
      });
    });
    registerExtensionDoctor("sf-fast", async () => buildReport("sf-fast"));

    const outcomes = await runRegisteredDoctors({ cwd: "/tmp", timeoutMs: 30 });
    const slow = outcomes.find((o) => o.extensionId === "sf-slow")!;
    const fast = outcomes.find((o) => o.extensionId === "sf-fast")!;
    expect(slow.status).toBe("timeout");
    expect(slow.report).toBeUndefined();
    expect(fast.status).toBe("ok");
    expect(abortFired).toBe(true);
  });
});
