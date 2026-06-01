/* SPDX-License-Identifier: Apache-2.0 */

import { readFile } from "node:fs/promises";

import { inspectTenantIngestAuth, type TenantIngestTokenSession } from "./auth.ts";
import type { TenantIngestActionName, TenantIngestPlan, TenantIngestRequestPlan } from "./types.ts";

export async function executeTenantIngestRequest(
  request: TenantIngestRequestPlan,
  session: TenantIngestTokenSession,
  fetchFn: typeof fetch = fetch,
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const body = await requestBody(request);
  const response = await fetchFn(`https://${session.tenantHost}${request.tenantPath}`, {
    method: request.method,
    headers: {
      Accept: "application/json",
      ...(request.body ? { "Content-Type": "application/json" } : {}),
      ...(request.headers ?? {}),
      Authorization: `Bearer ${session.accessToken}`,
    },
    body,
  });
  const responseBody = await parseResponseBody(response);
  return { status: response.status, ok: response.ok, body: responseBody };
}

async function requestBody(request: TenantIngestRequestPlan): Promise<string | undefined> {
  if (request.file) return readFile(request.file.path, "utf8");
  if (request.body) return JSON.stringify(request.body);
  return undefined;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function planTenantIngestRequest(
  action: TenantIngestActionName,
  params: Record<string, unknown>,
): TenantIngestPlan {
  switch (action) {
    case "ingest_job.create":
      return {
        action,
        auth: inspectTenantIngestAuth(params),
        request: {
          method: "POST",
          tenantPath: "/api/v1/ingest/jobs",
          body: {
            operation: stringParam(params, "operation", "upsert"),
            sourceName: requiredString(params, "sourceName"),
            object: requiredString(params, "object"),
          },
        },
      };
    case "ingest_job.upload_csv": {
      const jobId = encodePathSegment(requiredString(params, "jobId"));
      return {
        action,
        auth: inspectTenantIngestAuth(params),
        request: {
          method: "PUT",
          tenantPath: `/api/v1/ingest/jobs/${jobId}/batches`,
          headers: { "Content-Type": "text/csv" },
          file: { path: requiredString(params, "csvPath"), contentType: "text/csv" },
        },
      };
    }
    case "ingest_job.close": {
      const jobId = encodePathSegment(requiredString(params, "jobId"));
      return {
        action,
        auth: inspectTenantIngestAuth(params),
        request: {
          method: "PATCH",
          tenantPath: `/api/v1/ingest/jobs/${jobId}`,
          body: { state: "UploadComplete" },
        },
      };
    }
    case "ingest_job.poll": {
      const jobId = encodePathSegment(requiredString(params, "jobId"));
      return {
        action,
        auth: inspectTenantIngestAuth(params),
        request: {
          method: "GET",
          tenantPath: `/api/v1/ingest/jobs/${jobId}`,
        },
      };
    }
    default:
      throw new Error(`Unsupported tenant ingest action ${action}.`);
  }
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function requiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required parameter '${key}'.`);
  }
  return value.trim();
}

function stringParam(params: Record<string, unknown>, key: string, fallback: string): string {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
