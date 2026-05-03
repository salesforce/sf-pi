/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Side-effectful installers for Apex + LWC LSP components.
 *
 * Each installer writes into a temporary sibling directory, verifies the
 * artifact exists, and then moves it into its final home under
 * `~/.pi/agent/lsp/`. On failure the temp dir is removed so a half-written
 * install never poisons the discovery chain.
 *
 *   Apex → download vsix → unzip → copy dist/apex-jorje-lsp.jar → write VERSION
 *   LWC  → write minimal package.json → `npm install --prefix ~/.pi/agent/lsp/lwc
 *          @salesforce/lwc-language-server@<version>`
 *
 * Both installers return a `ComponentInstallResult` with a human-readable
 * message. They never throw — callers rely on `ok` to drive the summary.
 */
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { ExecFn } from "../../../../lib/common/sf-environment/detect.ts";
import { apexDir, apexJarPath, apexVersionPath, lwcDir } from "./paths.ts";
import type { ComponentInstallResult } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Apex
// -------------------------------------------------------------------------------------------------

export interface InstallApexOptions {
  version: string;
  vsixUrl: string;
  /** Override the apex install dir (tests). */
  targetDir?: string;
}

export async function installApex(
  exec: ExecFn,
  options: InstallApexOptions,
): Promise<ComponentInstallResult> {
  const target = options.targetDir ?? apexDir();
  const tmp = path.join(target, `.install-${Date.now()}`);
  const vsixPath = path.join(tmp, "apex.vsix");

  try {
    mkdirSync(tmp, { recursive: true });

    // 1. Download the vsix.
    const downloadOk = await downloadFile(options.vsixUrl, vsixPath);
    if (!downloadOk) {
      return {
        id: "apex",
        ok: false,
        message: `Download failed from ${options.vsixUrl}. Check network / proxy and retry with /sf-lsp install.`,
      };
    }

    // 2. Unzip only the jar we need.
    //    `unzip` ships on macOS, Linux, and WSL — the three platforms we
    //    declared as auto-install targets. On bare Windows this would
    //    fail, but the orchestrator never reaches this path there.
    const extractDir = path.join(tmp, "extracted");
    mkdirSync(extractDir, { recursive: true });
    const unzip = await exec(
      "unzip",
      ["-o", vsixPath, "extension/dist/apex-jorje-lsp.jar", "-d", extractDir],
      {
        timeout: 30_000,
      },
    );
    if (unzip.code !== 0) {
      return {
        id: "apex",
        ok: false,
        message: `unzip failed (exit ${unzip.code}). stderr: ${unzip.stderr?.trim() || "(empty)"}`,
      };
    }

    const extractedJar = path.join(extractDir, "extension", "dist", "apex-jorje-lsp.jar");
    if (!existsSync(extractedJar)) {
      return {
        id: "apex",
        ok: false,
        message:
          "Apex jar missing from vsix payload. The extension layout may have changed — file a bug against sf-pi.",
      };
    }

    // 3. Atomically replace the final jar + version stamp.
    mkdirSync(target, { recursive: true });
    const finalJar = options.targetDir ? path.join(target, "apex-jorje-lsp.jar") : apexJarPath();
    const versionFile = options.targetDir ? path.join(target, "VERSION") : apexVersionPath();

    // `rename` is atomic within a single filesystem, which matches our
    // tmp-sibling layout. Fall back to a copy+unlink on error so we still
    // succeed if the user's tmpdir sits on a different mount.
    try {
      await import("node:fs/promises").then((fsp) => fsp.rename(extractedJar, finalJar));
    } catch {
      await import("node:fs/promises").then((fsp) => fsp.copyFile(extractedJar, finalJar));
    }
    writeFileSync(versionFile, `${options.version}\n`, "utf-8");

    return {
      id: "apex",
      ok: true,
      installedVersion: options.version,
      message: `Apex LSP ${options.version} installed.`,
    };
  } catch (err) {
    return {
      id: "apex",
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

// -------------------------------------------------------------------------------------------------
// LWC
// -------------------------------------------------------------------------------------------------

export interface InstallLwcOptions {
  version: string;
  /** Override the lwc install dir (tests). */
  targetDir?: string;
}

export async function installLwc(
  exec: ExecFn,
  options: InstallLwcOptions,
): Promise<ComponentInstallResult> {
  const target = options.targetDir ?? lwcDir();

  try {
    mkdirSync(target, { recursive: true });

    // Write a minimal package.json so `npm install --prefix` has a home.
    // We keep it out of tree from any user project by pinning to our dir.
    const pkgPath = path.join(target, "package.json");
    if (!existsSync(pkgPath)) {
      writeFileSync(
        pkgPath,
        JSON.stringify(
          {
            name: "sf-pi-lsp-lwc-host",
            private: true,
            description:
              "Local install host for @salesforce/lwc-language-server (managed by sf-pi).",
          },
          null,
          2,
        ) + "\n",
        "utf-8",
      );
    }

    const result = await exec(
      "npm",
      [
        "install",
        "--prefix",
        target,
        "--no-audit",
        "--no-fund",
        "--loglevel=error",
        `@salesforce/lwc-language-server@${options.version}`,
      ],
      { timeout: 120_000 },
    );

    if (result.code !== 0) {
      return {
        id: "lwc",
        ok: false,
        message: `npm install failed (exit ${result.code}). stderr: ${result.stderr?.trim() || "(empty)"}`,
      };
    }

    return {
      id: "lwc",
      ok: true,
      installedVersion: options.version,
      message: `lwc-language-server ${options.version} installed.`,
    };
  } catch (err) {
    return {
      id: "lwc",
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// -------------------------------------------------------------------------------------------------
// Download helper
// -------------------------------------------------------------------------------------------------

async function downloadFile(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body) return false;
    mkdirSync(path.dirname(destPath), { recursive: true });
    // `res.body` is a web ReadableStream on Node 20+. Pipe through
    // `pipeline` so backpressure and error propagation match node
    // streams.
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(destPath));
    return existsSync(destPath);
  } catch {
    return false;
  }
}
