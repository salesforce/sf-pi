/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Session-derived splash data.
 *
 * This file owns two responsibilities that both read Pi session files:
 * - recent session names + relative timestamps
 * - rough monthly cost estimation from assistant usage entries
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { globalAgentDir, globalAgentPath } from "../../../lib/common/pi-paths.ts";
import type { RecentSession } from "./types.ts";

export function getRecentSessions(maxCount: number = 3): RecentSession[] {
  const sessionsDirs = [
    globalAgentPath("sessions"),
    // Legacy Pi sessions lived beside the agent directory rather than inside it.
    join(dirname(globalAgentDir()), "sessions"),
  ];

  const sessions: { name: string; mtime: number }[] = [];

  function scanDir(dir: string) {
    if (!existsSync(dir)) return;
    try {
      for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        try {
          const stats = statSync(entryPath);
          if (stats.isDirectory()) {
            scanDir(entryPath);
          } else if (entry.endsWith(".jsonl")) {
            const parentName = basename(dir);
            let projectName = parentName;
            if (parentName.startsWith("--")) {
              const parts = parentName.split("-").filter(Boolean);
              projectName = parts[parts.length - 1] || parentName;
            }
            sessions.push({ name: projectName, mtime: stats.mtimeMs });
          }
        } catch {
          // Skip unreadable entries; the splash screen should stay best-effort.
        }
      }
    } catch {
      // Ignore unreadable directories for the same reason.
    }
  }

  for (const sessionsDir of sessionsDirs) {
    scanDir(sessionsDir);
  }

  if (sessions.length === 0) return [];

  sessions.sort((left, right) => right.mtime - left.mtime);

  const seen = new Set<string>();
  const uniqueSessions: typeof sessions = [];
  for (const session of sessions) {
    if (!seen.has(session.name)) {
      seen.add(session.name);
      uniqueSessions.push(session);
    }
  }

  const now = Date.now();
  return uniqueSessions.slice(0, maxCount).map((session) => ({
    name: session.name.length > 20 ? session.name.slice(0, 17) + "…" : session.name,
    timeAgo: formatTimeAgo(now - session.mtime),
  }));
}

export function estimateMonthlyCost(): number {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return sumSessionCosts(monthStart);
}

/**
 * Sum the cost recorded in every local Pi session file, all-time.
 *
 * Only used as a fallback when the SF LLM Gateway is not the active provider
 * (e.g. bring-your-own-keys users) — in that case we have no server-side
 * lifetime counter to display. The value is intentionally approximate: it
 * covers only sessions whose .jsonl files still exist on this machine and
 * only turns where the assistant logged a `usage.cost.total`.
 */
export function estimateLifetimeCost(): number {
  return sumSessionCosts(0);
}

/** Sum assistant-turn costs across every session file modified after `sinceMs`. */
function sumSessionCosts(sinceMs: number): number {
  const sessionsDir = globalAgentPath("sessions");
  if (!existsSync(sessionsDir)) return 0;

  let totalCost = 0;

  function scanDir(dir: string) {
    if (!existsSync(dir)) return;
    try {
      for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        try {
          const stats = statSync(entryPath);
          if (stats.isDirectory()) {
            scanDir(entryPath);
          } else if (entry.endsWith(".jsonl") && stats.mtimeMs >= sinceMs) {
            totalCost += extractCostFromSession(entryPath);
          }
        } catch {
          // Skip unreadable entries; the estimate is intentionally approximate.
        }
      }
    } catch {
      // Ignore unreadable directories.
    }
  }

  scanDir(sessionsDir);
  return totalCost;
}

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

function extractCostFromSession(filePath: string): number {
  let cost = 0;
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      if (!line || !line.includes('"role":"assistant"')) continue;
      try {
        const entry = JSON.parse(line) as {
          message?: {
            usage?: {
              cost?: {
                total?: number;
              };
            };
          };
        };
        if (typeof entry.message?.usage?.cost?.total === "number") {
          cost += entry.message.usage.cost.total;
        }
      } catch {
        // Skip individual bad lines instead of discarding the whole file.
      }
    }
  } catch {
    // Skip unreadable files.
  }
  return cost;
}
