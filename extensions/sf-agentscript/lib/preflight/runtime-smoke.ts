/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Runtime Smoke Diagnosis.
 *
 * Read-only recent-record diagnosis for channel runtime failures after a user
 * has placed a test call or sent a test message. This is intentionally not
 * part of default review; callers opt into it via inspect/runtime_smoke.
 */

import type { Connection } from "@salesforce/core";

export type RuntimeSmokeSurface = "voice" | "messaging" | "unknown";
export type RuntimeSmokeSeverity = "ok" | "warning" | "unverifiable";

export interface RuntimeSmokeFinding {
  code: string;
  severity: RuntimeSmokeSeverity;
  message: string;
  evidence?: string[];
}

export interface RuntimeSmokeResult {
  ok: boolean;
  surface: RuntimeSmokeSurface;
  findings: RuntimeSmokeFinding[];
  latest: {
    voice_call?: VoiceCallRow;
    agent_work?: AgentWorkRow;
    messaging_session?: MessagingSessionRow;
  };
}

interface QueryResult<T> {
  records?: T[];
}

export interface VoiceCallRow {
  Id?: string;
  ConversationId?: string | null;
  DisconnectReason?: string | null;
  CallDurationInSeconds?: number | null;
  VendorType?: string | null;
  CreatedDate?: string;
}

export interface AgentWorkRow {
  Id?: string;
  BotId?: string | null;
  Status?: string | null;
  ActiveTime?: number | null;
  HandleTime?: number | null;
  CreatedDate?: string;
}

export interface MessagingSessionRow {
  Id?: string;
  Status?: string | null;
  MessagingChannelId?: string | null;
  CreatedDate?: string;
}

export async function diagnoseRuntimeSmoke(
  conn: Connection,
  opts: { phoneNumber?: string } = {},
): Promise<RuntimeSmokeResult> {
  void opts.phoneNumber;
  const [voiceCalls, agentWorks, messagingSessions] = await Promise.all([
    latestVoiceCalls(conn),
    latestAgentWorks(conn),
    latestMessagingSessions(conn),
  ]);

  const findings: RuntimeSmokeFinding[] = [];
  if (voiceCalls === null) {
    findings.push({
      code: "voice-runtime-unverifiable",
      severity: "unverifiable",
      message: "Could not query recent VoiceCall records.",
    });
  }
  if (agentWorks === null) {
    findings.push({
      code: "agent-work-runtime-unverifiable",
      severity: "unverifiable",
      message: "Could not query recent AgentWork records.",
    });
  }
  if (messagingSessions === null) {
    findings.push({
      code: "messaging-runtime-unverifiable",
      severity: "unverifiable",
      message: "Could not query recent MessagingSession records.",
    });
  }

  const voice = voiceCalls?.[0];
  const agentWork = agentWorks?.[0];
  const session = messagingSessions?.[0];
  const surface = voice ? "voice" : session ? "messaging" : "unknown";

  if (
    voiceCalls &&
    voiceCalls.length === 0 &&
    messagingSessions &&
    messagingSessions.length === 0
  ) {
    findings.push({
      code: "runtime-no-channel-records",
      severity: "warning",
      message:
        "No recent VoiceCall or MessagingSession records were found. The test interaction may not have reached Salesforce.",
    });
  }

  if (voice) {
    if (!voice.ConversationId) {
      findings.push({
        code: "voice-runtime-no-conversation",
        severity: "warning",
        message:
          "Recent VoiceCall has no ConversationId. The telephony conversation may not have initialized correctly.",
        evidence: [formatVoiceCall(voice)],
      });
    }
    if (agentWorks && agentWorks.length === 0) {
      findings.push({
        code: "voice-runtime-no-agent-work",
        severity: "warning",
        message:
          "Recent VoiceCall exists, but no recent AgentWork was found. Channel SessionHandlerId or routing flow wiring may be wrong.",
        evidence: [formatVoiceCall(voice)],
      });
    }
  }

  if (session && !voice && agentWorks && agentWorks.length === 0) {
    findings.push({
      code: "messaging-runtime-no-agent-work",
      severity: "warning",
      message:
        "Recent MessagingSession exists, but no recent AgentWork was found. Messaging channel routing may be incomplete.",
      evidence: [formatMessagingSession(session)],
    });
  }

  if (agentWork) {
    if (!agentWork.BotId) {
      findings.push({
        code: "runtime-agent-work-no-bot",
        severity: "warning",
        message:
          "Recent AgentWork has no BotId. Work appears routed to a queue or human path rather than an agent.",
        evidence: [formatAgentWork(agentWork)],
      });
    } else if ((agentWork.ActiveTime ?? 0) <= 0) {
      findings.push({
        code: "runtime-agent-work-zero-active-time",
        severity: "warning",
        message:
          "Recent AgentWork has a BotId but zero ActiveTime. The agent was selected, but planner/topics may have ended the interaction immediately.",
        evidence: [formatAgentWork(agentWork)],
      });
    } else {
      findings.push({
        code: "runtime-agent-work-active",
        severity: "ok",
        message: "Recent AgentWork shows an active bot-handled interaction.",
        evidence: [formatAgentWork(agentWork)],
      });
    }
  }

  if (session) {
    findings.push({
      code: "runtime-messaging-session-found",
      severity: "ok",
      message: "Recent MessagingSession found. Agent runtime likely created a session.",
      evidence: [formatMessagingSession(session)],
    });
  }

  return {
    ok: !findings.some((finding) => finding.severity === "warning"),
    surface,
    findings,
    latest: {
      ...(voice ? { voice_call: voice } : {}),
      ...(agentWork ? { agent_work: agentWork } : {}),
      ...(session ? { messaging_session: session } : {}),
    },
  };
}

async function latestVoiceCalls(conn: Connection): Promise<VoiceCallRow[] | null> {
  return queryOptional<VoiceCallRow>(
    conn,
    "SELECT Id, ConversationId, DisconnectReason, CallDurationInSeconds, VendorType, CreatedDate FROM VoiceCall ORDER BY CreatedDate DESC LIMIT 3",
  );
}

function latestAgentWorks(conn: Connection): Promise<AgentWorkRow[] | null> {
  return queryOptional<AgentWorkRow>(
    conn,
    "SELECT Id, BotId, Status, ActiveTime, HandleTime, CreatedDate FROM AgentWork ORDER BY CreatedDate DESC LIMIT 3",
  );
}

function latestMessagingSessions(conn: Connection): Promise<MessagingSessionRow[] | null> {
  return queryOptional<MessagingSessionRow>(
    conn,
    "SELECT Id, Status, MessagingChannelId, CreatedDate FROM MessagingSession ORDER BY CreatedDate DESC LIMIT 3",
  );
}

async function queryOptional<T>(conn: Connection, soql: string): Promise<T[] | null> {
  try {
    const result = (await conn.query(soql)) as QueryResult<T>;
    return result.records ?? [];
  } catch {
    return null;
  }
}

function formatVoiceCall(row: VoiceCallRow): string {
  return `VoiceCall ${row.Id ?? "?"}: ConversationId=${row.ConversationId ?? "missing"}, DisconnectReason=${row.DisconnectReason ?? "?"}`;
}

function formatAgentWork(row: AgentWorkRow): string {
  return `AgentWork ${row.Id ?? "?"}: BotId=${row.BotId ?? "missing"}, ActiveTime=${row.ActiveTime ?? "?"}, HandleTime=${row.HandleTime ?? "?"}`;
}

function formatMessagingSession(row: MessagingSessionRow): string {
  return `MessagingSession ${row.Id ?? "?"}: Status=${row.Status ?? "?"}`;
}
