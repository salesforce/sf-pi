/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  CoreQueryResponse,
  CoreSearchResponse,
  Data360SqlResponse,
} from "./result-normalize.ts";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface TargetContext {
  targetOrg?: string;
  apiVersion: string;
  orgType: string;
}

export interface RestResponse<T> {
  status: number;
  body: T;
  path: string;
  context: TargetContext;
}

export interface SfDataExplorerTransportInfo {
  mode: "sf-pi-internals";
  sfPiPath: string;
  sourceCommit?: string;
}

export interface SfDataExplorerTransport {
  info: SfDataExplorerTransportInfo;
  resolveTarget(targetOrg?: string): Promise<TargetContext>;
  callRest<T = unknown>(args: {
    targetOrg?: string;
    method: Method;
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<RestResponse<T>>;
  querySoql(args: {
    targetOrg?: string;
    soql: string;
    queryAll?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<RestResponse<CoreQueryResponse>>;
  searchSosl(args: {
    targetOrg?: string;
    sosl: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<RestResponse<CoreSearchResponse>>;
  queryData360Sql(args: {
    targetOrg?: string;
    sql: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<RestResponse<Data360SqlResponse>>;
  clearCache(): void;
}

type ExecResult = { stdout: string; stderr: string; code: number | null };

interface SfPiModules {
  connFromAlias: (alias?: string) => Promise<unknown>;
  connRequest: <T>(
    conn: unknown,
    opts: {
      method: Method;
      url: string;
      body?: unknown;
      timeoutMs?: number;
      headers?: Record<string, string>;
    },
  ) => Promise<{ status: number; body: T }>;
  clearConnectionCache: () => void;
  buildApiPath: (path: string, apiVersion: string, query?: Record<string, unknown>) => string;
  resolveApiVersion: (env: unknown, targetOrgInfo?: unknown) => string;
  resolveExplicitTargetOrg: (targetOrg: string | undefined, env: unknown) => Promise<unknown>;
  normalizeTargetOrg: (targetOrg: string | undefined, env: unknown) => string | undefined;
  resolveOrgType?: (targetOrg: string | undefined, env: unknown, targetOrgInfo?: unknown) => string;
  detectEnvironment: (
    exec: (
      command: string,
      args: string[],
      options?: { timeout?: number; cwd?: string },
    ) => Promise<ExecResult>,
    cwd: string,
  ) => Promise<unknown>;
}

let transportPromise: Promise<SfDataExplorerTransport> | undefined;
const envCache = new Map<string, unknown>();

export function getSfDataExplorerTransport(pi: ExtensionAPI): Promise<SfDataExplorerTransport> {
  transportPromise ??= initialize(pi);
  return transportPromise;
}

export function clearSfDataExplorerTransportCacheIfInitialized(): void {
  envCache.clear();
  const initialized = transportPromise;
  if (!initialized) return;
  void initialized
    .then((transport) => transport.clearCache())
    .catch(() => {
      // Ignore initialization failures here. Explicit command invocation surfaces them.
    });
}

async function initialize(pi: ExtensionAPI): Promise<SfDataExplorerTransport> {
  const sfPiPath = await resolveSfPiPath();
  const modules = await loadModules(sfPiPath);
  const sourceCommit = await tryReadCommit(sfPiPath);
  const cwd = process.cwd();
  const exec = async (
    command: string,
    args: string[],
    options?: { timeout?: number; cwd?: string },
  ): Promise<ExecResult> => {
    const result = await pi.exec(command, args, {
      timeout: options?.timeout,
      cwd: options?.cwd ?? cwd,
    });
    return { stdout: result.stdout, stderr: result.stderr, code: result.code };
  };
  const loadEnv = async (): Promise<unknown> => {
    const cached = envCache.get(cwd);
    if (cached) return cached;
    const env = await modules.detectEnvironment(exec, cwd);
    envCache.set(cwd, env);
    return env;
  };
  const envPromise = loadEnv().catch(() => null);

  async function resolveTarget(targetOrg?: string): Promise<TargetContext> {
    const env = (await envPromise) ?? (await loadEnv());
    const requestedOrg = targetOrg && targetOrg !== "default" ? targetOrg : undefined;
    const resolvedTargetOrg = modules.normalizeTargetOrg(requestedOrg, env) ?? requestedOrg;
    const targetOrgInfo = await modules
      .resolveExplicitTargetOrg(resolvedTargetOrg, env)
      .catch(() => undefined);
    const apiVersion = modules.resolveApiVersion(env, targetOrgInfo);
    const orgType = modules.resolveOrgType?.(resolvedTargetOrg, env, targetOrgInfo) ?? "unknown";
    return { targetOrg: resolvedTargetOrg, apiVersion, orgType };
  }

  async function callRest<T = unknown>(args: {
    targetOrg?: string;
    method: Method;
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<RestResponse<T>> {
    if (args.signal?.aborted) throw new Error("sf-data-explorer call cancelled before request.");
    const context = await resolveTarget(args.targetOrg);
    if (!context.targetOrg)
      throw new Error(
        "No Salesforce target org is configured. Pass a target org or set sf config target-org.",
      );
    const conn = await modules.connFromAlias(context.targetOrg);
    const url = modules.buildApiPath(args.path, context.apiVersion, args.query);
    const resp = await modules.connRequest<T>(conn, {
      method: args.method,
      url,
      body: args.method === "GET" ? undefined : args.body,
      timeoutMs: args.timeoutMs ?? 120_000,
    });
    if (resp.status >= 400) {
      const text = typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body);
      throw new Error(`${args.method} ${url} failed: ${resp.status} ${text}`);
    }
    return { status: resp.status, body: resp.body, path: url, context };
  }

  return {
    info: { mode: "sf-pi-internals", sfPiPath, sourceCommit },
    resolveTarget,
    callRest,
    querySoql: (args) =>
      callRest<CoreQueryResponse>({
        targetOrg: args.targetOrg,
        method: "GET",
        path: args.queryAll ? "/queryAll" : "/query",
        query: { q: args.soql },
        timeoutMs: args.timeoutMs,
        signal: args.signal,
      }),
    searchSosl: (args) =>
      callRest<CoreSearchResponse>({
        targetOrg: args.targetOrg,
        method: "GET",
        path: "/search",
        query: { q: args.sosl },
        timeoutMs: args.timeoutMs,
        signal: args.signal,
      }),
    queryData360Sql: (args) =>
      callRest<Data360SqlResponse>({
        targetOrg: args.targetOrg,
        method: "POST",
        path: "/ssot/query-sql",
        body: { sql: args.sql },
        timeoutMs: args.timeoutMs,
        signal: args.signal,
      }),
    clearCache: () => {
      envCache.clear();
      modules.clearConnectionCache();
    },
  };
}

async function loadModules(sfPiPath: string): Promise<SfPiModules> {
  const url = (rel: string): string => `file://${path.join(sfPiPath, rel)}`;
  const [conn, req, p, t, env] = await Promise.all([
    import(url("lib/common/sf-conn/connection.ts")),
    import(url("lib/common/sf-conn/request.ts")),
    import(url("extensions/sf-data360/lib/path.ts")),
    import(url("extensions/sf-data360/lib/target-org.ts")),
    import(url("lib/common/sf-environment/detect.ts")),
  ]);
  return {
    connFromAlias: conn.connFromAlias,
    connRequest: req.connRequest,
    clearConnectionCache: conn.clearConnectionCache,
    buildApiPath: p.buildApiPath,
    resolveApiVersion: t.resolveApiVersion,
    resolveExplicitTargetOrg: t.resolveExplicitTargetOrg,
    normalizeTargetOrg: t.normalizeTargetOrg,
    resolveOrgType: t.resolveOrgType,
    detectEnvironment: env.detectEnvironment,
  };
}

export async function resolveSfPiPath(): Promise<string> {
  const candidates: string[] = [];
  if (process.env.SF_DATA_EXPLORER_SFPI_PATH)
    candidates.push(process.env.SF_DATA_EXPLORER_SFPI_PATH);
  const here = path.dirname(fileURLToPath(import.meta.url));
  candidates.push(...ancestorCandidates(here));
  candidates.push(...ancestorCandidates(process.cwd()));
  candidates.push(path.join(os.homedir(), ".pi/agent/git/github.com/salesforce/sf-pi"));
  for (const candidate of Array.from(new Set(candidates))) {
    try {
      const stat = await fs.stat(path.join(candidate, "lib/common/sf-conn/connection.ts"));
      if (stat.isFile()) return candidate;
    } catch {
      // continue
    }
  }
  throw new Error(
    "sf-data-explorer requires sf-pi. Install with `pi install git:github.com/salesforce/sf-pi` or set SF_DATA_EXPLORER_SFPI_PATH.",
  );
}

function ancestorCandidates(start: string): string[] {
  const out: string[] = [];
  let cur = path.resolve(start);
  for (let i = 0; i < 8; i += 1) {
    out.push(cur);
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return out;
}

async function tryReadCommit(sfPiPath: string): Promise<string | undefined> {
  try {
    const head = (await fs.readFile(path.join(sfPiPath, ".git", "HEAD"), "utf8")).trim();
    if (head.startsWith("ref:")) {
      const refPath = head.slice(4).trim();
      const sha = (await fs.readFile(path.join(sfPiPath, ".git", refPath), "utf8")).trim();
      return sha.slice(0, 7);
    }
    return head.slice(0, 7);
  } catch {
    return undefined;
  }
}

export function transportLabel(info: SfDataExplorerTransportInfo): string {
  return info.sourceCommit ? `transport: sf-pi @ ${info.sourceCommit}` : "transport: sf-pi";
}
