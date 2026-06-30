/* SPDX-License-Identifier: Apache-2.0 */

export type TenantIngestActionName =
  | "ingest_job.create"
  | "ingest_job.upload_csv"
  | "ingest_job.close"
  | "ingest_job.poll";

export type TenantIngestMethod = "GET" | "POST" | "PATCH" | "PUT";

export interface TenantIngestAuthStatus {
  required: true;
  status: "not_configured" | "ready";
  tokenSource?: string;
  tenantHost?: string;
}

export interface TenantIngestRequestPlan {
  method: TenantIngestMethod;
  tenantPath: string;
  body?: unknown;
  headers?: Record<string, string>;
  file?: { path: string; contentType: "text/csv" };
}

export interface TenantIngestPlan {
  action: TenantIngestActionName;
  request: TenantIngestRequestPlan;
  auth: TenantIngestAuthStatus;
}
