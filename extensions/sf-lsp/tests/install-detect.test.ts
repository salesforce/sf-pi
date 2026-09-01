/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unit tests for `detectInstallReport`. Installed-version readers and
 * `java -version` exec are injected; upstream lookups are stubbed via
 * a fake fetch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectInstallReport, detectJavaVersion } from "../lib/install/detect.ts";

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

/**
 * Build a fake `ExecFn` keyed by the exact command. Unmatched commands return
 * the fallback (default: not-found, code 127).
 */
function javaExec(
  map: Record<string, { stdout?: string; stderr?: string; code?: number }>,
  fallback: { stdout?: string; stderr?: string; code?: number } = {
    stdout: "",
    stderr: "command not found",
    code: 127,
  },
) {
  return vi.fn(async (command: string) => {
    for (const [key, value] of Object.entries(map)) {
      if (command === key) {
        return { stdout: value.stdout ?? "", stderr: value.stderr ?? "", code: value.code ?? 0 };
      }
    }
    return {
      stdout: fallback.stdout ?? "",
      stderr: fallback.stderr ?? "",
      code: fallback.code ?? 127,
    };
  });
}

const OPENJDK17 = { stderr: 'openjdk version "17.0.1" 2021-10-19', code: 0 };
const MAC_JAVA_HOME = "/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home";
const MAC_JAVA = `${MAC_JAVA_HOME}/bin/java`;

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

    // On macOS the probe resolves the JDK via `/usr/libexec/java_home`, then
    // runs the absolute `<home>/bin/java` — never the PATH placeholder.
    const exec = javaExec({
      "/usr/libexec/java_home": {
        stdout: `${MAC_JAVA_HOME}\n`,
        code: 0,
      },
      [MAC_JAVA]: OPENJDK17,
    });
    const report = await detectInstallReport(exec, {
      platform: "darwin",
      env: {},
      readers: {
        readInstalledApexVersion: () => "58.13.1",
        readInstalledLwcVersion: () => "4.12.3",
      },
    });

    const java = report.components.find((c) => c.id === "java");
    expect(java?.state).toBe("current");
    expect(java?.installedVersion).toMatch(/^17\./);
  });

  it("treats VS Code-provided LSP servers as current", async () => {
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
      doctor: [
        {
          language: "apex",
          available: true,
          source: "vscode",
          detail:
            "/Users/x/.vscode/extensions/salesforce.salesforcedx-vscode-apex-58.13.1/dist/apex-jorje-lsp.jar",
        },
        {
          language: "lwc",
          available: true,
          source: "path",
          detail: "/usr/local/bin/lwc-language-server",
        },
      ],
    });

    expect(report.hasActionable).toBe(false);
    expect(report.components.find((c) => c.id === "apex")?.state).toBe("current");
    expect(report.components.find((c) => c.id === "apex")?.detail).toMatch(/VS Code extension/);
    expect(report.components.find((c) => c.id === "lwc")?.state).toBe("current");
    expect(report.components.find((c) => c.id === "lwc")?.detail).toMatch(/PATH/);
  });

  it("still prompts when only the managed install is outdated (pi-global source)", async () => {
    stubFetch((url) =>
      url.includes("marketplace")
        ? marketplaceOk("58.13.1")
        : new Response(JSON.stringify({ version: "4.12.3" }), { status: 200 }),
    );

    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 1 });
    const report = await detectInstallReport(exec, {
      platform: "darwin",
      readers: {
        readInstalledApexVersion: () => "58.0.0",
        readInstalledLwcVersion: () => "4.10.0",
      },
      doctor: [
        { language: "apex", available: true, source: "pi-global", detail: "..." },
        { language: "lwc", available: true, source: "pi-global", detail: "..." },
      ],
    });

    expect(report.hasActionable).toBe(true);
    expect(report.components.find((c) => c.id === "apex")?.state).toBe("outdated");
    expect(report.components.find((c) => c.id === "lwc")?.state).toBe("outdated");
  });

  it("marks Java as manual when missing even if Apex/LWC are current", async () => {
    stubFetch(() => new Response("{}", { status: 500 }));

    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 127 });
    const report = await detectInstallReport(exec, {
      platform: "darwin",
      env: {},
      readers: {
        readInstalledApexVersion: () => "58.13.1",
        readInstalledLwcVersion: () => "4.12.3",
      },
    });

    const java = report.components.find((c) => c.id === "java");
    expect(java?.state).toBe("manual");
    expect(java?.detail).toBe(
      "No Java 11+ JDK resolved. Set SF_LSP_JAVA or JAVA_HOME, or install OpenJDK.",
    );
  });
});

describe("detectJavaVersion", () => {
  it("prefers the explicit SF_LSP_JAVA override", async () => {
    const exec = javaExec({
      "/configured/java": OPENJDK17,
      "/opt/jdk17/bin/java": { stderr: 'openjdk version "21.0.1"', code: 0 },
    });

    const version = await detectJavaVersion(exec, {
      platform: "darwin",
      env: { SF_LSP_JAVA: " /configured/java ", JAVA_HOME: "/opt/jdk17" },
    });

    expect(version).toBe("17.0.1");
    expect(exec.mock.calls.map((call) => call[0])).toEqual(["/configured/java"]);
  });

  it("uses JAVA_HOME and never runs java_home or the PATH placeholder", async () => {
    const exec = javaExec({ "/opt/jdk17/bin/java": OPENJDK17 });

    const version = await detectJavaVersion(exec, {
      platform: "darwin",
      env: { JAVA_HOME: "/opt/jdk17" },
    });

    expect(version).toBe("17.0.1");
    const commands = exec.mock.calls.map((call) => call[0]);
    expect(commands).toContain("/opt/jdk17/bin/java");
    expect(commands).not.toContain("/usr/libexec/java_home");
    expect(commands).not.toContain("java");
  });

  it("falls through to java_home when configured Java candidates are invalid", async () => {
    const exec = javaExec({
      "/configured/missing-java": { code: 127 },
      "/stale/jdk/bin/java": { code: 127 },
      "/usr/libexec/java_home": { stdout: `${MAC_JAVA_HOME}\n`, code: 0 },
      [MAC_JAVA]: OPENJDK17,
    });

    const version = await detectJavaVersion(exec, {
      platform: "darwin",
      env: { SF_LSP_JAVA: "/configured/missing-java", JAVA_HOME: "/stale/jdk" },
    });

    expect(version).toBe("17.0.1");
    expect(exec.mock.calls.map((call) => call[0])).toEqual([
      "/configured/missing-java",
      "/stale/jdk/bin/java",
      "/usr/libexec/java_home",
      MAC_JAVA,
    ]);
  });

  it("resolves the JDK via /usr/libexec/java_home on macOS, never PATH java (#651)", async () => {
    const exec = javaExec({
      "/usr/libexec/java_home": {
        stdout: `${MAC_JAVA_HOME}\n`,
        code: 0,
      },
      [MAC_JAVA]: OPENJDK17,
    });

    const version = await detectJavaVersion(exec, { platform: "darwin", env: {} });

    expect(version).toBe("17.0.1");
    const commands = exec.mock.calls.map((call) => call[0]);
    expect(commands).toContain("/usr/libexec/java_home");
    // The #651 regression guard: never invoke the bare PATH `java` placeholder.
    expect(commands).not.toContain("java");
  });

  it("falls back to PATH java off macOS", async () => {
    const exec = javaExec({ java: OPENJDK17 });

    const version = await detectJavaVersion(exec, { platform: "linux", env: {} });

    expect(version).toBe("17.0.1");
    const commands = exec.mock.calls.map((call) => call[0]);
    expect(commands).toContain("java");
    expect(commands).not.toContain("/usr/libexec/java_home");
  });

  it("returns undefined when macOS java_home reports no JDK, without touching PATH java", async () => {
    const exec = javaExec({ "/usr/libexec/java_home": { stdout: "", code: 0 } });

    const version = await detectJavaVersion(exec, { platform: "darwin", env: {} });

    expect(version).toBeUndefined();
    expect(exec.mock.calls.map((call) => call[0])).toEqual(["/usr/libexec/java_home"]);
  });

  it("returns undefined when macOS java_home errors, without touching PATH java", async () => {
    const exec = javaExec({ "/usr/libexec/java_home": { stdout: "/x/Home", code: 1 } });

    const version = await detectJavaVersion(exec, { platform: "darwin", env: {} });

    expect(version).toBeUndefined();
    expect(exec.mock.calls.map((call) => call[0])).not.toContain("java");
  });

  it("returns undefined when the exec helper throws", async () => {
    const exec = vi.fn(async () => {
      throw new Error("spawn failed");
    });

    const version = await detectJavaVersion(exec, { platform: "darwin", env: {} });

    expect(version).toBeUndefined();
  });

  it("never invokes the bare PATH java on macOS even when everything is missing", async () => {
    const exec = javaExec({});

    const version = await detectJavaVersion(exec, { platform: "darwin", env: {} });

    expect(version).toBeUndefined();
    expect(exec.mock.calls.map((call) => call[0])).not.toContain("java");
  });
});
