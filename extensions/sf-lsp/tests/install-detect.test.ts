/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unit tests for `detectInstallReport`. Installed-version readers and
 * `java -version` exec are injected; upstream lookups are stubbed via
 * a fake fetch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectInstallReport } from "../lib/install/detect.ts";

const originalFetch = globalThis.fetch;

function stubFetch(impl: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    return impl(url);
  }) as typeof fetch;
}

function marketplaceOk(version: string): Response {
  return new Response(
    JSON.stringify({
      results: [
        {
          extensions: [
            {
              versions: [
                {
                  version,
                  files: [
                    {
                      assetType: "Microsoft.VisualStudio.Services.VSIXPackage",
                      source: "https://example.test/apex.vsix",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
    { status: 200 },
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("detectInstallReport", () => {
  it("flags missing components when nothing is installed", async () => {
    stubFetch((url) =>
      url.includes("marketplace")
        ? marketplaceOk("58.13.1")
        : new Response(JSON.stringify({ version: "4.12.3" }), { status: 200 }),
    );

    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 1 });
    const report = await detectInstallReport(exec, {
      platform: "darwin",
      readers: {
        readInstalledApexVersion: () => undefined,
        readInstalledLwcVersion: () => undefined,
      },
    });

    expect(report.hasActionable).toBe(true);
    expect(report.components.find((c) => c.id === "apex")?.state).toBe("missing");
    expect(report.components.find((c) => c.id === "lwc")?.state).toBe("missing");
  });

  it("flags outdated components when local lags upstream", async () => {
    stubFetch((url) =>
      url.includes("marketplace")
        ? marketplaceOk("58.13.1")
        : new Response(JSON.stringify({ version: "4.12.3" }), { status: 200 }),
    );

    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 1 });
    const report = await detectInstallReport(exec, {
      platform: "linux",
      readers: {
        readInstalledApexVersion: () => "58.0.0",
        readInstalledLwcVersion: () => "4.10.0",
      },
    });

    expect(report.hasActionable).toBe(true);
    expect(report.components.find((c) => c.id === "apex")?.state).toBe("outdated");
    expect(report.components.find((c) => c.id === "lwc")?.state).toBe("outdated");
  });

  it("reports current when local matches upstream", async () => {
    stubFetch((url) =>
      url.includes("marketplace")
        ? marketplaceOk("58.13.1")
        : new Response(JSON.stringify({ version: "4.12.3" }), { status: 200 }),
    );

    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 1 });
    const report = await detectInstallReport(exec, {
      platform: "darwin",
      readers: {
        readInstalledApexVersion: () => "58.13.1",
        readInstalledLwcVersion: () => "4.12.3",
      },
    });

    expect(report.hasActionable).toBe(false);
    expect(report.components.find((c) => c.id === "apex")?.state).toBe("current");
    expect(report.components.find((c) => c.id === "lwc")?.state).toBe("current");
  });

  it("marks Windows platform as manual for Apex + LWC", async () => {
    stubFetch(() => new Response("{}", { status: 500 }));

    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 1 });
    const report = await detectInstallReport(exec, {
      platform: "win32",
      readers: {
        readInstalledApexVersion: () => undefined,
        readInstalledLwcVersion: () => undefined,
      },
    });

    expect(report.platformManual).toBe(true);
    expect(report.components.find((c) => c.id === "apex")?.state).toBe("manual");
    expect(report.components.find((c) => c.id === "lwc")?.state).toBe("manual");
  });

  it("treats upstream lookup failures as unknown when nothing installed", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });

    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 1 });
    const report = await detectInstallReport(exec, {
      platform: "darwin",
      readers: {
        readInstalledApexVersion: () => undefined,
        readInstalledLwcVersion: () => undefined,
      },
    });

    expect(report.components.find((c) => c.id === "apex")?.state).toBe("unknown");
    expect(report.components.find((c) => c.id === "lwc")?.state).toBe("unknown");
    expect(report.hasActionable).toBe(false);
  });

  it("reports Java 17 as current", async () => {
    stubFetch(() => new Response("{}", { status: 500 }));

    const exec = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: 'openjdk version "17.0.1" 2021-10-19',
      code: 0,
    });
    const report = await detectInstallReport(exec, {
      platform: "darwin",
      readers: {
        readInstalledApexVersion: () => "58.13.1",
        readInstalledLwcVersion: () => "4.12.3",
      },
    });

    const java = report.components.find((c) => c.id === "java");
    expect(java?.state).toBe("current");
    expect(java?.installedVersion).toMatch(/^17\./);
  });

  it("marks Java as manual when missing even if Apex/LWC are current", async () => {
    stubFetch(() => new Response("{}", { status: 500 }));

    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 127 });
    const report = await detectInstallReport(exec, {
      platform: "darwin",
      readers: {
        readInstalledApexVersion: () => "58.13.1",
        readInstalledLwcVersion: () => "4.12.3",
      },
    });

    const java = report.components.find((c) => c.id === "java");
    expect(java?.state).toBe("manual");
  });
});
