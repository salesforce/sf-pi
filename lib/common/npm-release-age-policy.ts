/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Helpers for npm's release-age / before policy.
 *
 * SF Pi uses these to avoid showing Pi Runtime update nudges when npm would
 * intentionally hide a newly-published release. This module is pure: callers
 * own subprocess execution so startup paths can stay cache-first and tests can
 * inject command output directly.
 */
import { compareVersions } from "./catalog-state/whats-new.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NpmReleaseAgePolicyInput {
  before?: string;
  minReleaseAge?: string;
  minimumReleaseAge?: string;
  now?: Date;
}

export interface NpmReleaseAgePolicy {
  source: "before" | "min-release-age" | "minimum-release-age";
  /** The raw config value that activated the policy. */
  rawValue: string;
  /** Effective cutoff. Undefined means a policy was detected but not parseable. */
  cutoff?: Date;
  /** Present for release-age policies, whose unit is days in npm v11. */
  releaseAgeDays?: number;
}

export function normalizeNpmConfigValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return undefined;
  return trimmed;
}

export function resolveNpmReleaseAgePolicy(
  input: NpmReleaseAgePolicyInput,
): NpmReleaseAgePolicy | undefined {
  const before = normalizeNpmConfigValue(input.before);
  if (before) {
    const parsed = new Date(before);
    return {
      source: "before",
      rawValue: before,
      cutoff: Number.isFinite(parsed.getTime()) ? parsed : undefined,
    };
  }

  const minReleaseAge = normalizeNpmConfigValue(input.minReleaseAge);
  const minPolicy = buildReleaseAgePolicy("min-release-age", minReleaseAge, input.now);
  if (minPolicy) return minPolicy;

  const minimumReleaseAge = normalizeNpmConfigValue(input.minimumReleaseAge);
  return buildReleaseAgePolicy("minimum-release-age", minimumReleaseAge, input.now);
}

export function pickPolicyVisibleVersion(
  rawPackageTimes: string | Record<string, unknown> | undefined,
  cutoff: Date,
  maxVersion?: string,
): string | undefined {
  if (!rawPackageTimes) return undefined;

  let times: Record<string, unknown>;
  if (typeof rawPackageTimes === "string") {
    try {
      const parsed = JSON.parse(rawPackageTimes);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
      times = parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
  } else {
    times = rawPackageTimes;
  }

  const cutoffMs = cutoff.getTime();
  const eligible = Object.entries(times)
    .filter(([version, publishedAt]) => {
      if (!/^\d+\.\d+\.\d+/.test(version)) return false;
      if (maxVersion && compareVersions(version, maxVersion) > 0) return false;
      if (typeof publishedAt !== "string") return false;
      const publishedMs = Date.parse(publishedAt);
      return Number.isFinite(publishedMs) && publishedMs <= cutoffMs;
    })
    .map(([version]) => version)
    .sort((a, b) => compareVersions(b, a));

  return eligible[0];
}

export function readConfiguredNpmCommand(settings: Record<string, unknown>): string[] | undefined {
  const value = settings.npmCommand;
  if (!Array.isArray(value)) return undefined;
  const command = value.filter((part): part is string => typeof part === "string" && !!part);
  return command.length > 0 ? command : undefined;
}

function buildReleaseAgePolicy(
  source: "min-release-age" | "minimum-release-age",
  value: string | undefined,
  now: Date = new Date(),
): NpmReleaseAgePolicy | undefined {
  if (!value) return undefined;
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) return undefined;
  return {
    source,
    rawValue: value,
    releaseAgeDays: days,
    cutoff: new Date(now.getTime() - days * DAY_MS),
  };
}
