/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { connFromAlias, clearConnectionCache } from "../../../lib/common/sf-conn/connection.ts";
import { resolveSfPiPackageRootPath } from "../../../lib/common/sf-pi-package-root.ts";
import { connRequest } from "../../../lib/common/sf-conn/request.ts";
import { detectEnvironment } from "../../../lib/common/sf-environment/detect.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { buildApiPath, type QueryParams } from "../../../lib/common/sf-rest/path.ts";
import {
  normalizeTargetOrg,
  resolveApiVersion,
  resolveExplicitTargetOrg,
  resolveOrgType,
} from "../../../lib/common/sf-rest/target-org.ts";
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
    query?: QueryParams;
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

let transportPromise: Promise<SfDataExplorerTransport> | undefined;
const envCache = new Map<string, SfEnvironment>();

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
  const sfPiPath = await resolveBundledSfPiPath();
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
  const loadEnv = async (): Promise<SfEnvironment> => {
    const cached = envCache.get(cwd);
    if (cached) return cached;
    const env = await detectEnvironment(exec, cwd);
    envCache.set(cwd, env);
    return env;
  };
  const envPromise = loadEnv().catch(() => null);

  async function resolveTarget(targetOrg?: string): Promise<TargetContext> {
    const env = (await envPromise) ?? (await loadEnv());
    const requestedOrg = targetOrg && targetOrg !== "default" ? targetOrg : undefined;
    const resolvedTargetOrg = normalizeTargetOrg(requestedOrg, env) ?? requestedOrg;
    const targetOrgInfo = await resolveExplicitTargetOrg(resolvedTargetOrg, env).catch(
      () => undefined,
    );
    const apiVersion = resolveApiVersion(env, targetOrgInfo);
    const orgType = resolveOrgType(resolvedTargetOrg, env, targetOrgInfo);
    return { targetOrg: resolvedTargetOrg, apiVersion, orgType };
  }

  async function callRest<T = unknown>(args: {
    targetOrg?: string;
    method: Method;
    path: string;
    query?: QueryParams;
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
    const conn = await connFromAlias(context.targetOrg);
    const url = buildApiPath(args.path, context.apiVersion, args.query);
    const resp = await connRequest<T>(conn, {
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
      clearConnectionCache();
    },
  };
}

async function resolveBundledSfPiPath(): Promise<string> {
  return resolveSfPiPackageRootPath({ from: import.meta.url }) ?? process.cwd();
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
