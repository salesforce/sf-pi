/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for Pi session-derived splash data.
 *
 * The splash intentionally reads Pi's on-disk JSONL sessions directly so it can
 * stay synchronous and lightweight during startup. These tests pin the two
 * layout assumptions that matter for the Recent Sessions panel:
 * - only direct JSONL files under each project session directory are sessions
 * - the display label should prefer Pi's native session_info name, then fall
 *   back to the session header cwd instead of a lossy decode of Pi's
 *   hyphen-escaped directory name
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRecentSessions } from "../lib/session-data.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let prevAgentDir: string | undefined;

function writeSession(
  relativePath: string,
  cwd: string,
  mtime: Date,
  entries: Record<string, unknown>[] = [],
): void {
  const filePath = path.join(tmpDir, "sessions", relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const header = {
    type: "session",
    version: 3,
    id: path.basename(filePath, ".jsonl"),
    timestamp: mtime.toISOString(),
    cwd,
  };
  writeFileSync(
    filePath,
    [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  );
  utimesSync(filePath, mtime, mtime);
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-welcome-sessions-"));
  prevAgentDir = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (prevAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgentDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("getRecentSessions", () => {
  it("uses the session header cwd so hyphenated project names stay intact", () => {
    writeSession(
      "--Users-dev-work-sf-sf-pi--/recent.jsonl",
      "/Users/dev/work/sf/sf-pi",
      new Date(Date.now() - 5 * 60 * 1000),
    );

    expect(getRecentSessions(1)[0]?.name).toBe("sf-pi");
  });

  it("prefers Pi's native session display name when present", () => {
    const mtime = new Date(Date.now() - 5 * 60 * 1000);
    writeSession("--Users-dev-work-sf-sf-pi--/named.jsonl", "/Users/dev/work/sf/sf-pi", mtime, [
      {
        type: "session_info",
        id: "session-name",
        timestamp: mtime.toISOString(),
        name: "Release audit",
      },
    ]);

    expect(getRecentSessions(1)[0]?.name).toBe("Release audit");
  });

  it("uses the latest non-empty session display name", () => {
    const mtime = new Date(Date.now() - 5 * 60 * 1000);
    writeSession("--Users-dev-work-sf-sf-pi--/renamed.jsonl", "/Users/dev/work/sf/sf-pi", mtime, [
      { type: "session_info", id: "first", timestamp: mtime.toISOString(), name: "Old name" },
      { type: "session_info", id: "second", timestamp: mtime.toISOString(), name: "New name" },
    ]);

    expect(getRecentSessions(1)[0]?.name).toBe("New name");
  });

  it("does not surface nested subagent run directories as recent sessions", () => {
    const now = Date.now();
    writeSession(
      "--Users-dev-work-sf-sf-pi--/main.jsonl",
      "/Users/dev/work/sf/sf-pi",
      new Date(now - 10 * 60 * 1000),
    );
    writeSession(
      "--Users-dev-work-sf-sf-pi--/2026-05-18T13-00-00-000Z_abc/turn/run-0/subagent.jsonl",
      "/tmp/subagent-run-0",
      new Date(now - 1 * 60 * 1000),
    );
    writeSession(
      "--Users-dev-Projects-AgentScope--/agent-scope.jsonl",
      "/Users/dev/Projects/AgentScope",
      new Date(now - 2 * 60 * 1000),
    );

    expect(getRecentSessions(3).map((session) => session.name)).toEqual(["AgentScope", "sf-pi"]);
  });
});
