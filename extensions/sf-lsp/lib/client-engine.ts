/* SPDX-License-Identifier: Apache-2.0 */
/**
 * LSP client management for sf-lsp.
 *
 * Manages LSP server lifecycles for Apex, LWC, and Agent Script.
 * Spawns servers as child processes, communicates via JSON-RPC over stdio,
 * and returns diagnostics for individual files.
 *
 * Inlined from the former shared sf-quality/lsp.ts engine — this extension
 * owns its own LSP layer with zero shared library coupling.
 *
 * Improvements over the original:
 * - LRU file eviction (cap of 30 open files per server)
 * - Idle file cleanup (60s idle → close file)
 * - Path normalization for macOS /private/var vs /var
 * - Workspace diagnostic fallback when push diagnostics don't arrive
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createMessageConnection,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
  DocumentDiagnosticRequest,
  InitializeRequest,
  InitializedNotification,
  PublishDiagnosticsNotification,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-languageserver-protocol/node";
import type { LspDiagnostic, LspDoctorStatus, LspResult, SupportedLanguage } from "./types.ts";
import { getLspLanguageId } from "./file-classify.ts";

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

const INIT_TIMEOUT_MS = 30_000;
const IDLE_FILE_TIMEOUT_MS = 60_000;
const IDLE_SERVER_TIMEOUT_MS = 2 * 60_000;
const MAX_OPEN_FILES = 30;
const MAX_STDERR_LINES = 20;
const CLEANUP_INTERVAL_MS = 30_000;

// -------------------------------------------------------------------------------------------------
// Internal types
// -------------------------------------------------------------------------------------------------

export interface LspLaunchSpec {
  language: SupportedLanguage;
  source: string;
  detail: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

interface OpenDocumentState {
  version: number;
  lastAccess: number;
}

interface DiagnosticWaiter {
  resolve(diagnostics: LspDiagnostic[]): void;
  reject(error: Error): void;
}

interface ManagedClient {
  language: SupportedLanguage;
  root: string;
  connection: MessageConnection;
  process: ChildProcessWithoutNullStreams;
  versions: Map<string, number>;
  diagnostics: Map<string, LspDiagnostic[]>;
  waiters: Map<string, DiagnosticWaiter[]>;
  openDocuments: Map<string, OpenDocumentState>;
  stderrLines: string[];
  startedAt: number;
  lastAccess: number;
  launch: LspLaunchSpec;
}

// -------------------------------------------------------------------------------------------------
// Client pool
// -------------------------------------------------------------------------------------------------

export interface LspClientOptions {
  globalDirectory: string;
  projectDirectoryName: string;
  signal?: AbortSignal;
  strictDiagnostics?: boolean;
  initializeTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  launch?: (language: SupportedLanguage, cwd: string) => Promise<LspLaunchSpec | LspDoctorStatus>;
}

/** Each owner controls its own client pool; configuration never reads Pi state. */
export function createLspClientManager(options: LspClientOptions) {
  let disposed = false;
  const pendingClients = new Set<ManagedClient>();
  const closingClients = new WeakMap<ManagedClient, Promise<void>>();
  const startingClients = new Map<string, Promise<ManagedClient | LspDoctorStatus>>();
  let cleanupTimer: ReturnType<typeof setInterval> | undefined;

  async function bounded<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  const clientPool = new Map<string, ManagedClient>();
  let cleanupTimerStarted = false;

  // -------------------------------------------------------------------------------------------------
  // VS Code extension search paths
  // -------------------------------------------------------------------------------------------------

  const VS_CODE_DIR_CANDIDATES = [
    process.env.VSCODE_EXTENSIONS_DIR,
    path.join(os.homedir(), ".vscode", "extensions"),
    path.join(os.homedir(), ".vscode-server", "extensions"),
    path.join(os.homedir(), ".vscode-insiders", "extensions"),
    path.join(os.homedir(), ".vscode-server-insiders", "extensions"),
    path.join(os.homedir(), ".cursor", "extensions"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  // -------------------------------------------------------------------------------------------------
  // Filesystem utilities
  // -------------------------------------------------------------------------------------------------

  /**
   * Normalize a filesystem path using realpathSync for consistent comparisons.
   * On macOS, this resolves /var → /private/var (and similar).
   */
  function normalizeFsPath(p: string): string {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  }

  function shellJoin(command: string, args: string[]): string {
    return [command, ...args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))].join(" ");
  }

  function which(binary: string): string | undefined {
    const searchPaths = [
      ...(process.env.PATH?.split(path.delimiter) ?? []),
      "/usr/local/bin",
      "/opt/homebrew/bin",
      path.join(os.homedir(), ".volta", "bin"),
      path.join(os.homedir(), ".nvm", "current", "bin"),
    ];
    for (const dir of searchPaths) {
      const candidate = path.join(dir, binary);
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
  }

  function findNodeBinary(): string | undefined {
    return process.env.NODE_PATH || which("node") || "/usr/bin/node";
  }

  function findJavaBinary(): string | undefined {
    const javaHome = process.env.JAVA_HOME;
    if (javaHome) {
      const candidate = path.join(javaHome, "bin", "java");
      if (existsSync(candidate)) return candidate;
    }

    const candidates = [
      process.env.SF_LSP_JAVA,
      "/opt/homebrew/opt/openjdk@21/bin/java",
      "/opt/homebrew/opt/openjdk@17/bin/java",
      "/opt/homebrew/opt/openjdk@11/bin/java",
      "/opt/homebrew/opt/openjdk/bin/java",
      "/usr/bin/java",
      "/usr/local/bin/java",
      which("java"),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    return candidates.find((candidate) => existsSync(candidate));
  }

  // -------------------------------------------------------------------------------------------------
  // Workspace and LSP directory resolution
  // -------------------------------------------------------------------------------------------------

  function findWorkspaceRoot(filePath: string, cwd: string, language: SupportedLanguage): string {
    const markerGroups: Record<SupportedLanguage, string[]> = {
      apex: ["sfdx-project.json", ".git"],
      agentscript: ["sfdx-project.json", ".git", "package.json"],
      lwc: ["sfdx-project.json", "package.json", ".git"],
    };

    const markers = markerGroups[language];
    let current = path.resolve(path.dirname(filePath));
    const floor = path.resolve(cwd);

    while (true) {
      for (const marker of markers) {
        if (existsSync(path.join(current, marker))) return current;
      }
      if (current === floor) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }

    return floor;
  }

  function findNearestPiDirectory(cwd: string): string | undefined {
    let current = path.resolve(cwd);
    while (true) {
      const candidate = path.join(current, options.projectDirectoryName);
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return undefined;
  }

  function projectLspDir(cwd: string): string | undefined {
    const piDir = findNearestPiDirectory(cwd);
    return piDir ? path.join(piDir, "lsp") : undefined;
  }

  function globalLspDir(): string {
    return options.globalDirectory;
  }

  function findNewestDirectory(baseDir: string, pattern: RegExp): string | undefined {
    // Declared without an initializer on purpose: both the try and catch
    // arms assign before the next use, so a pre-assignment would be flagged
    // as dead by `no-useless-assignment`.
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = readdirSync(baseDir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    const dirs = entries
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

    const newest = dirs.at(-1);
    return newest ? path.join(baseDir, newest) : undefined;
  }

  // -------------------------------------------------------------------------------------------------
  // LSP server discovery — one function per language
  // -------------------------------------------------------------------------------------------------

  async function discoverApexLaunch(cwd: string): Promise<LspLaunchSpec | LspDoctorStatus> {
    const java = findJavaBinary();
    if (!java) {
      return {
        language: "apex",
        available: false,
        detail: "Java 11+ not found. Set JAVA_HOME or install OpenJDK.",
      };
    }

    const pLspDir = projectLspDir(cwd);
    const jarCandidates = [
      process.env.SF_LSP_APEX_JAR,
      process.env.APEX_LSP_JAR,
      pLspDir ? path.join(pLspDir, "apex", "apex-jorje-lsp.jar") : undefined,
      pLspDir ? path.join(pLspDir, "servers", "apex", "apex-jorje-lsp.jar") : undefined,
      path.join(globalLspDir(), "apex", "apex-jorje-lsp.jar"),
      path.join(globalLspDir(), "servers", "apex", "apex-jorje-lsp.jar"),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    for (const candidate of jarCandidates) {
      if (!existsSync(candidate)) continue;
      return {
        language: "apex",
        source: candidate.includes(".pi/agent/lsp")
          ? "pi-global"
          : candidate.includes("/.pi/lsp")
            ? "pi-project"
            : candidate === process.env.SF_LSP_APEX_JAR || candidate === process.env.APEX_LSP_JAR
              ? "env"
              : "cache",
        detail: candidate,
        command: java,
        args: [
          "-cp",
          candidate,
          "-Ddebug.internal.errors=true",
          "-Ddebug.semantic.errors=false",
          "-Ddebug.completion.statistics=false",
          "-Dlwc.typegeneration.disabled=true",
          `-Xmx${process.env.APEX_LSP_MEMORY || "2048"}M`,
          "apex.jorje.lsp.ApexLanguageServerLauncher",
        ],
      };
    }

    for (const baseDir of VS_CODE_DIR_CANDIDATES) {
      const extensionDir = findNewestDirectory(
        baseDir,
        /^salesforce\.salesforcedx-vscode-apex-[0-9].*/i,
      );
      if (!extensionDir) continue;
      const jarPath = [
        path.join(extensionDir, "dist", "apex-jorje-lsp.jar"),
        path.join(extensionDir, "out", "apex-jorje-lsp.jar"),
      ].find((candidate) => existsSync(candidate));
      if (!jarPath) continue;
      return {
        language: "apex",
        source: "vscode",
        detail: jarPath,
        command: java,
        args: [
          "-cp",
          jarPath,
          "-Ddebug.internal.errors=true",
          "-Ddebug.semantic.errors=false",
          "-Ddebug.completion.statistics=false",
          "-Dlwc.typegeneration.disabled=true",
          `-Xmx${process.env.APEX_LSP_MEMORY || "2048"}M`,
          "apex.jorje.lsp.ApexLanguageServerLauncher",
        ],
      };
    }

    return {
      language: "apex",
      available: false,
      detail: `Apex LSP jar not found. Place apex-jorje-lsp.jar in ${options.projectDirectoryName}/lsp/apex/ or ${options.globalDirectory}/apex/, set SF_LSP_APEX_JAR/APEX_LSP_JAR, or install the Salesforce VS Code Apex extension.`,
    };
  }

  async function discoverAgentScriptLaunch(cwd: string): Promise<LspLaunchSpec | LspDoctorStatus> {
    const node = findNodeBinary();
    if (!node || !existsSync(node)) {
      return {
        language: "agentscript",
        available: false,
        detail: "Node.js 18+ not found. Set NODE_PATH or install Node.",
      };
    }

    const pLspDir = projectLspDir(cwd);

    // The Salesforce Agent Script VS Code extension changed its on-disk layout:
    //   v1.x  -> <ext>/server/server.js   (CommonJS bundle)
    //   v2.x  -> <ext>/dist/server.mjs    (ESM bundle)
    // Accept either filename for env/global/project overrides; the VS Code
    // extension fallback below also probes both layouts.
    const serverCandidates = [
      process.env.SF_LSP_AGENTSCRIPT_SERVER,
      process.env.AGENTSCRIPT_LSP_SERVER,
      pLspDir ? path.join(pLspDir, "agentscript", "server.mjs") : undefined,
      pLspDir ? path.join(pLspDir, "agentscript", "server.js") : undefined,
      pLspDir ? path.join(pLspDir, "servers", "agentscript", "server.mjs") : undefined,
      pLspDir ? path.join(pLspDir, "servers", "agentscript", "server.js") : undefined,
      path.join(globalLspDir(), "agentscript", "server.mjs"),
      path.join(globalLspDir(), "agentscript", "server.js"),
      path.join(globalLspDir(), "servers", "agentscript", "server.mjs"),
      path.join(globalLspDir(), "servers", "agentscript", "server.js"),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    for (const candidate of serverCandidates) {
      if (!existsSync(candidate)) continue;
      return {
        language: "agentscript",
        source: candidate.includes(".pi/agent/lsp")
          ? "pi-global"
          : candidate.includes("/.pi/lsp")
            ? "pi-project"
            : candidate === process.env.SF_LSP_AGENTSCRIPT_SERVER ||
                candidate === process.env.AGENTSCRIPT_LSP_SERVER
              ? "env"
              : "cache",
        detail: candidate,
        command: node,
        args: [candidate, "--stdio"],
      };
    }

    for (const baseDir of VS_CODE_DIR_CANDIDATES) {
      const extensionDir = findNewestDirectory(
        baseDir,
        /^salesforce\.agent-script-language-client-.*/i,
      );
      if (!extensionDir) continue;
      // v2.x layout (dist/server.mjs) wins over v1.x (server/server.js) when
      // both are present, since findNewestDirectory already picked the newest
      // extension version by folder name.
      const serverPath = [
        path.join(extensionDir, "dist", "server.mjs"),
        path.join(extensionDir, "server", "server.js"),
      ].find((candidate) => existsSync(candidate));
      if (!serverPath) continue;
      return {
        language: "agentscript",
        source: "vscode",
        detail: serverPath,
        command: node,
        args: [serverPath, "--stdio"],
      };
    }

    return {
      language: "agentscript",
      available: false,
      detail:
        "Agent Script LSP server not found. Place server.mjs (v2.x) or server.js (v1.x) in .pi/lsp/agentscript/, ~/.pi/agent/lsp/agentscript/, set SF_LSP_AGENTSCRIPT_SERVER/AGENTSCRIPT_LSP_SERVER, or install the Salesforce Agent Script VS Code extension.",
    };
  }

  async function discoverLwcLaunch(cwd: string): Promise<LspLaunchSpec | LspDoctorStatus> {
    const pLspDir = projectLspDir(cwd);

    // sf-lsp's first-boot installer drops the npm package under
    //   ~/.pi/agent/lsp/lwc/node_modules/@salesforce/lwc-language-server/
    // whose entry point is a plain Node script. Launch it with `node`
    // instead of requiring a shell-executable binary.
    const managedLwcServerJs = [
      pLspDir
        ? path.join(
            pLspDir,
            "lwc",
            "node_modules",
            "@salesforce",
            "lwc-language-server",
            "bin",
            "lwc-language-server.js",
          )
        : undefined,
      path.join(
        globalLspDir(),
        "lwc",
        "node_modules",
        "@salesforce",
        "lwc-language-server",
        "bin",
        "lwc-language-server.js",
      ),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    for (const jsCandidate of managedLwcServerJs) {
      if (!existsSync(jsCandidate)) continue;
      const node = findNodeBinary();
      if (!node || !existsSync(node)) continue;
      return {
        language: "lwc",
        source: jsCandidate.includes(".pi/agent/lsp") ? "pi-global" : "pi-project",
        detail: jsCandidate,
        command: node,
        args: [jsCandidate, "--stdio"],
      };
    }

    const explicitCandidates = [
      process.env.SF_LSP_LWC_COMMAND,
      pLspDir ? path.join(pLspDir, "bin", "lwc-language-server") : undefined,
      pLspDir ? path.join(pLspDir, "lwc", "lwc-language-server") : undefined,
      path.join(globalLspDir(), "bin", "lwc-language-server"),
      path.join(globalLspDir(), "lwc", "lwc-language-server"),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    for (const explicitCommand of explicitCandidates) {
      if (!existsSync(explicitCommand)) continue;
      return {
        language: "lwc",
        source: explicitCommand.includes(".pi/agent/lsp")
          ? "pi-global"
          : explicitCommand.includes("/.pi/lsp")
            ? "pi-project"
            : explicitCommand === process.env.SF_LSP_LWC_COMMAND
              ? "env"
              : "cache",
        detail: explicitCommand,
        command: explicitCommand,
        args: ["--stdio"],
      };
    }

    const binary = which("lwc-language-server");
    if (binary) {
      return {
        language: "lwc",
        source: "path",
        detail: binary,
        command: binary,
        args: ["--stdio"],
      };
    }

    return {
      language: "lwc",
      available: false,
      detail:
        "lwc-language-server not found. Run /sf-lsp install to auto-install, drop the binary into .pi/lsp/bin/ or ~/.pi/agent/lsp/bin/, or set SF_LSP_LWC_COMMAND.",
    };
  }

  async function discoverLaunch(
    language: SupportedLanguage,
    cwd: string,
  ): Promise<LspLaunchSpec | LspDoctorStatus> {
    if (options.launch) return options.launch(language, cwd);
    switch (language) {
      case "apex":
        return discoverApexLaunch(cwd);
      case "agentscript":
        return discoverAgentScriptLaunch(cwd);
      case "lwc":
        return discoverLwcLaunch(cwd);
    }
  }

  function toDoctorStatus(value: LspLaunchSpec | LspDoctorStatus): LspDoctorStatus {
    if ("available" in value) return value;
    return {
      language: value.language,
      available: true,
      source: value.source,
      command: shellJoin(value.command, value.args),
      detail: value.detail,
    };
  }

  // -------------------------------------------------------------------------------------------------
  // Client pool key and helpers
  // -------------------------------------------------------------------------------------------------

  function getClientKey(language: SupportedLanguage, root: string): string {
    return `${language}:${root}`;
  }

  function trimStderrBuffer(client: ManagedClient): void {
    while (client.stderrLines.length > MAX_STDERR_LINES) client.stderrLines.shift();
  }

  function touchClient(client: ManagedClient): void {
    client.lastAccess = Date.now();
  }

  // -------------------------------------------------------------------------------------------------
  // LRU file eviction and idle cleanup
  // -------------------------------------------------------------------------------------------------

  /**
   * Close a tracked open document on the LSP server.
   */
  function closeDocument(client: ManagedClient, uri: string): void {
    if (!client.openDocuments.has(uri)) return;
    client.openDocuments.delete(uri);
    try {
      client.connection
        .sendNotification(DidCloseTextDocumentNotification.type, {
          textDocument: { uri },
        })
        .catch(() => {});
    } catch {
      // ignore close notification errors
    }
  }

  /**
   * Evict the least-recently-accessed open document when the cap is exceeded.
   */
  function evictLruDocument(client: ManagedClient): void {
    if (client.openDocuments.size <= MAX_OPEN_FILES) return;

    let oldestUri: string | null = null;
    let oldestTime = Infinity;

    for (const [uri, state] of client.openDocuments) {
      if (state.lastAccess < oldestTime) {
        oldestTime = state.lastAccess;
        oldestUri = uri;
      }
    }

    if (oldestUri) {
      closeDocument(client, oldestUri);
    }
  }

  /**
   * Close files that haven't been accessed in IDLE_FILE_TIMEOUT_MS.
   */
  function cleanupIdleFiles(): void {
    const now = Date.now();
    for (const client of clientPool.values()) {
      for (const [uri, state] of client.openDocuments) {
        if (now - state.lastAccess > IDLE_FILE_TIMEOUT_MS) {
          closeDocument(client, uri);
        }
      }
    }
  }

  // -------------------------------------------------------------------------------------------------
  // Client lifecycle — close and idle shutdown
  // -------------------------------------------------------------------------------------------------

  function closeClient(client: ManagedClient): Promise<void> {
    let closing = closingClients.get(client);
    if (!closing) {
      closing = finishClient(client);
      closingClients.set(client, closing);
    }
    return closing;
  }

  function isRunning(client: ManagedClient): boolean {
    return client.process.exitCode === null && client.process.signalCode === null;
  }

  async function finishClient(client: ManagedClient): Promise<void> {
    const key = getClientKey(client.language, client.root);
    if (clientPool.get(key) === client) clientPool.delete(key);
    pendingClients.delete(client);
    for (const waiters of client.waiters.values()) {
      for (const waiter of waiters) waiter.reject(new Error("LSP client closed"));
    }
    client.waiters.clear();

    if (!isRunning(client)) {
      client.connection.dispose();
      return;
    }
    for (const [uri] of client.openDocuments) {
      try {
        client.connection
          .sendNotification(DidCloseTextDocumentNotification.type, {
            textDocument: { uri },
          })
          .catch(() => {});
      } catch {
        // ignore
      }
    }

    try {
      await bounded(
        client.connection.sendRequest("shutdown", undefined),
        options.shutdownTimeoutMs ?? 1000,
        "LSP shutdown timed out",
      );
    } catch {
      // ignore
    }
    try {
      client.connection.sendNotification("exit", undefined).catch(() => {});
    } catch {
      // ignore
    }
    client.connection.dispose();
    if (client.process.exitCode === null && client.process.signalCode === null) {
      const exited = new Promise<void>((resolve) => client.process.once("close", () => resolve()));
      client.process.kill();
      try {
        await bounded(exited, options.shutdownTimeoutMs ?? 1000, "LSP exit timed out");
      } catch {
        client.process.kill("SIGKILL");
        await bounded(exited, 1000, "LSP kill timed out");
      }
    }
  }

  function scheduleIdleCleanup(): void {
    if (cleanupTimerStarted) return;
    cleanupTimerStarted = true;

    const timer = setInterval(() => {
      // Clean up idle files
      cleanupIdleFiles();

      // Shut down idle servers
      const now = Date.now();
      void (async () => {
        for (const client of [...clientPool.values()]) {
          if (now - client.lastAccess < IDLE_SERVER_TIMEOUT_MS) continue;
          await closeClient(client);
        }
        if (clientPool.size === 0) {
          clearInterval(timer);
          cleanupTimerStarted = false;
        }
      })();
    }, CLEANUP_INTERVAL_MS);

    cleanupTimer = timer;
    timer.unref?.();
  }

  // -------------------------------------------------------------------------------------------------
  // Diagnostic wiring
  // -------------------------------------------------------------------------------------------------

  function wireDiagnostics(client: ManagedClient): void {
    client.process.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (!text) return;
      client.stderrLines.push(...text.split(/\r?\n/).filter(Boolean));
      trimStderrBuffer(client);
    });

    client.connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
      const uri = params.uri;
      if (
        options.strictDiagnostics &&
        typeof params.version === "number" &&
        params.version !== client.versions.get(uri)
      )
        return;
      const diagnostics = params.diagnostics as LspDiagnostic[];
      client.diagnostics.set(uri, diagnostics);
      touchClient(client);
      const waiters = client.waiters.get(uri) ?? [];
      client.waiters.delete(uri);
      for (const waiter of waiters) waiter.resolve(diagnostics);
    });

    client.connection.onError(() => {});
    client.connection.onClose(() => {
      const key = getClientKey(client.language, client.root);
      if (clientPool.get(key) === client) clientPool.delete(key);
    });

    // Handle server-side requests gracefully
    client.connection.onRequest("workspace/configuration", () => [{}]);
    client.connection.onRequest("window/workDoneProgress/create", () => null);
    client.connection.onRequest("client/registerCapability", () => {});

    client.process.on("exit", () => {
      const key = getClientKey(client.language, client.root);
      if (clientPool.get(key) === client) clientPool.delete(key);
      for (const [, waiters] of client.waiters) {
        for (const waiter of waiters) {
          if (options.strictDiagnostics)
            waiter.reject(new Error("LSP exited before publishing diagnostics"));
          else waiter.resolve([]);
        }
      }
      client.waiters.clear();
      client.openDocuments.clear();
    });
  }

  // -------------------------------------------------------------------------------------------------
  // Client creation and retrieval
  // -------------------------------------------------------------------------------------------------

  async function createClient(
    language: SupportedLanguage,
    root: string,
  ): Promise<ManagedClient | LspDoctorStatus> {
    if (disposed) throw new Error("LSP client manager is disposed");
    options.signal?.throwIfAborted();
    const launch = await discoverLaunch(language, root);
    options.signal?.throwIfAborted();
    if (disposed) throw new Error("LSP client manager is disposed");
    if ("available" in launch) return launch;

    const child = spawn(launch.command, launch.args, {
      cwd: root,
      env: { ...process.env, ...launch.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Wait for spawn before writing the initialize request; failed executables have no writable transport.
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });

    if (disposed || options.signal?.aborted) {
      const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
      child.kill("SIGKILL");
      await bounded(exited, 1000, "LSP cancellation cleanup timed out");
      options.signal?.throwIfAborted();
      throw new Error("LSP client manager is disposed");
    }

    // Prevent crashes from stream errors
    child.stdin?.on("error", () => {});
    child.stdout?.on("error", () => {});
    child.stderr?.on("error", () => {});

    const writer = new StreamMessageWriter(child.stdin);
    const connection: MessageConnection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      {
        onError: writer.onError,
        onClose: writer.onClose,
        async write(message) {
          try {
            await writer.write(message);
          } catch {
            // JSON-RPC rethrows rejected writes from an async Promise executor. Disposing
            // rejects pending requests without that unhandled rejection, and reaps the server.
            connection.dispose();
            child.kill();
          }
        },
        end: () => writer.end(),
        dispose: () => writer.dispose(),
      },
    );

    const client: ManagedClient = {
      language,
      root,
      connection,
      process: child,
      versions: new Map(),
      diagnostics: new Map(),
      waiters: new Map(),
      openDocuments: new Map(),
      stderrLines: [],
      startedAt: Date.now(),
      lastAccess: Date.now(),
      launch,
    };

    pendingClients.add(client);
    const abort = () => child.kill("SIGKILL");
    options.signal?.addEventListener("abort", abort, { once: true });
    child.once("close", () => options.signal?.removeEventListener("abort", abort));
    wireDiagnostics(client);
    connection.listen();

    const rootUri = pathToFileURL(root).href;
    const initializePromise = connection.sendRequest(InitializeRequest.method, {
      processId: process.pid,
      clientInfo: { name: "sf-lsp", version: "1.0.0" },
      rootUri,
      // Apex Jorje also uses the legacy rootPath for its project and index storage.
      rootPath: root,
      capabilities: {
        window: { workDoneProgress: true },
        workspace: { configuration: true },
        textDocument: {
          synchronization: { didSave: true, didOpen: true, didChange: true, didClose: true },
          publishDiagnostics: { versionSupport: true },
          diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
        },
      },
      workspaceFolders: [{ uri: rootUri, name: path.basename(root) || root }],
    });

    try {
      await bounded(
        Promise.race([
          initializePromise,
          new Promise<never>((_, reject) => child.once("error", reject)),
        ]),
        options.initializeTimeoutMs ?? INIT_TIMEOUT_MS,
        "LSP initialize timed out",
      );
      options.signal?.throwIfAborted();
      if (disposed) throw new Error("LSP client manager is disposed");
    } catch (error) {
      await closeClient(client);
      throw error;
    }
    pendingClients.delete(client);

    connection.sendNotification(InitializedNotification.type, {}).catch(() => {});
    clientPool.set(getClientKey(language, root), client);
    scheduleIdleCleanup();
    return client;
  }

  async function getOrCreateClient(
    language: SupportedLanguage,
    root: string,
  ): Promise<ManagedClient | LspDoctorStatus> {
    const key = getClientKey(language, root);
    const existing = clientPool.get(key);
    if (existing) {
      touchClient(existing);
      return existing;
    }
    if (disposed) throw new Error("LSP client manager is disposed");
    options.signal?.throwIfAborted();
    let pending = startingClients.get(key);
    if (!pending) {
      pending = createClient(language, root).finally(() => startingClients.delete(key));
      startingClients.set(key, pending);
    }
    return pending;
  }

  // -------------------------------------------------------------------------------------------------
  // Diagnostic retrieval for a single file
  // -------------------------------------------------------------------------------------------------

  async function waitForDiagnostics(
    client: ManagedClient,
    uri: string,
    timeoutMs: number,
  ): Promise<LspDiagnostic[]> {
    return await new Promise((resolve, reject) => {
      const waiter: DiagnosticWaiter = { resolve, reject };
      const timer = setTimeout(() => {
        const waiters = client.waiters.get(uri) ?? [];
        client.waiters.set(
          uri,
          waiters.filter((candidate) => candidate !== waiter),
        );
        if (options.strictDiagnostics)
          reject(new Error("LSP did not publish diagnostics before the deadline"));
        else resolve(client.diagnostics.get(uri) ?? []);
      }, timeoutMs);
      timer.unref?.();

      waiter.reject = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      waiter.resolve = (diagnostics: LspDiagnostic[]) => {
        clearTimeout(timer);
        resolve(diagnostics);
      };

      const waiters = client.waiters.get(uri) ?? [];
      waiters.push(waiter);
      client.waiters.set(uri, waiters);
    });
  }

  async function requestDocumentDiagnostics(
    client: ManagedClient,
    uri: string,
    timeoutMs: number,
  ): Promise<LspDiagnostic[] | undefined> {
    try {
      const result = await bounded(
        client.connection.sendRequest(DocumentDiagnosticRequest.type, {
          textDocument: { uri },
        }),
        timeoutMs,
        "LSP diagnostic request timed out",
      );
      if (!result || typeof result !== "object") return undefined;
      const items = (result as { items?: unknown }).items;
      return Array.isArray(items) ? (items as LspDiagnostic[]) : undefined;
    } catch {
      return undefined;
    }
  }

  async function diagnoseWithClient(
    client: ManagedClient,
    filePath: string,
    content: string,
    timeoutMs: number,
  ): Promise<LspDiagnostic[]> {
    const uri = pathToFileURL(filePath).href;
    const nextVersion = (client.versions.get(uri) ?? 0) + 1;
    client.versions.set(uri, nextVersion);
    client.openDocuments.set(uri, { version: nextVersion, lastAccess: Date.now() });
    touchClient(client);

    // Evict LRU file if at capacity
    evictLruDocument(client);

    const languageId = getLspLanguageId(client.language, filePath);
    if (options.strictDiagnostics) client.diagnostics.delete(uri);
    const diagnosticsPromise = waitForDiagnostics(client, uri, timeoutMs);

    if (nextVersion === 1) {
      client.connection
        .sendNotification(DidOpenTextDocumentNotification.type, {
          textDocument: {
            uri,
            languageId,
            version: nextVersion,
            text: content,
          },
        })
        .catch(() => {});
    } else {
      client.connection
        .sendNotification(DidChangeTextDocumentNotification.type, {
          textDocument: { uri, version: nextVersion },
          contentChanges: [{ text: content }],
        })
        .catch(() => {});
    }

    client.connection
      .sendNotification(DidSaveTextDocumentNotification.type, {
        textDocument: { uri },
        text: content,
      })
      .catch(() => {});

    let diagnostics: LspDiagnostic[];
    try {
      diagnostics = await diagnosticsPromise;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!isRunning(client)) throw error;
      const fallback = await requestDocumentDiagnostics(client, uri, timeoutMs);
      if (fallback !== undefined) return fallback;
      throw error;
    }
    if (diagnostics.length > 0 || options.strictDiagnostics) return diagnostics;

    // Pull diagnostics fallback — some servers don't push diagnostics reliably
    const fallback = await requestDocumentDiagnostics(client, uri, timeoutMs);
    return fallback ?? diagnostics;
  }

  // -------------------------------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------------------------------

  /**
   * Get LSP diagnostics for a single file.
   *
   * This is the main entry point used by the extension's tool_result handler.
   */
  async function getLspDiagnosticsForFile(
    language: SupportedLanguage,
    filePath: string,
    cwd: string,
    timeoutMs: number,
  ): Promise<LspResult> {
    const root = findWorkspaceRoot(filePath, cwd, language);
    const normalizedPath = normalizeFsPath(filePath);
    const content = await fs.readFile(normalizedPath, "utf8");
    const clientOrStatus = await getOrCreateClient(language, root);
    if ("available" in clientOrStatus) {
      return { diagnostics: [], unavailable: clientOrStatus };
    }

    try {
      const diagnostics = await diagnoseWithClient(
        clientOrStatus,
        normalizedPath,
        content,
        timeoutMs,
      );
      return { diagnostics };
    } catch (error) {
      const stderr =
        clientOrStatus.stderrLines.length > 0
          ? ` LSP stderr: ${clientOrStatus.stderrLines.slice(-3).join(" | ")}`
          : "";
      return {
        diagnostics: [],
        unavailable: {
          language,
          available: false,
          source: clientOrStatus.launch.source,
          command: shellJoin(clientOrStatus.launch.command, clientOrStatus.launch.args),
          detail: `${error instanceof Error ? error.message : String(error)}${stderr}`.trim(),
        },
      };
    }
  }

  /**
   * Report whether Apex, LWC, and Agent Script LSPs are available.
   *
   * Used by the `/sf-lsp doctor` command.
   */
  async function doctorLsp(cwd: string): Promise<LspDoctorStatus[]> {
    const languages: SupportedLanguage[] = ["apex", "lwc", "agentscript"];
    const statuses: LspDoctorStatus[] = [];
    for (const language of languages) {
      statuses.push(toDoctorStatus(await discoverLaunch(language, cwd)));
    }
    return statuses;
  }

  /**
   * Shut down all LSP child processes.
   *
   * Called on session_shutdown to release resources.
   */
  async function shutdownLspClients(): Promise<void> {
    clearInterval(cleanupTimer);
    cleanupTimerStarted = false;
    const clients = [...new Set([...clientPool.values(), ...pendingClients])];
    for (const client of clients) {
      await closeClient(client);
    }
  }

  return {
    getLspDiagnosticsForFile,
    doctorLsp,
    shutdownLspClients,
    async dispose() {
      disposed = true;
      await shutdownLspClients();
      await Promise.allSettled(startingClients.values());
    },
  };
}
