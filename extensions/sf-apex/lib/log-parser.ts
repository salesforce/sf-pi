/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic high-signal parser for Apex debug logs. */

import type { ApexLogDigest, ApexLogTimelineEvent } from "./types.ts";

const LIMIT_PATTERNS: Array<[keyof ApexLogDigest["counts"], string, RegExp]> = [
  ["soql", "SOQL queries", /Number of SOQL queries:\s+(\d+)\s+out of\s+(\d+)/],
  ["dml", "DML statements", /Number of DML statements:\s+(\d+)\s+out of\s+(\d+)/],
  ["cpu_ms", "CPU time", /Maximum CPU time:\s+(\d+)\s+out of\s+(\d+)/],
  ["heap_bytes", "heap size", /Maximum heap size:\s+(\d+)\s+out of\s+(\d+)/],
];

export function parseApexLog(
  body: string,
  metadata: Partial<
    Omit<
      ApexLogDigest,
      "counts" | "timeline" | "user_debug" | "exceptions" | "fatal_errors" | "limits"
    >
  > = {},
): ApexLogDigest {
  const digest: ApexLogDigest = {
    ...metadata,
    timeline: [],
    user_debug: [],
    exceptions: [],
    fatal_errors: [],
    limits: {},
    counts: { user_debug: 0, exceptions: 0, fatal_errors: 0 },
  };

  let firstTick: number | undefined;
  const pushEvent = (raw: string, event: Omit<ApexLogTimelineEvent, "offset_ms" | "raw">) => {
    const tick = extractTick(raw);
    if (tick !== undefined && firstTick === undefined) firstTick = tick;
    digest.timeline.push({
      ...event,
      offset_ms:
        tick !== undefined && firstTick !== undefined
          ? Math.max(0, Math.round((tick - firstTick) / 1_000_000))
          : undefined,
      raw,
    });
  };

  const firstLine = body.split(/\r?\n/)[0]?.trim();
  if (firstLine) {
    digest.timeline.push({
      icon: "▶️",
      kind: "start",
      label: "start",
      detail: digest.operation || "Apex execution",
    });
  }

  for (const raw of body.split(/\r?\n/)) {
    const runtimeEvent = parseRuntimeEvent(raw);
    if (runtimeEvent) {
      pushEvent(raw, runtimeEvent);
      continue;
    }

    if (raw.includes("|USER_DEBUG|")) {
      const parts = raw.split("|");
      const loc = parts[2] ?? "";
      const line = /\[(\d+)\]/.exec(loc)?.[1];
      const level = parts[3];
      const message = parts.slice(4).join("|");
      digest.user_debug.push({ line: line ? Number(line) : undefined, level, message, raw });
      pushEvent(raw, { icon: "💬", kind: "debug", label: "debug", detail: message });
      continue;
    }

    if (raw.includes("|EXCEPTION_THROWN|")) {
      const message = raw.split("|").slice(3).join("|");
      const match = /([A-Za-z0-9_.]+Exception):?\s*(.*)/.exec(message);
      const exception = { type: match?.[1], message: match?.[2] || message, raw };
      digest.exceptions.push(exception);
      pushEvent(raw, {
        icon: "🔥",
        kind: "exception",
        label: "exception",
        detail: `${exception.type ?? "Exception"}: ${exception.message ?? raw}`,
      });
      continue;
    }

    if (raw.includes("|FATAL_ERROR|")) {
      digest.fatal_errors.push(raw);
      pushEvent(raw, {
        icon: "💥",
        kind: "fatal",
        label: "fatal",
        detail: raw.split("|FATAL_ERROR|").pop() || raw,
      });
      continue;
    }

    for (const [countKey, label, pattern] of LIMIT_PATTERNS) {
      const match = pattern.exec(raw);
      if (!match) continue;
      const used = Number(match[1]);
      const limit = Number(match[2]);
      digest.limits[label] = { used, limit };
      digest.counts[countKey] = used;
    }
  }

  digest.counts.user_debug = digest.user_debug.length;
  digest.counts.exceptions = digest.exceptions.length;
  digest.counts.fatal_errors = digest.fatal_errors.length;
  digest.timeline.push({
    icon: digest.counts.exceptions || digest.counts.fatal_errors ? "❌" : "✅",
    kind: "complete",
    label: digest.counts.exceptions || digest.counts.fatal_errors ? "failed" : "complete",
    detail:
      digest.counts.exceptions || digest.counts.fatal_errors
        ? "exceptions observed"
        : "no exceptions",
    offset_ms: digest.duration_ms,
  });
  return digest;
}

function parseRuntimeEvent(
  raw: string,
): Omit<ApexLogTimelineEvent, "offset_ms" | "raw"> | undefined {
  const parts = raw.split("|");
  const eventName = parts[1] ?? "";

  if (eventName === "CODE_UNIT_STARTED") {
    return {
      icon: "▶️",
      kind: "code_unit",
      label: "code unit",
      detail: cleanDetail(parts.slice(2)),
    };
  }
  if (eventName === "METHOD_ENTRY") {
    return {
      icon: "↳",
      kind: "method",
      label: "method",
      detail: cleanDetail(parts.slice(4)) || cleanDetail(parts.slice(3)),
    };
  }
  if (eventName === "SOQL_EXECUTE_BEGIN") {
    return {
      icon: "🔢",
      kind: "soql",
      label: "soql",
      detail: cleanSoql(parts.slice(3).join(" · ")),
    };
  }
  if (eventName === "SOQL_EXECUTE_END") {
    return {
      icon: "🔢",
      kind: "soql",
      label: "soql",
      detail: cleanDetail(parts.slice(3)) || "query complete",
    };
  }
  if (eventName === "DML_BEGIN") {
    return { icon: "📝", kind: "dml", label: "dml", detail: cleanDetail(parts.slice(3)) };
  }
  if (eventName === "DML_END") {
    return { icon: "📝", kind: "dml", label: "dml", detail: "operation complete" };
  }
  if (eventName.startsWith("FLOW_")) {
    return {
      icon: "🌊",
      kind: "flow",
      label: "flow",
      detail: `${eventName.replace(/^FLOW_/, "").toLowerCase()} · ${cleanDetail(parts.slice(2))}`,
    };
  }
  if (eventName === "CALLOUT_REQUEST" || eventName === "CALLOUT_RESPONSE") {
    return { icon: "🌐", kind: "callout", label: "callout", detail: cleanDetail(parts.slice(2)) };
  }
  return undefined;
}

function cleanDetail(parts: string[]): string {
  return clip(
    parts
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" · ") || "—",
  );
}

function cleanSoql(value: string): string {
  return clip(value.replace(/\s+/g, " ").trim());
}

function clip(value: string, max = 180): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function extractTick(raw: string): number | undefined {
  const match = /\((\d+)\)\|/.exec(raw);
  return match ? Number(match[1]) : undefined;
}

export function summarizeLogDigest(digest: ApexLogDigest): string {
  const bits = [
    `Apex log${digest.log_id ? ` ${digest.log_id}` : ""}`,
    `${digest.counts.exceptions} exception(s)`,
    `${digest.counts.user_debug} debug line(s)`,
  ];
  if (typeof digest.counts.soql === "number") bits.push(`SOQL ${digest.counts.soql}`);
  if (typeof digest.counts.dml === "number") bits.push(`DML ${digest.counts.dml}`);
  if (typeof digest.counts.cpu_ms === "number") bits.push(`CPU ${digest.counts.cpu_ms}ms`);

  const lines = [bits.join(" · ")];
  const firstException = digest.exceptions[0] ?? digest.fatal_errors[0];
  if (firstException) {
    lines.push("");
    lines.push(
      typeof firstException === "string"
        ? firstException
        : `${firstException.type ?? "Exception"}: ${firstException.message ?? firstException.raw}`,
    );
  }
  if (digest.user_debug.length > 0) {
    lines.push("");
    lines.push("USER_DEBUG:");
    for (const item of digest.user_debug.slice(0, 5)) lines.push(`- ${item.message}`);
    if (digest.user_debug.length > 5) lines.push(`- … +${digest.user_debug.length - 5} more`);
  }
  return lines.join("\n");
}
