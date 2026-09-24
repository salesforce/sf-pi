/* SPDX-License-Identifier: Apache-2.0 */
/** Lazily owned Apex diagnostics for SDK/CLI callers; no Pi lifecycle is required. */
import os from "node:os";
import path from "node:path";
import type { ApexDiagnosticsProvider } from "./diagnostic-result.ts";
import type { LspClientOptions } from "../../sf-lsp/lib/client-engine.ts";

export interface ApexDiagnosticsClientOptions {
  signal?: AbortSignal;
  serverDirectory?: string;
  initializeTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  /** Explicit launcher for managed integrations and deterministic lifecycle tests. */
  launch?: LspClientOptions["launch"];
}

export interface ApexDiagnosticsClient {
  diagnose: ApexDiagnosticsProvider;
  dispose(): Promise<void>;
}

export function createApexDiagnosticsClient(
  options: ApexDiagnosticsClientOptions = {},
): ApexDiagnosticsClient {
  let disposed = false;
  let pending:
    | Promise<ReturnType<typeof import("../../sf-lsp/lib/client-engine.ts").createLspClientManager>>
    | undefined;
  const manager = () => {
    if (disposed) throw new Error("Apex diagnostics are disposed");
    options.signal?.throwIfAborted();
    return (pending ??= import("../../sf-lsp/lib/client-engine.ts").then(
      ({ createLspClientManager }) =>
        createLspClientManager({
          globalDirectory:
            options.serverDirectory ?? path.join(os.homedir(), ".pi", "agent", "lsp"),
          projectDirectoryName: ".pi",
          strictDiagnostics: true,
          signal: options.signal,
          initializeTimeoutMs: options.initializeTimeoutMs,
          shutdownTimeoutMs: options.shutdownTimeoutMs,
          launch: options.launch,
        }),
    ));
  };
  return {
    async diagnose(file, cwd, timeout) {
      try {
        return await (await manager()).getLspDiagnosticsForFile("apex", file, cwd, timeout);
      } catch (error) {
        options.signal?.throwIfAborted();
        return {
          diagnostics: [],
          unavailable: {
            language: "apex",
            available: false,
            detail: error instanceof Error ? error.message : "Apex diagnostics failed",
          },
        };
      }
    },
    async dispose() {
      disposed = true;
      if (pending) await (await pending).dispose();
    },
  };
}
