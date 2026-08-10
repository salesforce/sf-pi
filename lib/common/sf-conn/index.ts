/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared Salesforce Connection Module.
 *
 * Every Salesforce-org caller receives one target resolution, one API-version
 * decision, one cached SDK Connection, and one bounded request/query seam.
 * Callers provide versionless resource paths; this module owns versioned URLs.
 */

import path from "node:path";
import type { ConfigAggregator as ConfigAggregatorClass, Connection } from "@salesforce/core";
import {
  clearConnectionCache,
  clearConnectionCacheEntry,
  orgFromAlias,
  resolveOrgIdentity,
  type OrgIdentity,
  type ResolveOrgIdentityOptions,
} from "./connection.ts";
import { connRequest, type HttpMethod } from "./request.ts";
export type { HttpMethod } from "./request.ts";
export { normalizeSalesforceResource } from "./path.ts";
export type { SalesforceQueryParams, SalesforceQueryValue } from "./path.ts";
import {
  buildSalesforceApiPath,
  buildSalesforceInstancePath,
  isVersionedSalesforceResource,
  normalizeSalesforceResource,
  type SalesforceQueryParams,
} from "./path.ts";
import type { OrgType } from "../sf-environment/types.ts";

const DEFAULT_CONNECTION_TIMEOUT_MS = 90_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const MAX_QUERY_PAGES = 100;
const API_VERSION_RE = /^\d+(?:\.\d+)?$/;

let configAggregatorCtor: typeof ConfigAggregatorClass | undefined;
async function getConfigAggregatorCtor(): Promise<typeof ConfigAggregatorClass> {
  if (configAggregatorCtor) return configAggregatorCtor;
  const mod = await import("@salesforce/core");
  configAggregatorCtor = mod.ConfigAggregator;
  return configAggregatorCtor;
}

export type SalesforceVersionSource = "org-latest" | "configured-fallback";

export interface SalesforceTarget {
  /** Explicit or configured alias/username used to resolve this target. */
  readonly targetOrg: string;
  readonly alias?: string;
  readonly username?: string;
  readonly orgId?: string;
  readonly instanceUrl: string;
  readonly orgType: OrgType;
  /** Effective API version selected for every request on this session. */
  readonly apiVersion: string;
  /** Highest version advertised by the org, when discovery succeeded. */
  readonly maxApiVersion?: string;
  readonly versionSource: SalesforceVersionSource;
  /** Explicit org-api-version available if latest discovery fails. */
  readonly configuredFallback?: string;
  /** Bounded public-safe warning explaining why configured fallback was used. */
  readonly versionDiscoveryWarning?: string;
}

export interface ConnectSalesforceOptions {
  cwd: string;
  targetOrg?: string;
  fresh?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SalesforceRequestInput {
  method: HttpMethod;
  /** Data resource by default; use instance scope only for non-data routes such as SOAP. */
  scope?: "data" | "instance";
  /** Resource relative to the selected scope. */
  path: string;
  query?: SalesforceQueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SalesforceResponse<T> {
  status: number;
  body: T;
  /** Effective versioned path sent to the target org. */
  path: string;
  target: SalesforceTarget;
  warnings: string[];
}

export interface SalesforceQueryInput {
  soql: string;
  api?: "rest" | "tooling";
  queryAll?: boolean;
  maxRows: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SalesforceQueryResult<T> {
  records: T[];
  totalSize?: number;
  done: boolean;
  nextRecordsUrl?: string;
  truncated: boolean;
  target: SalesforceTarget;
}

export interface SalesforceSession {
  readonly target: SalesforceTarget;
  /** Verified/configured SDK connection for SDK-only, SOAP, and metadata operations. */
  readonly connection: Connection;
  identity(options?: ResolveOrgIdentityOptions): Promise<OrgIdentity>;
  path(resource: string, query?: SalesforceQueryParams): string;
  request<T = unknown>(input: SalesforceRequestInput): Promise<SalesforceResponse<T>>;
  /** Normalize a server-provided versioned continuation back to this session's selected version. */
  continueRequest<T = unknown>(input: SalesforceRequestInput): Promise<SalesforceResponse<T>>;
  query<T = Record<string, unknown>>(
    input: SalesforceQueryInput,
  ): Promise<SalesforceQueryResult<T>>;
}

interface ResolvedConnectionConfig {
  targetOrg: string;
  configuredApiVersion?: string;
}

interface VersionSelection {
  apiVersion: string;
  maxApiVersion?: string;
  source: SalesforceVersionSource;
  warning?: string;
}

interface VersionEntry {
  version?: unknown;
}

const sessionCache = new Map<string, Promise<SalesforceSession>>();
const observedSessionStarts = new WeakSet<object>();

export async function connectSalesforce(
  options: ConnectSalesforceOptions,
): Promise<SalesforceSession> {
  if (options.signal?.aborted) throw new SalesforceConnectionAbortedError();
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const config = await waitForCaller(
    resolveConnectionConfig(options.cwd, options.targetOrg, options.fresh),
    remainingCallerTime(deadline, timeoutMs),
    options.signal,
  );
  const cacheKey = connectionCacheKey(options.cwd, config.targetOrg);
  if (options.fresh) sessionCache.delete(cacheKey);

  let pending = sessionCache.get(cacheKey);
  if (!pending) {
    pending = initializeSalesforceSession(config, cacheKey, options.fresh).catch(
      (error: unknown) => {
        if (sessionCache.get(cacheKey) === pending) {
          sessionCache.delete(cacheKey);
          clearConnectionCacheEntry(cacheKey);
        }
        throw error;
      },
    );
    sessionCache.set(cacheKey, pending);
  }
  return waitForCaller(pending, remainingCallerTime(deadline, timeoutMs), options.signal);
}

/**
 * Reset shared connections once for one Pi session_start event object.
 * Multiple connection-owning extensions receive the same event; only the first
 * call clears, so auth/config changes are picked up without cross-extension races.
 */
export function beginSalesforceConnectionSession(event: unknown): void {
  if (!event || typeof event !== "object") {
    clearSalesforceConnectionCache();
    return;
  }
  if (observedSessionStarts.has(event)) return;
  observedSessionStarts.add(event);
  clearSalesforceConnectionCache();
}

/** Clear every shared session and underlying SDK Org. Primarily for tests. */
export function clearSalesforceConnectionCache(): void {
  sessionCache.clear();
  clearConnectionCache();
}

function remainingCallerTime(deadline: number, originalTimeoutMs: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new SalesforceConnectionTimeoutError(originalTimeoutMs);
  return remaining;
}

async function waitForCaller<T>(
  pending: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal?.aborted) throw new SalesforceConnectionAbortedError();

  let timer: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new SalesforceConnectionTimeoutError(timeoutMs)), timeoutMs);
  });
  const abort = signal
    ? new Promise<T>((_resolve, reject) => {
        abortHandler = () => reject(new SalesforceConnectionAbortedError());
        signal.addEventListener("abort", abortHandler, { once: true });
      })
    : undefined;

  try {
    return await Promise.race(abort ? [pending, timeout, abort] : [pending, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
  }
}

function connectionCacheKey(cwd: string, targetOrg: string): string {
  return `${path.resolve(cwd)}::${targetOrg}`;
}

async function resolveConnectionConfig(
  cwd: string,
  explicitTargetOrg: string | undefined,
  fresh = false,
): Promise<ResolvedConnectionConfig> {
  const explicit = normalizeTargetOrg(explicitTargetOrg);
  let configuredTarget: string | undefined;
  let configuredApiVersion: string | undefined;

  try {
    const ConfigAggregator = await getConfigAggregatorCtor();
    if (fresh) await ConfigAggregator.clearInstance(cwd);
    const aggregator = await ConfigAggregator.create({ projectPath: cwd });
    configuredTarget = normalizeTargetOrg(aggregator.getInfo("target-org")?.value);
    configuredApiVersion = normalizeConfiguredApiVersion(
      aggregator.getInfo("org-api-version")?.value,
    );
  } catch (error) {
    if (error instanceof SalesforceConnectionConfigError) throw error;
    if (!explicit) {
      throw new SalesforceTargetOrgError(
        `Unable to resolve Salesforce target-org configuration: ${safeErrorMessage(error)}`,
      );
    }
  }

  const targetOrg = explicit ?? configuredTarget;
  if (!targetOrg) {
    throw new SalesforceTargetOrgError(
      "No Salesforce target org is configured. Pass target_org or configure target-org.",
    );
  }
  return { targetOrg, configuredApiVersion };
}

function normalizeTargetOrg(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.toLowerCase() !== "default" ? normalized : undefined;
}

function normalizeConfiguredApiVersion(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new SalesforceConnectionConfigError("Configured org-api-version must be a string.");
  }
  const normalized = value.trim().replace(/^v/i, "");
  if (!API_VERSION_RE.test(normalized)) {
    throw new SalesforceConnectionConfigError(
      "Configured org-api-version must use a numeric value such as 67.0.",
    );
  }
  return normalized;
}

async function initializeSalesforceSession(
  config: ResolvedConnectionConfig,
  cacheKey: string,
  fresh = false,
): Promise<SalesforceSession> {
  const org = await orgFromAlias(config.targetOrg, {
    cacheKey,
    fresh,
    timeoutMs: DEFAULT_CONNECTION_TIMEOUT_MS,
  });
  const connection = org.getConnection();
  const selection = await selectApiVersion(
    connection,
    config.targetOrg,
    config.configuredApiVersion,
  );
  connection.setApiVersion(selection.apiVersion);

  const fields = connection.getAuthInfoFields() as {
    alias?: string;
    username?: string;
    orgId?: string;
    instanceUrl?: string;
    isSandbox?: boolean;
    isScratch?: boolean;
    isDevHub?: boolean;
    trailExpirationDate?: string | null;
  };
  const instanceUrl = fields.instanceUrl ?? connection.instanceUrl;
  if (!instanceUrl) {
    throw new SalesforceTargetOrgError(
      `Resolved Salesforce target '${config.targetOrg}' has no instance URL.`,
    );
  }

  const target: SalesforceTarget = Object.freeze({
    targetOrg: config.targetOrg,
    alias: fields.alias,
    username: fields.username,
    orgId: fields.orgId,
    instanceUrl,
    orgType: inferOrgType(fields, instanceUrl),
    apiVersion: selection.apiVersion,
    maxApiVersion: selection.maxApiVersion,
    versionSource: selection.source,
    configuredFallback: config.configuredApiVersion,
    versionDiscoveryWarning: selection.warning,
  });

  return createSession(connection, target);
}

async function selectApiVersion(
  connection: Connection,
  targetOrg: string,
  configuredFallback: string | undefined,
): Promise<VersionSelection> {
  const instanceUrl = connection.instanceUrl?.replace(/\/$/, "");
  const discovery = instanceUrl
    ? await connRequest<unknown>(connection, {
        method: "GET",
        url: `${instanceUrl}/services/data`,
        timeoutMs: DEFAULT_CONNECTION_TIMEOUT_MS,
        headers: { Accept: "application/json" },
      })
    : { status: 500, body: { message: "Connection has no instance URL." } };

  if (discovery.status === 499) throw new SalesforceConnectionAbortedError();
  const latest = discovery.status < 400 ? highestAdvertisedApiVersion(discovery.body) : undefined;
  if (latest) {
    return {
      apiVersion: latest,
      maxApiVersion: latest,
      source: "org-latest",
    };
  }

  const warning =
    discovery.status >= 400
      ? `Latest API discovery failed for '${targetOrg}' (HTTP ${discovery.status}).`
      : `Latest API discovery returned no valid versions for '${targetOrg}'.`;
  if (configuredFallback) {
    return {
      apiVersion: configuredFallback,
      source: "configured-fallback",
      warning,
    };
  }
  throw new SalesforceApiVersionDiscoveryError(targetOrg, warning);
}

function highestAdvertisedApiVersion(body: unknown): string | undefined {
  if (!Array.isArray(body)) return undefined;
  const versions = body
    .map((entry) => (entry as VersionEntry | null)?.version)
    .filter(
      (version): version is string => typeof version === "string" && API_VERSION_RE.test(version),
    )
    .sort((left, right) => Number.parseFloat(right) - Number.parseFloat(left));
  return versions[0];
}

function createSession(connection: Connection, target: SalesforceTarget): SalesforceSession {
  const selectedApiVersion = target.apiVersion;
  const warnings = target.versionDiscoveryWarning ? [target.versionDiscoveryWarning] : [];
  const buildPublicPath = (resource: string, query?: SalesforceQueryParams): string => {
    if (isVersionedSalesforceResource(resource)) {
      throw new Error(
        "Salesforce callers must provide a versionless resource path; the shared connection module owns API versions.",
      );
    }
    return buildSalesforceApiPath(resource, selectedApiVersion, query);
  };
  const buildContinuationPath = (resource: string): string =>
    buildSalesforceApiPath(resource, selectedApiVersion);

  const executeRequest = async <T = unknown>(
    input: SalesforceRequestInput,
    continuation = false,
  ): Promise<SalesforceResponse<T>> => {
    const requestPath = continuation
      ? buildContinuationPath(input.path)
      : input.scope === "instance"
        ? buildSalesforceInstancePath(input.path, input.query)
        : buildPublicPath(input.path, input.query);
    const response = await connRequest<T>(connection, {
      method: input.method,
      url: requestPath,
      body: input.body,
      headers: input.headers,
      timeoutMs: input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      signal: input.signal,
    });
    return { ...response, path: requestPath, target, warnings: [...warnings] };
  };
  const request = <T = unknown>(input: SalesforceRequestInput): Promise<SalesforceResponse<T>> =>
    executeRequest<T>(input);
  const continueRequest = <T = unknown>(
    input: SalesforceRequestInput,
  ): Promise<SalesforceResponse<T>> => executeRequest<T>(input, true);

  const query = async <T = Record<string, unknown>>(
    input: SalesforceQueryInput,
  ): Promise<SalesforceQueryResult<T>> => {
    const maxRows = Math.floor(input.maxRows);
    if (!Number.isFinite(maxRows) || maxRows <= 0) {
      throw new Error("Salesforce query maxRows must be a positive integer.");
    }
    if (input.queryAll && input.api === "tooling") {
      throw new Error("Salesforce queryAll is available only for the REST data API.");
    }

    const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    const remainingTimeout = (): number => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new SalesforceRequestError(408, "/query", { errorCode: "REQUEST_TIMEOUT" }, target);
      }
      return remaining;
    };

    const api = input.api ?? "rest";
    const firstResource = input.queryAll
      ? "/queryAll/"
      : api === "tooling"
        ? "/tooling/query/"
        : "/query/";
    const continuationPrefix = firstResource;
    let response = await executeRequest<QueryPage<T>>({
      method: "GET",
      path: firstResource,
      query: { q: input.soql },
      timeoutMs: remainingTimeout(),
      signal: input.signal,
    });
    assertQueryResponse(response, continuationPrefix);

    const firstTotalSize = response.body.totalSize;
    const records: T[] = [];
    let page = response.body;
    let pages = 1;
    appendBounded(records, page.records, maxRows);

    while (!page.done && page.nextRecordsUrl && records.length < maxRows) {
      if (pages >= MAX_QUERY_PAGES) {
        throw new Error(`Salesforce query exceeded ${MAX_QUERY_PAGES} pages.`);
      }
      response = await executeRequest<QueryPage<T>>(
        {
          method: "GET",
          path: page.nextRecordsUrl,
          timeoutMs: remainingTimeout(),
          signal: input.signal,
        },
        true,
      );
      assertQueryResponse(response, continuationPrefix);
      page = response.body;
      appendBounded(records, page.records, maxRows);
      pages += 1;
    }

    return {
      records,
      totalSize: firstTotalSize,
      done: page.done,
      nextRecordsUrl: page.nextRecordsUrl,
      truncated:
        records.length >= maxRows && (!page.done || (firstTotalSize ?? 0) > records.length),
      target,
    };
  };

  const identity = (options?: ResolveOrgIdentityOptions): Promise<OrgIdentity> =>
    resolveOrgIdentity(connection, options);

  return {
    target,
    connection,
    identity,
    path: buildPublicPath,
    request,
    continueRequest,
    query,
  };
}

interface QueryPage<T> {
  records: T[];
  totalSize?: number;
  done: boolean;
  nextRecordsUrl?: string;
}

function assertQueryResponse<T>(
  response: SalesforceResponse<QueryPage<T>>,
  continuationPrefix: string,
): void {
  if (response.status >= 400) {
    throw new SalesforceRequestError(
      response.status,
      response.path,
      response.body,
      response.target,
    );
  }
  const body = response.body as QueryPage<T> | undefined;
  if (!body || !Array.isArray(body.records) || typeof body.done !== "boolean") {
    throw new SalesforceRequestError(
      500,
      response.path,
      { errorCode: "INVALID_QUERY_RESPONSE" },
      response.target,
    );
  }
  if (body.totalSize !== undefined && !Number.isFinite(body.totalSize)) {
    throw new SalesforceRequestError(
      500,
      response.path,
      { errorCode: "INVALID_QUERY_RESPONSE" },
      response.target,
    );
  }
  if (!body.done && !isValidQueryContinuation(body.nextRecordsUrl, continuationPrefix)) {
    throw new SalesforceRequestError(
      500,
      response.path,
      { errorCode: "INVALID_QUERY_CONTINUATION" },
      response.target,
    );
  }
}

function isValidQueryContinuation(value: unknown, expectedPrefix: string): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return false;
  try {
    const decodedPath = decodeURIComponent(value.split("?", 1)[0] ?? "");
    if (decodedPath.includes("\\")) return false;
    const segments = decodedPath.split("/");
    if (segments.some((segment) => segment === "." || segment === "..")) return false;
    const normalized = normalizeSalesforceResource(value);
    return normalized.startsWith(expectedPrefix);
  } catch {
    return false;
  }
}

function appendBounded<T>(target: T[], page: T[] | undefined, maxRows: number): void {
  if (!page?.length || target.length >= maxRows) return;
  target.push(...page.slice(0, maxRows - target.length));
}

function inferOrgType(
  fields: {
    isScratch?: boolean;
    isSandbox?: boolean;
    isDevHub?: boolean;
    trailExpirationDate?: string | null;
  },
  instanceUrl: string,
): OrgType {
  if (fields.isScratch) return "scratch";
  if (fields.isSandbox) return "sandbox";
  try {
    const hostname = new URL(instanceUrl).hostname.toLowerCase();
    const labels = hostname.split(".");
    if (labels.includes("scratch")) return "scratch";
    if (labels.includes("sandbox")) return "sandbox";
    if (
      hostname === "develop.my.salesforce.com" ||
      hostname.endsWith(".develop.my.salesforce.com")
    ) {
      return "developer";
    }
  } catch {
    // Keep evaluating non-URL signals.
  }
  if (fields.trailExpirationDate) return "trial";
  if (fields.isDevHub) return "production";
  return "unknown";
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export class SalesforceTargetOrgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesforceTargetOrgError";
  }
}

export class SalesforceConnectionAbortedError extends Error {
  constructor() {
    super("Salesforce connection initialization was aborted.");
    this.name = "SalesforceConnectionAbortedError";
  }
}

export class SalesforceConnectionTimeoutError extends Error {
  readonly timedOutAfterMs: number;

  constructor(timeoutMs: number) {
    super(`Salesforce connection initialization timed out after ${timeoutMs}ms.`);
    this.name = "SalesforceConnectionTimeoutError";
    this.timedOutAfterMs = timeoutMs;
  }
}

export class SalesforceConnectionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesforceConnectionConfigError";
  }
}

export class SalesforceApiVersionDiscoveryError extends Error {
  readonly targetOrg: string;

  constructor(targetOrg: string, detail: string) {
    super(
      `${detail} No explicit org-api-version fallback is configured. ` +
        "SF Pi did not use JSforce's default API 50.0. No Salesforce operation was attempted.",
    );
    this.name = "SalesforceApiVersionDiscoveryError";
    this.targetOrg = targetOrg;
  }
}

export class SalesforceRequestError extends Error {
  readonly status: number;
  /** Versionless resource without query values. */
  readonly path: string;
  readonly apiVersion: string;
  readonly versionSource: SalesforceVersionSource;
  readonly errorCode?: string;

  constructor(status: number, requestPath: string, body: unknown, target: SalesforceTarget) {
    const resource = safeRequestResource(requestPath);
    super(`Salesforce request failed (${status}) using API ${target.apiVersion}: ${resource}`);
    this.name = "SalesforceRequestError";
    this.status = status;
    this.path = resource;
    this.apiVersion = target.apiVersion;
    this.versionSource = target.versionSource;
    this.errorCode = extractSalesforceErrorCode(body);
  }
}

function safeRequestResource(requestPath: string): string {
  const withoutQuery = requestPath.split("?", 1)[0] ?? "/";
  try {
    return normalizeSalesforceResource(withoutQuery);
  } catch {
    return "/unknown";
  }
}

function extractSalesforceErrorCode(body: unknown): string | undefined {
  const candidate = Array.isArray(body) ? body[0] : body;
  if (!candidate || typeof candidate !== "object") return undefined;
  const value =
    (candidate as { errorCode?: unknown; name?: unknown }).errorCode ??
    (candidate as { name?: unknown }).name;
  return typeof value === "string" ? value.slice(0, 100) : undefined;
}
