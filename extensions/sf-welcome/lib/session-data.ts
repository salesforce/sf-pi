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

  const sessions: { path: string; projectDir: string; mtime: number }[] = [];

  function scanSessionsRoot(rootDir: string) {
    if (!existsSync(rootDir)) return;
    try {
      for (const entry of readdirSync(rootDir)) {
        const projectDir = join(rootDir, entry);
        try {
          if (!statSync(projectDir).isDirectory()) continue;
          scanProjectSessionDir(projectDir);
        } catch {
          // Skip unreadable entries; the splash screen should stay best-effort.
        }
      }
    } catch {
      // Ignore unreadable directories for the same reason.
    }
  }

  function scanProjectSessionDir(projectDir: string) {
    // Pi's project session directory stores real sessions as direct JSONL
    // children. Nested directories are extension/subagent artifacts, so do
    // not recurse or the splash can show labels like run-0/run-1.
    try {
      for (const entry of readdirSync(projectDir)) {
        if (!entry.endsWith(".jsonl")) continue;
        const sessionPath = join(projectDir, entry);
        try {
          const stats = statSync(sessionPath);
          if (!stats.isFile()) continue;
          sessions.push({ path: sessionPath, projectDir, mtime: stats.mtimeMs });
        } catch {
          // Skip unreadable session files.
        }
      }
    } catch {
      // Ignore unreadable project session directories.
    }
  }

  for (const sessionsDir of sessionsDirs) {
    scanSessionsRoot(sessionsDir);
  }

  if (sessions.length === 0) return [];

  sessions.sort((left, right) => right.mtime - left.mtime);

  const seen = new Set<string>();
  const uniqueSessions: { name: string; mtime: number }[] = [];
  for (const session of sessions) {
    const name = readSessionDisplayName(session.path, session.projectDir);
    if (!seen.has(name)) {
      seen.add(name);
      uniqueSessions.push({ name, mtime: session.mtime });
      if (uniqueSessions.length >= maxCount) break;
    }
  }

  const now = Date.now();
  return uniqueSessions.map((session) => ({
    name: session.name.length > 20 ? session.name.slice(0, 17) + "…" : session.name,
    timeAgo: formatTimeAgo(now - session.mtime),
  }));
}

function readSessionDisplayName(sessionPath: string, projectDir: string): string {
  let projectName: string | undefined;
  let sessionName: string | undefined;

  try {
    for (const line of readFileSync(sessionPath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as { type?: unknown; cwd?: unknown; name?: unknown };
      if (projectName === undefined && typeof entry.cwd === "string" && entry.cwd.trim()) {
        projectName = basename(entry.cwd) || entry.cwd;
      }
      if (entry.type === "session_info") {
        sessionName =
          typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined;
      }
    }
  } catch {
    // Fall through to the directory-derived label below.
  }

  return sessionName ?? projectName ?? projectNameFromSessionDir(projectDir);
}

function projectNameFromSessionDir(projectDir: string): string {
  const parentName = basename(projectDir);
  if (parentName.startsWith("--") && parentName.endsWith("--")) {
    const parts = parentName.slice(2, -2).split("-").filter(Boolean);
    return parts[parts.length - 1] || parentName;
  }
  return parentName;
}

export function estimateMonthlyCost(): number {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return sumSessionCosts(monthStart);
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
