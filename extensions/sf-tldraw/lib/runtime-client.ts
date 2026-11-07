/* SPDX-License-Identifier: Apache-2.0 */
/** Narrow, secret-safe adapter for the loopback tldraw offline Canvas API. */
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  RuntimeCapabilities,
  RuntimeScreenshot,
  TldrawCreatedDocument,
  TldrawDocumentSummary,
  TldrawRuntimeObservation,
  TldrawRuntimeStatus,
  TldrawServerConfig,
  TldrawSkillReadiness,
} from "./types.ts";
import { sanitizeRuntimeText } from "./redaction.ts";

export type TldrawRuntimeErrorCode =
  | "not_running"
  | "stale_config"
  | "auth_error"
  | "not_found"
  | "no_open_document"
  | "unsupported"
  | "invalid_request"
  | "conflict"
  | "timeout"
  | "execution_failed"
  | "invalid_response";

export class TldrawRuntimeError extends Error {
  constructor(
    readonly code: TldrawRuntimeErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TldrawRuntimeError";
  }
}

interface ClientOptions {
  fetchImpl?: typeof fetch;
  serverConfigPath?: string;
  agentDir?: string;
  timeoutMs?: number;
}

interface ApiEnvelope<T> {
  success?: boolean;
  result?: T;
  error?: string;
}

const CREATE_DOCUMENT_TIMEOUT_MS = 60_000;
const TLDRAW_SKILL_MARKER = "<!-- installed-by:tldraw-desktop-agent-skills -->";
const TLDRAW_SKILL_RELATIVE_PATH = path.join("skills", "tldraw-offline", "SKILL.md");
const REQUIRED_V112_CONTRACT_MARKERS = [
  "`POST /api/search`",
  "`POST /api/docs/create`",
  "`POST /api/doc/:id/exec`",
  "api.getScreenshot",
  "helpers.createArrowBetweenShapes",
  "helpers.getLints",
] as const;

const V112_CAPABILITIES: RuntimeCapabilities = {
  apiContract: "canvas-api-v1.12",
  contractProof: "readme",
  nativeDocumentCreation: true,
  documents: true,
  search: true,
  execute: true,
  screenshot: true,
};

export function defaultTldrawServerConfigPath(): string {
  if (process.env.TLDRAW_SERVER_CONFIG) return path.resolve(process.env.TLDRAW_SERVER_CONFIG);
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "tldraw", "server.json");
  if (process.platform === "win32")
    return path.join(process.env.APPDATA ?? os.homedir(), "tldraw", "server.json");
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
    "tldraw",
    "server.json",
  );
}

export function hasTldrawServerConfig(filePath = defaultTldrawServerConfigPath()): boolean {
  return existsSync(filePath);
}

export class TldrawRuntimeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly serverConfigPath: string;
  private readonly agentDir: string;
  private readonly timeoutMs: number;
  private verifiedCapabilities: RuntimeCapabilities | undefined;

  constructor(options: ClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.serverConfigPath = options.serverConfigPath ?? defaultTldrawServerConfigPath();
    this.agentDir = options.agentDir ?? getAgentDir();
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  readServerConfig(): TldrawServerConfig {
    if (!existsSync(this.serverConfigPath)) {
      throw new TldrawRuntimeError(
        "not_running",
        "tldraw offline is not running. Open the desktop app and a canvas first.",
      );
    }
    try {
      const parsed = JSON.parse(
        readFileSync(this.serverConfigPath, "utf8"),
      ) as Partial<TldrawServerConfig>;
      if (
        !Number.isInteger(parsed.port) ||
        Number(parsed.port) < 1 ||
        Number(parsed.port) > 65535 ||
        typeof parsed.token !== "string" ||
        !parsed.token
      ) {
        throw new Error("missing port or token");
      }
      return parsed as TldrawServerConfig;
    } catch (error) {
      if (error instanceof TldrawRuntimeError) throw error;
      throw new TldrawRuntimeError(
        "stale_config",
        "The tldraw server configuration is invalid or stale. Restart tldraw offline.",
      );
    }
  }

  async status(signal?: AbortSignal): Promise<TldrawRuntimeStatus> {
    return (await this.observe(signal)).status;
  }

  async observe(signal?: AbortSignal): Promise<TldrawRuntimeObservation> {
    let config: TldrawServerConfig;
    try {
      config = this.readServerConfig();
    } catch (error) {
      if (error instanceof TldrawRuntimeError)
        return {
          status: {
            kind: error.code === "not_running" ? "not-running" : "stale-config",
            skillReadiness: this.skillReadiness(),
            message: error.message,
          },
          documents: [],
        };
      throw error;
    }

    try {
      const capabilities = await this.capabilities(signal);
      const documents = await this.documents(signal);
      const focused = documents.find((document) => document.focusOrder === 0) ?? documents[0];
      return {
        status: {
          kind: documents.length > 0 ? "ready" : "no-open-document",
          port: config.port,
          openDocuments: documents.length,
          focusedDocumentName: focused?.name,
          capabilities,
          skillReadiness: this.skillReadiness(),
          message:
            documents.length > 0
              ? "Canvas API v1.12 contract ready."
              : "Canvas API v1.12 contract is ready, but no document is open.",
        },
        documents,
      };
    } catch (error) {
      if (error instanceof TldrawRuntimeError) {
        const kind =
          error.code === "auth_error"
            ? "auth-error"
            : error.code === "unsupported"
              ? "incompatible"
              : "stale-config";
        return {
          status: {
            kind,
            port: config.port,
            skillReadiness: this.skillReadiness(),
            message: error.message,
          },
          documents: [],
        };
      }
      throw error;
    }
  }

  async capabilities(signal?: AbortSignal): Promise<RuntimeCapabilities> {
    if (this.verifiedCapabilities) return { ...this.verifiedCapabilities };
    let readme: string;
    try {
      readme = await this.requestText("GET", "/readme", signal);
    } catch (error) {
      if (error instanceof TldrawRuntimeError && error.code === "not_found") {
        throw new TldrawRuntimeError(
          "unsupported",
          "The local tldraw runtime does not expose the required Canvas API v1.12 contract. Update tldraw offline and retry.",
          error.status,
        );
      }
      throw error;
    }
    const missing = REQUIRED_V112_CONTRACT_MARKERS.filter((marker) => !readme.includes(marker));
    if (missing.length > 0) {
      throw new TldrawRuntimeError(
        "unsupported",
        "The local tldraw runtime does not satisfy the required Canvas API v1.12 contract. Update tldraw offline and retry.",
      );
    }
    this.verifiedCapabilities = { ...V112_CAPABILITIES };
    return { ...this.verifiedCapabilities };
  }

  skillReadiness(): TldrawSkillReadiness {
    const skillPath = path.join(this.agentDir, TLDRAW_SKILL_RELATIVE_PATH);
    if (!existsSync(skillPath)) {
      return {
        kind: "missing",
        managed: false,
        message:
          "The app-managed tldraw-offline Pi skill is missing. In tldraw offline, choose Develop → Install Agent Skills.",
      };
    }

    let skillContent: string;
    try {
      skillContent = readFileSync(skillPath, "utf8");
    } catch {
      return {
        kind: "unknown",
        managed: false,
        message:
          "The tldraw-offline Pi skill could not be inspected. In tldraw offline, choose Develop → Install Agent Skills to repair it.",
      };
    }
    if (!skillContent.includes(TLDRAW_SKILL_MARKER)) {
      return {
        kind: "unmanaged",
        managed: false,
        message:
          "The discovered tldraw-offline Pi skill is not app-managed. Review the conflict, then use Develop → Install Agent Skills if the app-owned copy should win.",
      };
    }

    const manifestPath = path.join(path.dirname(this.serverConfigPath), "agent-skills.json");
    if (!existsSync(manifestPath)) {
      return {
        kind: "unknown",
        managed: true,
        message:
          "The app-managed tldraw-offline Pi skill is present, but its install manifest is unavailable. Re-run Develop → Install Agent Skills to establish freshness evidence.",
      };
    }
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        appVersion?: unknown;
        files?: unknown;
      };
      const manifestVersion =
        typeof manifest.appVersion === "string" ? manifest.appVersion : undefined;
      const files = Array.isArray(manifest.files)
        ? manifest.files.filter((value): value is string => typeof value === "string")
        : [];
      const recordsPiSkill = files.some((value) => samePath(value, skillPath));
      if (!manifestVersion || !isAtLeastVersion(manifestVersion, 1, 12) || !recordsPiSkill) {
        return {
          kind: "stale",
          managed: true,
          manifestVersion,
          message:
            "The app-managed tldraw-offline Pi skill is stale or not recorded for this Pi agent directory. In tldraw offline, choose Develop → Install Agent Skills.",
        };
      }
      return {
        kind: "ready",
        managed: true,
        manifestVersion,
        message: `App-managed tldraw-offline Pi skill ready (installed by tldraw ${manifestVersion}).`,
      };
    } catch {
      return {
        kind: "unknown",
        managed: true,
        message:
          "The app-managed tldraw-offline Pi skill is present, but its install manifest is invalid. Re-run Develop → Install Agent Skills to repair it.",
      };
    }
  }

  async documents(signal?: AbortSignal): Promise<TldrawDocumentSummary[]> {
    return this.searchCode<TldrawDocumentSummary[]>(
      "const docs=await api.getDocs(); return docs.map((doc,index)=>({id:doc.id,name:doc.name,shapeCount:doc.shapeCount,pageName:doc.pageName,focusOrder:doc.focusOrder ?? index}))",
      signal,
    );
  }

  async resolveDocument(
    documentId: string | undefined,
    signal?: AbortSignal,
    observedDocuments?: TldrawDocumentSummary[],
  ): Promise<TldrawDocumentSummary> {
    const documents = observedDocuments ?? (await this.documents(signal));
    if (documentId) {
      const exact = documents.find((document) => document.id === documentId);
      if (!exact)
        throw new TldrawRuntimeError(
          "not_found",
          `Open tldraw document '${safeLabel(documentId)}' was not found.`,
        );
      return exact;
    }
    const focused = documents.find((document) => document.focusOrder === 0) ?? documents[0];
    if (!focused)
      throw new TldrawRuntimeError(
        "no_open_document",
        "No tldraw document is open. Open or create a board in tldraw offline, then retry.",
      );
    return focused;
  }

  async execute<T>(documentId: string, script: string, signal?: AbortSignal): Promise<T> {
    if (!script.trim()) throw new TldrawRuntimeError("execution_failed", "Canvas script is empty.");
    await this.capabilities(signal);
    return this.request<T>(
      "POST",
      `/api/doc/${documentPathId(documentId)}/exec`,
      script,
      signal,
      true,
    );
  }

  async screenshot(
    documentId: string,
    options: {
      size?: "small" | "medium" | "large" | "full";
      mode?: "canvas" | "window";
      bounds?: { x: number; y: number; w: number; h: number };
    } = {},
    signal?: AbortSignal,
  ): Promise<RuntimeScreenshot> {
    const code = `return await api.getScreenshot(${JSON.stringify(documentId)},${JSON.stringify(options)})`;
    const screenshot = await this.searchCode<RuntimeScreenshot>(code, signal);
    return validateRuntimeScreenshot(screenshot);
  }

  async createDocument(name: string, signal?: AbortSignal): Promise<TldrawCreatedDocument> {
    const safeName = validateDocumentName(name);
    await this.capabilities(signal);
    const created = await this.request<Record<string, unknown>>(
      "POST",
      "/api/docs/create",
      JSON.stringify({ name: safeName }),
      signal,
      true,
      "application/json",
      CREATE_DOCUMENT_TIMEOUT_MS,
    );
    if (
      typeof created.id !== "string" ||
      !created.id ||
      typeof created.documentId !== "string" ||
      !created.documentId ||
      typeof created.name !== "string" ||
      !created.name ||
      typeof created.windowId !== "number" ||
      !Number.isFinite(created.windowId)
    ) {
      throw new TldrawRuntimeError(
        "invalid_response",
        "tldraw created a document but returned incomplete document metadata.",
      );
    }
    return {
      id: created.id,
      documentId: created.documentId,
      name: created.name,
      windowId: created.windowId,
    };
  }

  private async searchCode<T>(code: string, signal?: AbortSignal): Promise<T> {
    await this.capabilities(signal);
    return this.request<T>(
      "POST",
      "/api/search",
      JSON.stringify({ code }),
      signal,
      true,
      "application/json",
    );
  }

  private async requestText(
    method: "GET" | "POST",
    pathname: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const { response, text } = await this.transport(method, pathname, undefined, signal);
    if (!response.ok) throw runtimeHttpError(parseJson(text), response.status);
    return text;
  }

  private async request<T>(
    method: "GET" | "POST",
    pathname: string,
    body: string | undefined,
    signal: AbortSignal | undefined,
    unwrapEnvelope: boolean,
    contentType = "text/plain",
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const { response, text } = await this.transport(
      method,
      pathname,
      body,
      signal,
      contentType,
      timeoutMs,
    );
    const parsed = parseJson(text);
    if (!response.ok) throw runtimeHttpError(parsed, response.status);
    if (!unwrapEnvelope) return parsed as T;
    const envelope = parsed as ApiEnvelope<T>;
    if (envelope.success === false)
      throw new TldrawRuntimeError(
        "execution_failed",
        safeRuntimeMessage(envelope, response.status),
        response.status,
      );
    if (!("result" in envelope))
      throw new TldrawRuntimeError(
        "invalid_response",
        "tldraw returned a response without a result.",
        response.status,
      );
    return envelope.result as T;
  }

  private async transport(
    method: "GET" | "POST",
    pathname: string,
    body: string | undefined,
    signal: AbortSignal | undefined,
    contentType = "text/plain",
    timeoutMs = this.timeoutMs,
  ): Promise<{ response: Response; text: string }> {
    const config = this.readServerConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await this.fetchImpl(`http://127.0.0.1:${config.port}${pathname}`, {
        method,
        headers: {
          authorization: `Bearer ${config.token}`,
          ...(body !== undefined ? { "content-type": contentType } : {}),
        },
        body,
        signal: controller.signal,
      });
      return { response, text: await response.text() };
    } catch (error) {
      if (error instanceof TldrawRuntimeError) throw error;
      if (controller.signal.aborted)
        throw new TldrawRuntimeError("timeout", "tldraw Canvas API request timed out.");
      throw new TldrawRuntimeError(
        "stale_config",
        "Could not reach the tldraw Canvas API. Restart tldraw offline and retry.",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

function runtimeHttpError(payload: unknown, status: number): TldrawRuntimeError {
  const message = safeRuntimeMessage(payload, status);
  if (status === 400) return new TldrawRuntimeError("invalid_request", message, status);
  if (status === 401 || status === 403)
    return new TldrawRuntimeError("auth_error", message, status);
  if (status === 404) return new TldrawRuntimeError("not_found", message, status);
  if (status === 409) return new TldrawRuntimeError("conflict", message, status);
  return new TldrawRuntimeError("execution_failed", message, status);
}

function validateDocumentName(value: string): string {
  const name = value.trim();
  if (
    name.length < 1 ||
    name.length > 120 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.toLowerCase().endsWith(".tldr") ||
    (/\.[^.]+$/.test(name) && !name.toLowerCase().endsWith(".tldraw"))
  ) {
    throw new TldrawRuntimeError(
      "invalid_request",
      "Document name must be a plain file name up to 120 characters with no path separators and either no extension or the .tldraw extension.",
    );
  }
  return name;
}

function isAtLeastVersion(value: string, requiredMajor: number, requiredMinor: number): boolean {
  const match = value.match(/^(\d+)\.(\d+)(?:\.|$)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > requiredMajor || (major === requiredMajor && minor >= requiredMinor);
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => path.resolve(value).replaceAll("\\", "/");
  const a = normalize(left);
  const b = normalize(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function safeRuntimeMessage(payload: unknown, status: number): string {
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const raw =
    typeof value.error === "string" ? value.error : `tldraw Canvas API returned HTTP ${status}.`;
  return sanitizeRuntimeText(raw).slice(0, 500);
}

export function validateRuntimeScreenshot(value: unknown): RuntimeScreenshot {
  return inspectRuntimeScreenshotFile(value, false).screenshot;
}

export function readValidatedRuntimeScreenshot(value: unknown): {
  screenshot: RuntimeScreenshot;
  bytes: Buffer;
} {
  const inspected = inspectRuntimeScreenshotFile(value, true);
  if (!inspected.bytes) throw new Error("validated screenshot bytes were not read");
  return { screenshot: inspected.screenshot, bytes: inspected.bytes };
}

function inspectRuntimeScreenshotFile(
  value: unknown,
  includeBytes: boolean,
): { screenshot: RuntimeScreenshot; bytes?: Buffer } {
  const screenshot = screenshotMetadata(value);
  let descriptor: number | undefined;
  try {
    const allowedRoot = realpathSync(path.join(os.tmpdir(), "tldraw-canvas-api"));
    const requestedPath = path.resolve(screenshot.filePath);
    const source = realpathSync(requestedPath);
    if (source !== allowedRoot && !source.startsWith(`${allowedRoot}${path.sep}`)) {
      throw new Error("outside capture directory");
    }

    // O_NOFOLLOW is undefined on Windows, so openSync would follow a symlink
    // there. Reject links explicitly first; the fstat identity check below
    // still guards against a swap between this check and the open.
    if (lstatSync(requestedPath).isSymbolicLink()) {
      throw new Error("symbolic link");
    }
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    descriptor = openSync(requestedPath, fsConstants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor);
    const current = statSync(source);
    if (
      !opened.isFile() ||
      opened.dev !== current.dev ||
      opened.ino !== current.ino ||
      opened.size < 4 ||
      opened.size > 50_000_000
    ) {
      throw new Error("invalid regular file");
    }

    const bytes = includeBytes ? readFileSync(descriptor) : undefined;
    const header = bytes?.subarray(0, 8) ?? Buffer.alloc(8);
    if (!bytes) readSync(descriptor, header, 0, header.length, 0);
    const afterRead = fstatSync(descriptor);
    if (afterRead.size !== opened.size || afterRead.mtimeMs !== opened.mtimeMs) {
      throw new Error("screenshot changed while it was read");
    }
    if (bytes && bytes.length !== opened.size) throw new Error("incomplete screenshot read");

    const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const png = header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!jpeg && !png) throw new Error("unsupported image type");
    return {
      screenshot: { ...screenshot, filePath: source, format: png ? "png" : "jpeg" },
      ...(bytes ? { bytes } : {}),
    };
  } catch {
    throw new TldrawRuntimeError(
      "invalid_response",
      "tldraw screenshot evidence failed local file validation.",
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function screenshotMetadata(value: unknown): RuntimeScreenshot {
  if (!value || typeof value !== "object") {
    throw new TldrawRuntimeError(
      "invalid_response",
      "tldraw returned invalid screenshot metadata.",
    );
  }
  const screenshot = value as Partial<RuntimeScreenshot>;
  if (
    typeof screenshot.filePath !== "string" ||
    typeof screenshot.width !== "number" ||
    !Number.isFinite(screenshot.width) ||
    screenshot.width <= 0 ||
    typeof screenshot.height !== "number" ||
    !Number.isFinite(screenshot.height) ||
    screenshot.height <= 0 ||
    typeof screenshot.pageName !== "string" ||
    (screenshot.captureMode !== "canvas" && screenshot.captureMode !== "window")
  ) {
    throw new TldrawRuntimeError(
      "invalid_response",
      "tldraw returned incomplete screenshot metadata.",
    );
  }
  return screenshot as RuntimeScreenshot;
}

function safeLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9:._-]/g, "").slice(0, 120);
}

function documentPathId(value: string): string {
  const safe = safeLabel(value);
  if (!safe || safe !== value || value.includes("/")) {
    throw new TldrawRuntimeError("not_found", "Invalid tldraw document id.");
  }
  // The desktop router matches the opaque id literally; percent-encoding the
  // colons changes the lookup key and produces a false Document-not-found.
  return safe;
}
