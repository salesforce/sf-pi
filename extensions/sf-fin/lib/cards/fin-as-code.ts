/* SPDX-License-Identifier: Apache-2.0 */
/** Fin-as-code cards: procedures, simulations, conversations, agents, tokens, connectors, and the manifest. */
import type { FinBlock, FinCard, FinCardStatus, FinRow, FinSpan } from "../fin-card.ts";
import {
  stripStatus,
  stateTone,
  stateGlyph,
  readableName,
  localTime,
  textLines,
  humanize,
  str,
  num,
  isRecord,
  isString,
} from "./helpers.ts";
import type { CardInput } from "./helpers.ts";
import { genericCard } from "./generic.ts";

// ─── Procedures and simulations ────────────────────────────────────────────

export function procedureCard(input: CardInput): FinCard {
  const d = input.details;
  const id = str(d.procedureId) ?? str(d.id);
  const state = str(d.savedState) ?? str(d.state);
  const version = str(d.savedVersion);
  const validate = str(d.operation) === "validate";
  const issues = Array.isArray(d.issues)
    ? (d.issues as Array<{ path: string; message: string }>)
    : [];
  const warnings = Array.isArray(d.warnings)
    ? (d.warnings as Array<{ path: string; message: string }>)
    : [];
  const drift = Array.isArray(d.drift) ? (d.drift as string[]) : [];
  const lines = textLines(input.text);
  const nextEdit = lines.find((l) => /^Next edit:/u.test(l))?.replace(/^Next edit:\s*/u, "");
  const status: FinCardStatus = !input.ok
    ? "error"
    : warnings.length || drift.length
      ? "warning"
      : "success";
  return {
    status,
    icon: "📄",
    title: validate
      ? input.ok
        ? "Valid"
        : `${issues.length} problem${issues.length === 1 ? "" : "s"} to fix`
      : input.ok
        ? "Uploaded as a draft"
        : "Not uploaded",
    meta: [
      id ? `procedure ${id}` : undefined,
      state,
      version ? `v${version}` : undefined,
      d.verified === true ? "round-trip verified" : undefined,
    ].filter(isString),
    lead: stripStatus(lines[0] ?? ""),
    blocks: [
      ...(issues.length
        ? [
            {
              kind: "rows" as const,
              title: "Fix",
              icon: "✕",
              rows: issues.map((i) => ({
                icon: "✕",
                iconTone: "error" as const,
                label: i.path,
                value: i.message,
              })),
            },
          ]
        : []),
      ...(drift.length
        ? [
            {
              kind: "rows" as const,
              title: "Changed on save",
              icon: "⚠",
              rows: drift.map((p) => ({ icon: "⚠", iconTone: "warning" as const, value: p })),
            },
          ]
        : []),
      ...(warnings.length
        ? [
            {
              kind: "rows" as const,
              title: "Warnings",
              icon: "⚠",
              rows: warnings.map((w) => ({
                icon: "⚠",
                iconTone: "warning" as const,
                label: w.path,
                value: w.message,
              })),
            },
          ]
        : []),
    ],
    next: nextEdit ? `Before the next edit: ${nextEdit.replace(/`/gu, "")}` : undefined,
    hint: !validate && input.ok ? "Nothing is live. Publishing is a separate step." : undefined,
  };
}

export function simulationUploadCard(input: CardInput): FinCard {
  const d = input.details;
  if (str(d.phase) === "duplicates" && Array.isArray(d.matches)) {
    const matches = d.matches as Array<{ name: string; ids: string[] }>;
    return {
      status: "error",
      icon: "🧪",
      title: "Not uploaded · would add duplicates",
      meta: ["nothing changed"],
      lead: "These tests have no id but already exist by name. Add each id to update it in place.",
      blocks: [
        {
          kind: "rows",
          rows: matches.map((m) => ({
            icon: "✕",
            iconTone: "error" as const,
            label: m.name,
            value: [{ text: `add id: ${m.ids.join(" or ")}`, tone: "info" as const }],
          })),
        },
      ],
    };
  }
  const tests = Array.isArray(d.tests) ? (d.tests as Array<{ id?: string; name?: string }>) : [];
  const duplicates = Array.isArray(d.duplicates) ? (d.duplicates as string[]) : [];
  if (!input.ok || !tests.length) return genericCard(input);
  return {
    status: duplicates.length ? "warning" : "success",
    icon: "🧪",
    title: `${tests.length} simulation${tests.length === 1 ? "" : "s"} saved`,
    meta: [str(d.procedureId) ? `procedure ${str(d.procedureId)}` : undefined].filter(isString),
    blocks: [
      {
        kind: "rows",
        rows: tests.map((t) => ({
          icon: duplicates.includes(t.name ?? "") ? "⚠" : "✓",
          iconTone: duplicates.includes(t.name ?? "") ? ("warning" as const) : ("success" as const),
          label: t.name ?? "(unnamed)",
          value: [{ text: t.id ? `#${t.id}` : "", tone: "dim" as const }],
        })),
      },
      ...duplicates.map((name) => ({
        kind: "text" as const,
        text: [
          {
            text: `${name} appears more than once. Uploads add tests without an id; remove the extra one in Fin.`,
            tone: "warning" as const,
          },
        ],
      })),
    ],
    next: "Run the tests (without generating more) to check the procedure.",
  };
}

export function resourceUploadCard(input: CardInput): FinCard {
  const d = input.details;
  const guidance = d.kind === "guidance";
  const kind = guidance ? "Guidance" : "Data connector";
  const id = str(d.id);
  const state = str(d.state);
  if (!input.ok) {
    return { ...genericCard(input), icon: guidance ? "🧭" : "🔌", title: `${kind} not uploaded` };
  }
  const pending = d.pending === true;
  return {
    status: pending ? "warning" : "success",
    icon: guidance ? "🧭" : "🔌",
    title: pending ? `${kind} · unpublished changes` : `${kind} uploaded · ${state ?? "saved"}`,
    meta: [id ? `#${id}` : undefined].filter(isString),
    lead: stripStatus(textLines(input.text)[0] ?? ""),
    next: pending
      ? 'Fin still serves the previous version. Test the edit in Fin\'s connector editor, then click "Set changes live".'
      : guidance
        ? "Set it live when you want Fin to use it (the agent plans it first)."
        : "Drafts are not available to Fin. Set it live when it is ready (the agent plans it first).",
  };
}

export function simulationCard(input: CardInput): FinCard {
  const d = input.details;
  const runs = Array.isArray(d.runs)
    ? (d.runs as Array<{
        name?: string;
        runId: string;
        status: string;
        passed?: boolean;
        failures?: string[];
      }>)
    : [];
  const passed = num(d.passed) ?? runs.filter((r) => r.passed === true).length;
  const total = num(d.total) ?? runs.length;
  const failed = runs.filter((r) => r.passed === false).length;
  const running = total - passed - failed;
  const tested = str(d.tested);
  const rows: FinRow[] = runs.flatMap((r) => [
    {
      icon: r.passed === true ? "✓" : r.passed === false ? "✕" : "…",
      iconTone:
        r.passed === true
          ? ("success" as const)
          : r.passed === false
            ? ("error" as const)
            : ("warning" as const),
      value: r.name ?? r.runId,
    },
    ...(r.failures ?? []).map((f) => ({ value: [{ text: f, tone: "error" as const }] })),
  ]);
  return {
    status: failed ? "error" : running ? "warning" : "success",
    icon: "🧪",
    title: "Simulations",
    meta: [d.procedureId ? `procedure ${String(d.procedureId)}` : undefined, tested].filter(
      isString,
    ),
    lead: [
      {
        text: failed
          ? `${failed} of ${total} failed`
          : running
            ? `${passed} of ${total} passed, ${running} still running`
            : `All ${total} passed`,
        tone: failed ? "error" : running ? "warning" : "success",
        bold: true,
      },
    ],
    blocks: [
      {
        kind: "meter",
        done: passed,
        total: Math.max(1, total),
        label: `${passed} of ${total} passed`,
        restTone: failed ? "error" : running ? "warning" : undefined,
      },
      ...(rows.length ? [{ kind: "rows" as const, rows }] : []),
    ],
    next: failed
      ? "Fix the procedure or the test, then run the tests again."
      : running
        ? "Run the tests again in a moment to collect the rest."
        : undefined,
  };
}

// ─── Conversations ─────────────────────────────────────────────────────────

export function conversationCard(input: CardInput): FinCard {
  const d = input.details;
  const transcript = Array.isArray(d.transcript)
    ? (d.transcript as Array<{ role: string; text: string }>)
    : [];
  const answered = str(d.status) === "answered";
  const signals = (isRecord(d.signals) ? d.signals : {}) as {
    citations?: number;
    handoff?: boolean;
  };
  const expectations = isRecord(d.expectations)
    ? (d.expectations as { passed: boolean; results: Array<{ expect: string; found: boolean }> })
    : undefined;
  const met = expectations?.results.filter((r) => r.found).length ?? 0;
  const notes = [
    signals.citations
      ? `📎 ${signals.citations} source${signals.citations === 1 ? "" : "s"} cited`
      : undefined,
    signals.handoff ? "🙋 handed to a person" : undefined,
  ].filter(isString);
  return {
    status: !answered ? "warning" : expectations && !expectations.passed ? "error" : "success",
    icon: "💬",
    title: "Fin conversation",
    meta: [
      expectations ? `${met} of ${expectations.results.length} expected` : undefined,
      d.procedureId ? `procedure ${String(d.procedureId)}` : undefined,
      "billable",
    ].filter(isString),
    lead: !answered ? "Fin did not reply within the wait limit." : undefined,
    blocks: [
      ...(transcript.length
        ? [
            {
              kind: "chat" as const,
              turns: transcript.map((t) => ({
                who: t.role === "user" ? ("you" as const) : ("fin" as const),
                text: t.text,
              })),
              notes: notes.length ? [notes.join("  ·  ")] : undefined,
            },
          ]
        : []),
      ...(expectations
        ? [
            {
              kind: "rows" as const,
              title: "Expected",
              icon: "🧪",
              rows: expectations.results.map((r) => ({
                icon: r.found ? "✓" : "✕",
                iconTone: r.found ? ("success" as const) : ("error" as const),
                value: [
                  { text: `"${r.expect}"` },
                  ...(r.found ? [] : [{ text: "  not in Fin's reply", tone: "error" as const }]),
                ],
              })),
            },
          ]
        : []),
    ],
    next:
      expectations && !expectations.passed
        ? "Check the procedure's wording or the connector's data, then run again."
        : !answered
          ? "Run it again; Fin may still be working on the reply."
          : undefined,
  };
}

// ─── Agent status, auth tokens, connector logs ─────────────────────────────

const CHANNEL_LABEL: Record<string, string> = {
  fin_agent_api: "Fin Agent API",
  web: "Web",
  ios: "iOS",
  android: "Android",
  email: "Email",
  whatsapp: "WhatsApp",
  sms: "SMS",
  phone: "Phone",
};

export function agentStatusCard(input: CardInput): FinCard {
  const d = input.details;
  const p = d.procedure as { id: string; name: string; state: string; unpublished?: boolean };
  const channels = Array.isArray(d.channels) ? (d.channels as string[]) : [];
  const connectors = Array.isArray(d.connectors)
    ? (d.connectors as Array<{
        id?: string;
        name: string;
        state: string;
        tokens: string[];
        read?: boolean;
      }>)
    : [];
  const sims = num(d.simulations);
  const live = p.state === "live";
  const connectorsLive = connectors.every((c) => c.state === "live");
  const tokens = [...new Set(connectors.flatMap((c) => c.tokens))];
  const channel = channels.length
    ? channels.map((c) => CHANNEL_LABEL[c] ?? humanize(c)).join(", ")
    : "all channels";
  const ready = live && connectorsLive && (sims ?? 0) > 0;
  const lead: FinSpan[] = live
    ? p.unpublished
      ? [
          { text: "Live", tone: "success", bold: true },
          { text: ", with unpublished draft changes." },
        ]
      : [
          { text: "Live.", tone: "success", bold: true },
          {
            text: connectorsLive
              ? " Fin uses this procedure on its channels."
              : " A connector is not live yet.",
          },
        ]
    : [
        { text: `${humanize(p.state)}.`, tone: "warning", bold: true },
        {
          text: ` Fin isn't using this procedure.${connectors.length ? (connectorsLive ? ` Its connector${connectors.length === 1 ? " is" : "s are"} live${tokens.length ? " and signed in" : ""}.` : " A connector is not live yet.") : ""}`,
        },
      ];
  const flow: FinBlock = {
    kind: "flow",
    steps: [
      { label: "Channel", state: channel, tone: "info", glyph: "📣" },
      { label: "Procedure", state: p.state, tone: stateTone(p.state), glyph: stateGlyph(p.state) },
      ...(connectors.length
        ? [
            {
              label: connectors.length === 1 ? "Connector" : `${connectors.length} connectors`,
              state: connectorsLive ? "live" : "not all live",
              tone: connectorsLive ? ("success" as const) : ("warning" as const),
              glyph: connectorsLive ? "●" : "○",
            },
          ]
        : []),
      ...(tokens.length
        ? [{ label: "Token", state: "signed in", tone: "success" as const, glyph: "🔑" }]
        : []),
    ],
  };
  return {
    status: ready ? "success" : "warning",
    icon: "🤖",
    title: p.name,
    meta: [p.state, sims !== undefined ? `${sims} test${sims === 1 ? "" : "s"}` : undefined].filter(
      isString,
    ),
    lead,
    blocks: [
      flow,
      {
        kind: "rows",
        rows: [
          {
            icon: "🧪",
            label: "Tests",
            value:
              sims === undefined
                ? "unknown"
                : sims
                  ? `${sims} simulation${sims === 1 ? "" : "s"} saved`
                  : "none yet",
            tone: sims ? undefined : "warning",
          },
          ...connectors.map((c) => ({
            icon: "🔌",
            label: "Connector",
            value: [
              { text: c.name },
              {
                text: `  ${c.state}`,
                tone: c.state === "live" ? ("success" as const) : ("warning" as const),
              },
              ...(c.id ? [{ text: `  #${c.id}`, tone: "dim" as const }] : []),
            ],
          })),
          ...tokens.map((t) => ({ icon: "🔑", label: "Signs in with", value: t })),
          ...connectors
            .filter((c) => c.read === false)
            .map((c) => ({
              icon: "⚠",
              iconTone: "warning" as const,
              label: "Unreadable",
              value: `${c.name}: its token could not be read`,
            })),
        ],
      },
    ],
    next: agentNext(p, connectors, sims),
    hint: !live && sims ? "Publishing asks you first and can be paused again." : undefined,
  };
}

function agentNext(
  p: { state: string; unpublished?: boolean },
  connectors: Array<{ state: string; name: string }>,
  sims: number | undefined,
): string {
  const missing = connectors.find((c) => c.state === "missing");
  if (missing) return `Create and upload the data connector "${missing.name}".`;
  const draft = connectors.find((c) => c.state !== "live");
  if (draft) return `Set the data connector "${draft.name}" live (the agent plans it first).`;
  if (!sims) return "Write a simulation set and upload it, then run the tests.";
  if (p.state !== "live")
    return `Run the ${sims} saved test${sims === 1 ? "" : "s"}, then publish when you want it live.`;
  if (p.unpublished) return "Run the tests on the draft, then publish it.";
  return "Test it end to end with a Fin Agent API conversation.";
}

export function authTokensCard(input: CardInput): FinCard {
  const tokens = input.details.tokens as Array<{
    id: string;
    name: string;
    type?: string;
    connectors: string[];
  }>;
  const unused = tokens.filter((t) => t.connectors.length === 0).length;
  return {
    status: "info",
    icon: "🔑",
    title: "Fin auth tokens",
    meta: [
      `${tokens.length} token${tokens.length === 1 ? "" : "s"}`,
      unused ? `${unused} unused` : undefined,
    ].filter(isString),
    blocks: [
      {
        kind: "rows",
        rows: tokens.flatMap((t) => [
          {
            icon: t.connectors.length ? "●" : "○",
            iconTone: t.connectors.length ? ("success" as const) : ("dim" as const),
            value: [
              { text: t.name, bold: true },
              ...(t.type ? [{ text: `  ${t.type}`, tone: "muted" as const }] : []),
              { text: `  #${t.id}`, tone: "dim" as const },
            ],
          },
          {
            value: [
              {
                text: t.connectors.length
                  ? `used by ${t.connectors.join(", ")}`
                  : "not used by any connector",
                tone: "muted" as const,
              },
            ],
          },
        ]),
      },
    ],
    hint: "Secret values are never read.",
  };
}

export function connectorLogsCard(input: CardInput): FinCard {
  const d = input.details;
  const runs = d.runs as Array<{
    success: boolean;
    status?: number;
    error?: string;
    ms?: number;
    source?: string;
    at?: string;
  }>;
  const failed = num(d.failed) ?? runs.filter((r) => !r.success).length;
  const times = runs.map((r) => r.ms).filter((ms): ms is number => typeof ms === "number");
  const avg = times.length
    ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
    : undefined;
  const slowest = times.length ? Math.max(...times) : undefined;
  const hours = num(d.hours) ?? 24;
  const window =
    hours % 24 === 0
      ? `last ${hours / 24 === 1 ? "24 hours" : `${hours / 24} days`}`
      : `last ${hours}h`;
  return {
    status: failed > 0 ? "warning" : runs.length ? "success" : "info",
    icon: "🔌",
    title: "Connector runs",
    meta: [d.connectorId ? `#${String(d.connectorId)}` : undefined, window].filter(isString),
    lead: runs.length
      ? [
          {
            text: `${runs.length - failed} of ${runs.length} succeeded`,
            tone: failed ? "warning" : "success",
            bold: true,
          },
          ...(avg !== undefined
            ? [{ text: `    avg ${avg}ms    slowest ${slowest}ms`, tone: "muted" as const }]
            : []),
        ]
      : "No runs in this window.",
    blocks: runs.length
      ? [
          {
            kind: "rows",
            rows: runs.slice(0, 20).map((r) => ({
              icon: r.success ? "✓" : "✕",
              iconTone: r.success ? ("success" as const) : ("error" as const),
              value: [
                { text: (localTime(r.at) ?? r.at ?? "?").padEnd(15), tone: "muted" as const },
                {
                  text: ` ${r.status ?? "?"}`,
                  tone: r.success ? ("success" as const) : ("error" as const),
                },
                { text: `  ${r.ms ?? "?"}ms`.padEnd(9) },
                ...(r.error ? [{ text: ` ${r.error}`, tone: "error" as const }] : []),
                { text: ` ${sourceLabel(r.source)}`, tone: "muted" as const },
              ],
            })),
          },
        ]
      : [],
    hint: "Request and response bodies are never read.",
  };
}

function sourceLabel(source: string | undefined): string {
  const m = /^fin (\d+)$/u.exec(source ?? "");
  return m ? `called by procedure ${m[1]}` : source || "unknown source";
}

// ─── Manifest ──────────────────────────────────────────────────────────────

const KIND_ICON: Record<string, string> = {
  procedures: "🤖",
  tasks: "📋",
  data_connectors: "🔌",
  guidance: "🧭",
  workflows: "⚡",
};

export function manifestCard(input: CardInput): FinCard {
  const summary = input.details.summary as {
    workspace?: { name?: string };
    counts: Record<string, number>;
    items: Record<string, Array<{ id?: string; name?: string; state?: string }>>;
  };
  const blocks: FinBlock[] = Object.entries(summary.items ?? {})
    .filter(([, list]) => list.length > 0)
    .map(([kind, list]) => ({
      kind: "rows" as const,
      title: humanize(kind),
      icon: KIND_ICON[kind] ?? "📦",
      note: String(summary.counts?.[kind] ?? list.length),
      rows: list.map((item) => ({
        icon: item.state ? stateGlyph(item.state) : "•",
        iconTone: item.state ? stateTone(item.state) : ("muted" as const),
        value: [
          { text: readableName(item.name ?? "(unnamed)") },
          ...(item.state ? [{ text: `  ${item.state}`, tone: stateTone(item.state) }] : []),
          ...(item.id ? [{ text: `  #${item.id}`, tone: "dim" as const }] : []),
        ],
      })),
    }));
  return {
    status: input.ok ? "info" : "error",
    icon: "🗂️",
    title: `Fin workspace${summary.workspace?.name ? ` · ${summary.workspace.name}` : ""}`,
    lead: [
      {
        text: Object.entries(summary.counts ?? {})
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${n} ${humanize(k).toLowerCase()}`)
          .join(" · "),
        tone: "muted",
      },
    ],
    blocks,
  };
}
