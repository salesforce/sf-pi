/* SPDX-License-Identifier: Apache-2.0 */
/**
 * On-disk store for preview sessions.
 *
 * Layout (Salesforce-standard, mirrored from `@salesforce/agents` ScriptAgent):
 *
 *   <cwd>/.sfdx/agents/<agentName>/sessions/<sessionId>/
 *   ├── metadata.json        { sessionId, agentName, startTime, endTime?, mockMode, planIds[] }
 *   ├── transcript.jsonl     append-only; one TranscriptEntry per line (user|agent)
 *   ├── turn-index.json      turn → planId/user/agent/trace pointer
 *   └── traces/<planId>.json full PlannerResponse per turn
 *
 * sf-guardrail allows `.sfdx/agents/**` (carve-out from the broader `.sfdx/**`
 * block). Other paths under `.sfdx/` remain locked.
 *
 * Append-only writes: transcript.jsonl is appended via fs.appendFile so
 * concurrent writes don't clobber each other. metadata.json is rewritten on
 * each flush — small enough that atomicity isn't a concern.
 */

import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PreviewContextVariable } from "./context-vars.ts";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

export type SfapHostPrefix = "" | "test." | "dev.";

export interface PreviewMetadata {
  sessionId: string;
  agentName: string;
  startTime: string;
  endTime?: string;
  mockMode: "Mock" | "Live Test";
  /** agent_file = v1.1 preview session; api_name = published-agent v1 session. */
  sessionKind?: "agent_file" | "api_name";
  /**
   * Which SFAP host served the `start` call (`""` = api.salesforce.com,
   * `"test."` = sandbox, `"dev."` = pre-prod). Send/end/trace pin to this
   * host so they don't accidentally hit a different shard than the session
   * lives on. Optional for backward compat — sessions written before this
   * field was introduced fall back to the host walk.
   */
  endpoint?: SfapHostPrefix;
  /**
   * Target org alias / username the session was started against. Send/end
   * reuse this so the caller doesn't have to repeat `target_org` on every
   * call — omitting it would silently route to the global default org and
   * surface as "Session not found". Optional for backward compat.
   */
  targetOrg?: string;
  /**
   * Absolute path to the `.agent` file the session was started from. Used
   * by `end` to suggest the exact `agentscript_lifecycle action='publish'`
   * command. Only populated for the agent_file path; api_name sessions
   * reference an already-published agent and don't need this hint.
   */
  agentFilePath?: string;
  /** Session-level context/state seeds supplied at preview start. */
  previewContextVariables?: PreviewContextVariable[];
  /** Stats from patching compiled AgentJSON for linked-variable preview. */
  previewContextPatch?: {
    registeredStateVariables: number;
    rewrittenBindings: number;
  };
  planIds: string[];
}

export interface TranscriptEntry {
  timestamp: string;
  agentName: string;
  sessionId: string;
  role: "user" | "agent";
  text?: string;
  raw?: unknown;
  reason?: string;
  planId?: string;
}

export interface TurnIndexEntry {
  turn: number;
  planId?: string;
  userText?: string;
  agentText?: string;
  userTimestamp?: string;
  agentTimestamp?: string;
  traceFile?: string;
}

export interface TurnIndex {
  schemaVersion: 1;
  agentName: string;
  sessionId: string;
  turns: TurnIndexEntry[];
}

export interface StoredPreviewSession {
  agent: string;
  session_id: string;
  session_dir: string;
  metadata?: PreviewMetadata;
  metadata_error?: string;
  age_days: number;
}

// -------------------------------------------------------------------------------------------------
// Path helpers
// -------------------------------------------------------------------------------------------------

const SESSIONS_BASE_REL = path.join(".sfdx", "agents");

export function getSessionDir(cwd: string, agentName: string, sessionId: string): string {
  return path.join(cwd, SESSIONS_BASE_REL, agentName, "sessions", sessionId);
}

export function getAgentBaseDir(cwd: string, agentName?: string): string {
  return agentName
    ? path.join(cwd, SESSIONS_BASE_REL, agentName)
    : path.join(cwd, SESSIONS_BASE_REL);
}

// -------------------------------------------------------------------------------------------------
// Read
// -------------------------------------------------------------------------------------------------

export async function loadSession(
  cwd: string,
  agentName: string,
  sessionId: string,
): Promise<{ metadata: PreviewMetadata; transcript: TranscriptEntry[] }> {
  const dir = getSessionDir(cwd, agentName, sessionId);
  const metaRaw = await readFile(path.join(dir, "metadata.json"), "utf8");
  const metadata = JSON.parse(metaRaw) as PreviewMetadata;
  let transcript: TranscriptEntry[] = [];
  try {
    const raw = await readFile(path.join(dir, "transcript.jsonl"), "utf8");
    transcript = raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as TranscriptEntry);
  } catch {
    /* empty session — no transcript yet */
  }
  return { metadata, transcript };
}

export async function readTurnIndex(sessionDir: string): Promise<TurnIndex | null> {
  try {
    return JSON.parse(
      await readFile(path.join(sessionDir, "turn-index.json"), "utf8"),
    ) as TurnIndex;
  } catch {
    return null;
  }
}

export async function recordTurnPlan(
  sessionDir: string,
  entry: Omit<TurnIndexEntry, "turn"> & { turn?: number; agentName: string; sessionId: string },
): Promise<TurnIndex> {
  const existing = await readTurnIndex(sessionDir);
  const index: TurnIndex = existing ?? {
    schemaVersion: 1,
    agentName: entry.agentName,
    sessionId: entry.sessionId,
    turns: [],
  };
  const existingByTurn =
    typeof entry.turn === "number"
      ? index.turns.find((t) => t.turn === entry.turn)
      : entry.planId
        ? index.turns.find((t) => t.planId === entry.planId)
        : undefined;
  const turn = entry.turn ?? existingByTurn?.turn ?? maxTurn(index.turns) + 1;
  const nextEntry: TurnIndexEntry = {
    ...(existingByTurn ?? { turn }),
    turn,
    ...(entry.planId ? { planId: entry.planId } : {}),
    ...(entry.userText !== undefined ? { userText: entry.userText } : {}),
    ...(entry.agentText !== undefined ? { agentText: entry.agentText } : {}),
    ...(entry.userTimestamp ? { userTimestamp: entry.userTimestamp } : {}),
    ...(entry.agentTimestamp ? { agentTimestamp: entry.agentTimestamp } : {}),
    ...(entry.traceFile ? { traceFile: entry.traceFile } : {}),
  };
  const idx = index.turns.findIndex((t) => t.turn === turn);
  if (idx >= 0) index.turns[idx] = nextEntry;
  else index.turns.push(nextEntry);
  index.turns.sort((a, b) => a.turn - b.turn);
  await writeFile(path.join(sessionDir, "turn-index.json"), JSON.stringify(index, null, 2), "utf8");
  return index;
}

function maxTurn(turns: TurnIndexEntry[]): number {
  return turns.reduce((max, t) => Math.max(max, t.turn), 0);
}

// -------------------------------------------------------------------------------------------------
// Write
// -------------------------------------------------------------------------------------------------

export async function initSession(
  cwd: string,
  meta: Omit<PreviewMetadata, "endTime" | "planIds"> & { planIds?: string[] },
): Promise<string> {
  const dir = getSessionDir(cwd, meta.agentName, meta.sessionId);
  await mkdir(dir, { recursive: true });
  await mkdir(path.join(dir, "traces"), { recursive: true });
  const full: PreviewMetadata = {
    sessionId: meta.sessionId,
    agentName: meta.agentName,
    startTime: meta.startTime,
    mockMode: meta.mockMode,
    sessionKind: meta.sessionKind,
    endpoint: meta.endpoint,
    targetOrg: meta.targetOrg,
    agentFilePath: meta.agentFilePath,
    previewContextVariables: meta.previewContextVariables,
    previewContextPatch: meta.previewContextPatch,
    planIds: meta.planIds ?? [],
  };
  await writeFile(path.join(dir, "metadata.json"), JSON.stringify(full, null, 2), "utf8");
  return dir;
}

export async function logTurn(sessionDir: string, entry: TranscriptEntry): Promise<void> {
  await appendFile(path.join(sessionDir, "transcript.jsonl"), JSON.stringify(entry) + "\n", "utf8");
}

export async function logTrace(sessionDir: string, planId: string, trace: unknown): Promise<void> {
  const file = path.join(sessionDir, "traces", `${planId}.json`);
  await writeFile(file, JSON.stringify(trace, null, 2), "utf8");
  // Update metadata.json to track planIds.
  try {
    const metaPath = path.join(sessionDir, "metadata.json");
    const metaRaw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw) as PreviewMetadata;
    if (!meta.planIds.includes(planId)) {
      meta.planIds.push(planId);
      await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
    }
  } catch {
    /* non-fatal — metadata will sync on endSession */
  }
}

export async function endSession(sessionDir: string, endTime: string): Promise<PreviewMetadata> {
  const metaPath = path.join(sessionDir, "metadata.json");
  const metaRaw = await readFile(metaPath, "utf8");
  const meta = JSON.parse(metaRaw) as PreviewMetadata;
  meta.endTime = endTime;
  await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

// -------------------------------------------------------------------------------------------------
// Session discovery / Cleanup
// -------------------------------------------------------------------------------------------------

export async function listStoredSessions(cwd: string): Promise<StoredPreviewSession[]> {
  const now = Date.now();
  const out: StoredPreviewSession[] = [];
  const agentsRoot = getAgentBaseDir(cwd);
  let agents: string[];
  try {
    agents = await readdir(agentsRoot);
  } catch {
    return [];
  }

  for (const agent of agents) {
    const agentSessionsDir = path.join(agentsRoot, agent, "sessions");
    let sessions: string[];
    try {
      sessions = await readdir(agentSessionsDir);
    } catch {
      continue;
    }
    for (const sessionId of sessions) {
      const sessionDir = path.join(agentSessionsDir, sessionId);
      let info;
      try {
        info = await stat(sessionDir);
      } catch {
        continue;
      }
      if (!info.isDirectory()) continue;

      let metadata: PreviewMetadata | undefined;
      let metadataError: string | undefined;
      try {
        const raw = await readFile(path.join(sessionDir, "metadata.json"), "utf8");
        metadata = JSON.parse(raw) as PreviewMetadata;
      } catch (err) {
        metadataError = err instanceof Error ? err.message : String(err);
      }
      const referenceTime = metadata?.endTime ?? metadata?.startTime;
      const ageMs = referenceTime ? now - new Date(referenceTime).getTime() : now - info.mtimeMs;
      out.push({
        agent,
        session_id: sessionId,
        session_dir: sessionDir,
        metadata,
        metadata_error: metadataError,
        age_days: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
      });
    }
  }
  return out;
}

export interface CleanupResult {
  removed: Array<{ agent: string; session_id: string; age_days: number }>;
  kept_count: number;
}

/**
 * Walk the agents tree and remove session dirs whose `metadata.endTime` (or
 * `startTime` if endTime is missing) is older than `olderThanDays`. With
 * `dryRun=true`, returns what would be removed without actually deleting.
 */
export async function cleanupSessions(
  cwd: string,
  olderThanDays: number,
  dryRun = false,
): Promise<CleanupResult> {
  const removed: CleanupResult["removed"] = [];
  let keptCount = 0;
  const now = Date.now();
  const cutoffMs = olderThanDays * 24 * 60 * 60 * 1000;

  const agentsRoot = getAgentBaseDir(cwd);
  let agents: string[];
  try {
    agents = await readdir(agentsRoot);
  } catch {
    return { removed: [], kept_count: 0 };
  }

  for (const agent of agents) {
    const agentSessionsDir = path.join(agentsRoot, agent, "sessions");
    let sessions: string[];
    try {
      sessions = await readdir(agentSessionsDir);
    } catch {
      continue;
    }
    for (const sessionId of sessions) {
      const sessionDir = path.join(agentSessionsDir, sessionId);
      let info;
      try {
        info = await stat(sessionDir);
      } catch {
        continue;
      }
      if (!info.isDirectory()) continue;

      let metadata: PreviewMetadata | null = null;
      try {
        const raw = await readFile(path.join(sessionDir, "metadata.json"), "utf8");
        metadata = JSON.parse(raw) as PreviewMetadata;
      } catch {
        // Treat sessions without metadata as old enough to remove if the
        // dir mtime exceeds the cutoff.
      }

      const referenceTime = metadata?.endTime ?? metadata?.startTime;
      const ageMs = referenceTime ? now - new Date(referenceTime).getTime() : now - info.mtimeMs;
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

      if (ageMs > cutoffMs) {
        removed.push({ agent, session_id: sessionId, age_days: ageDays });
        if (!dryRun) {
          await rmrf(sessionDir);
        }
      } else {
        keptCount++;
      }
    }
  }

  return { removed, kept_count: keptCount };
}

async function rmrf(dir: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(dir, { recursive: true, force: true });
}
