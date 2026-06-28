/* SPDX-License-Identifier: Apache-2.0 */
/** Small actionable Apex error taxonomy for cards and agent recovery. */

import { buildApexDigest } from "./digest.ts";
import { fail } from "./result.ts";
import type { SfApexParams, ToolResult } from "./types.ts";

export type ApexErrorCategory =
  | "AUTH"
  | "NETWORK"
  | "NOT_FOUND"
  | "COMPILE_ERROR"
  | "RUNTIME_EXCEPTION"
  | "TOOLING_API"
  | "TIMEOUT"
  | "AMBIGUOUS_TARGET";

export interface ApexErrorInfo {
  category: ApexErrorCategory;
  message: string;
  next_step: string;
  raw?: string;
}

const AUTH_PATTERNS = [
  "401",
  "unauthorized",
  "authentication",
  "invalid_session_id",
  "invalid session",
  "session expired",
  "invalid_grant",
  "no access token",
];
const NETWORK_PATTERNS = [
  "econnrefused",
  "etimedout",
  "enotfound",
  "enetunreach",
  "socket hang up",
  "network",
  "fetch failed",
];
const NOT_FOUND_PATTERNS = ["not found", "requested resource does not exist", "entity is deleted"];
const TIMEOUT_PATTERNS = ["timed out", "timeout", "polling client timed out"];
const COMPILE_PATTERNS = [
  "compile problem",
  "compiled=false",
  "unexpected token",
  "variable does not exist",
];
const RUNTIME_PATTERNS = ["exceptionmessage", "exception stack", "exception:", "fatal_error"];

export class ApexStructuredError extends Error {
  readonly category: ApexErrorCategory;
  readonly next_step: string;

  constructor(category: ApexErrorCategory, message: string, nextStep: string) {
    super(message);
    this.name = "ApexStructuredError";
    this.category = category;
    this.next_step = nextStep;
  }
}

export function ambiguousTargetError(message: string): ApexStructuredError {
  return new ApexStructuredError(
    "AMBIGUOUS_TARGET",
    message,
    "Use class_names for whole classes or fully qualify tests as Class.method / namespace.Class.method.",
  );
}

export function classifyApexError(error: unknown): ApexErrorInfo {
  if (error instanceof ApexStructuredError) {
    return { category: error.category, message: error.message, next_step: error.next_step };
  }

  const raw = rawMessage(error);
  const lower = raw.toLowerCase();
  if (matches(lower, AUTH_PATTERNS)) {
    return {
      category: "AUTH",
      message: "Salesforce authentication failed for this Apex operation.",
      next_step: "Re-authenticate the target org, then rerun the sf_apex action.",
      raw,
    };
  }
  if (matches(lower, NETWORK_PATTERNS)) {
    return {
      category: "NETWORK",
      message: "Network connectivity failed during the Apex operation.",
      next_step: "Check connectivity and rerun the bounded sf_apex action.",
      raw,
    };
  }
  if (matches(lower, TIMEOUT_PATTERNS)) {
    return {
      category: "TIMEOUT",
      message: "The Apex operation exceeded its bounded wait window.",
      next_step:
        "Rerun with a longer wait window or inspect the async run/log id if one was returned.",
      raw,
    };
  }
  if (matches(lower, NOT_FOUND_PATTERNS) || /\b404\b/.test(lower)) {
    return {
      category: "NOT_FOUND",
      message: "The requested Apex class, log, run, or Tooling resource was not found.",
      next_step:
        "Rediscover the target with apex.search, test.discover, or log.latest before rerunning.",
      raw,
    };
  }
  if (matches(lower, COMPILE_PATTERNS)) {
    return {
      category: "COMPILE_ERROR",
      message: "Apex compilation failed.",
      next_step:
        "Fix the reported compile diagnostic, run diagnose.file when local source is involved, then retry.",
      raw,
    };
  }
  if (matches(lower, RUNTIME_PATTERNS)) {
    return {
      category: "RUNTIME_EXCEPTION",
      message: "Apex execution raised a runtime exception.",
      next_step:
        "Inspect the Root Cause and Apex Log Timeline, then rerun the smallest focused test/probe.",
      raw,
    };
  }
  return {
    category: "TOOLING_API",
    message: "Salesforce Tooling/API request failed during the Apex lifecycle action.",
    next_step:
      "Review the raw error in details, then rerun discovery or the smallest focused action.",
    raw,
  };
}

export function apexErrorResult(params: SfApexParams, error: unknown): ToolResult {
  const info = classifyApexError(error);
  return fail(`${info.category}: ${info.message}`, {
    kind: "apex_error",
    error: info,
    raw_error: info.raw,
    digest: buildApexDigest({
      action: params.action,
      kind: "apex_error",
      status: "fail",
      icon: "🧯",
      title: `Apex Error · ${info.category}`,
      orgAlias: params.target_org,
      sections: [
        {
          icon: "🔥",
          title: "Root Cause",
          rows: [
            { icon: "🏷️", label: "Category", value: info.category },
            { icon: "💬", label: "Message", value: info.message },
          ],
        },
      ],
      nextRows: [{ icon: "🧭", label: "Recommend", value: info.next_step }],
    }),
  });
}

function matches(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    const body = (error as { body?: unknown }).body;
    if (Array.isArray(body) && body[0] && typeof body[0] === "object") {
      const firstMessage = (body[0] as { message?: unknown }).message;
      if (typeof firstMessage === "string") return firstMessage;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}
