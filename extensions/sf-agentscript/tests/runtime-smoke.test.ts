/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import type { Connection } from "@salesforce/core";
import { diagnoseRuntimeSmoke } from "../lib/preflight/runtime-smoke.ts";

function connWith(results: Record<string, unknown[]>): Connection {
  return {
    query: async (soql: string) => {
      for (const [needle, records] of Object.entries(results)) {
        if (soql.includes(needle)) return { records };
      }
      throw new Error(`Unexpected query: ${soql}`);
    },
  } as unknown as Connection;
}

describe("diagnoseRuntimeSmoke", () => {
  test("diagnoses when no channel runtime records exist", async () => {
    const result = await diagnoseRuntimeSmoke(
      connWith({ VoiceCall: [], AgentWork: [], MessagingSession: [] }),
    );
    expect(result.surface).toBe("unknown");
    expect(result.findings.map((finding) => finding.code)).toEqual(["runtime-no-channel-records"]);
    expect(result.ok).toBe(false);
  });

  test("diagnoses VoiceCall without AgentWork as routing issue", async () => {
    const result = await diagnoseRuntimeSmoke(
      connWith({
        VoiceCall: [{ Id: "0LQ", ConversationId: "0CONV", DisconnectReason: "Other" }],
        AgentWork: [],
        MessagingSession: [],
      }),
    );
    expect(result.surface).toBe("voice");
    expect(result.findings.map((finding) => finding.code)).toEqual(["voice-runtime-no-agent-work"]);
  });

  test("diagnoses bot-selected AgentWork with zero ActiveTime", async () => {
    const result = await diagnoseRuntimeSmoke(
      connWith({
        VoiceCall: [{ Id: "0LQ", ConversationId: "0CONV" }],
        AgentWork: [{ Id: "0AW", BotId: "0BOT", ActiveTime: 0, HandleTime: 9 }],
        MessagingSession: [],
      }),
    );
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "runtime-agent-work-zero-active-time",
    ]);
  });

  test("surfaces active bot interaction and MessagingSession", async () => {
    const result = await diagnoseRuntimeSmoke(
      connWith({
        VoiceCall: [],
        AgentWork: [{ Id: "0AW", BotId: "0BOT", ActiveTime: 20, HandleTime: 30 }],
        MessagingSession: [{ Id: "0MS", Status: "Active" }],
      }),
    );
    expect(result.surface).toBe("messaging");
    expect(result.ok).toBe(true);
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "runtime-agent-work-active",
      "runtime-messaging-session-found",
    ]);
  });
});
