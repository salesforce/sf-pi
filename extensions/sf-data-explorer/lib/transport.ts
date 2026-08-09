/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  connectSalesforce,
  type HttpMethod,
  type SalesforceQueryParams,
  type SalesforceSession,
} from "../../../lib/common/sf-conn/index.ts";
import { resolveSfPiPackageRootPath } from "../../../lib/common/sf-pi-package-root.ts";
import type {
  CoreQueryResponse,
  CoreSearchResponse,
  Data360SqlResponse,
} from "./result-normalize.ts";

export type Method = HttpMethod;

export interface TargetContext {
  targetOrg: string;
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
    query?: SalesforceQueryParams;
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
}

const transportPromises = new Map<string, Promise<SfDataExplorerTransport>>();

export function getSfDataExplorerTransport(
  _pi: ExtensionAPI,
  cwd: string,
): Promise<SfDataExplorerTransport> {
  const key = path.resolve(cwd);
  let pending = transportPromises.get(key);
  if (!pending) {
    pending = initialize(key).catch((error: unknown) => {
      if (transportPromises.get(key) === pending) transportPromises.delete(key);
      throw error;
    });
    transportPromises.set(key, pending);
  }
  return pending;
}

async function initialize(cwd: string): Promise<SfDataExplorerTransport> {
  const sfPiPath = await resolveBundledSfPiPath();
  const sourceCommit = await tryReadCommit(sfPiPath);

  const connect = (
    targetOrg?: string,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<SalesforceSession> =>
    connectSalesforce({
      cwd,
      targetOrg: targetOrg === "default" ? undefined : targetOrg,
      signal,
      timeoutMs,
    });

  const contextFrom = (sf: SalesforceSession): TargetContext => ({
    targetOrg: sf.target.targetOrg,
    apiVersion: sf.target.apiVersion,
    orgType: sf.target.orgType,
  });

  async function resolveTarget(targetOrg?: string): Promise<TargetContext> {
    return contextFrom(await connect(targetOrg));
  }

  async function callRest<T = unknown>(args: {
    targetOrg?: string;
    method: Method;
    path: string;
    query?: SalesforceQueryParams;
    body?: unknown;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<RestResponse<T>> {
    if (args.signal?.aborted) throw new Error("sf-data-explorer call cancelled before request.");
    const sf = await connect(args.targetOrg, args.signal, args.timeoutMs);
    const response = await sf.request<T>({
      method: args.method,
      path: args.path,
      query: args.query,
      body: args.method === "GET" ? undefined : args.body,
      timeoutMs: args.timeoutMs ?? 120_000,
      signal: args.signal,
    });
    if (response.status >= 400) {
      throw new Error(
        `${args.method} ${response.path.split("?", 1)[0]} failed: ${response.status}`,
      );
    }
    return {
      status: response.status,
      body: response.body,
      path: response.path,
      context: contextFrom(sf),
    };
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
