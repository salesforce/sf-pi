/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Process-local Agent Script analysis snapshots.
 *
 * A snapshot is a source-versioned reuse unit for stable local facts derived
 * from a `.agent` file: source text, diagnostics, structural inspection, and
 * feature profile. It is an optimization only — never persisted to branch
 * state or disk, never used for org facts, and always keyed by local file
 * facts so edits naturally produce a new snapshot. Compile and quality reuse
 * the cached upstream analysis but recompute settings-dependent projections per call.
 */

import { readFile, stat } from "node:fs/promises";
import { analyzeAgentScriptSource } from "./agentforce-document.ts";
import { buildFeatureProfile, type AgentFeatureProfile } from "./feature-profile.ts";
import { checkAgentScriptSource } from "./diagnostics.ts";
import { inspectSource, type InspectResult } from "./inspect.ts";
import { runAgentScriptQuality } from "./quality/engine.ts";
import type { AgentScriptQualityResult } from "./quality/types.ts";
import type { AgentScriptCheckResult } from "./types.ts";

const MAX_ANALYSIS_SNAPSHOTS = 20;

export interface AgentScriptAnalysisFileKey {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface AgentScriptAnalysisSnapshot {
  source: string;
  fileKey: AgentScriptAnalysisFileKey;
  getUpstream: () => ReturnType<typeof analyzeAgentScriptSource>;
  getCompile: () => Promise<AgentScriptCheckResult>;
  getInspect: () => Promise<InspectResult>;
  getQuality: () => Promise<AgentScriptQualityResult>;
  getFeatureProfile: () => Promise<AgentFeatureProfile | undefined>;
}

interface CacheEntry {
  snapshot: AgentScriptAnalysisSnapshot;
  lastUsed: number;
}

const cache = new Map<string, CacheEntry>();

export async function getAgentScriptAnalysis(
  filePath: string,
): Promise<AgentScriptAnalysisSnapshot> {
  const fileKey = await getFileKey(filePath);
  const key = cacheKey(fileKey);
  const cached = cache.get(key);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.snapshot;
  }

  const source = await readFile(filePath, "utf8");
  let upstreamPromise: ReturnType<typeof analyzeAgentScriptSource> | undefined;
  let inspectPromise: Promise<InspectResult> | undefined;
  let featureProfilePromise: Promise<AgentFeatureProfile | undefined> | undefined;

  const getUpstream = () => (upstreamPromise ??= analyzeAgentScriptSource(source));

  const snapshot: AgentScriptAnalysisSnapshot = {
    source,
    fileKey,
    getUpstream,
    async getCompile() {
      return checkAgentScriptSource(source, await getUpstream());
    },
    getInspect() {
      inspectPromise ??= getUpstream().then((result) => inspectSource(source, result));
      return inspectPromise;
    },
    async getQuality() {
      const result = await getUpstream();
      return result.ok === true
        ? runAgentScriptQuality(source, {
            document: {
              source,
              ast: result.analysis.documentState.ast,
              hasErrors: result.analysis.compileDiagnostics.some(
                (diagnostic) => diagnostic.severity === 1,
              ),
            },
            upstreamDiagnostics: result.analysis.compileDiagnostics,
          })
        : runAgentScriptQuality(source, { analysisFailure: result.unavailableReason });
    },
    async getFeatureProfile() {
      featureProfilePromise ??= (async () => {
        const inspect = await snapshot.getInspect();
        return inspect.ok ? buildFeatureProfile(inspect, source) : undefined;
      })();
      return featureProfilePromise;
    },
  };

  cache.set(key, { snapshot, lastUsed: Date.now() });
  evictOldestIfNeeded();
  return snapshot;
}

export function invalidateAgentScriptAnalysis(filePath: string): void {
  for (const [key, entry] of cache.entries()) {
    if (entry.snapshot.fileKey.path === filePath || key.startsWith(`${filePath}::`)) {
      cache.delete(key);
    }
  }
}

export function clearAgentScriptAnalysisCache(): void {
  cache.clear();
}

export function agentScriptAnalysisCacheSize(): number {
  return cache.size;
}

async function getFileKey(filePath: string): Promise<AgentScriptAnalysisFileKey> {
  const s = await stat(filePath);
  return { path: filePath, mtimeMs: s.mtimeMs, size: s.size };
}

function cacheKey(fileKey: AgentScriptAnalysisFileKey): string {
  return `${fileKey.path}::${fileKey.mtimeMs}::${fileKey.size}`;
}

function evictOldestIfNeeded(): void {
  if (cache.size <= MAX_ANALYSIS_SNAPSHOTS) return;
  const oldest = [...cache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]?.[0];
  if (oldest) cache.delete(oldest);
}
