/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SF Fin Result Cards (human) and model packets (LLM).
 *
 * Every sf_fin result keeps two audiences apart, as ADR 0065 and ADR 0143 do
 * for SF Docs and Data 360:
 *
 * - `details.card` is an `SfPiResultCard` built from the operation's
 *   structured details (never by parsing text). renderResult draws it.
 * - `content` is the model packet: the operation's compact text, bounded to
 *   MODEL_PACKET_MAX_CHARS and stripped of secrets and session-bearing URLs.
 *
 * Presenters cover readiness checklists, change plans and results (with
 * reversibility and the Guardrail rule), procedures, simulations, Fin Agent
 * API conversations, and the SDK manifest. Anything else gets a generic card
 * from its first text line, so every call still renders as a card.
 */
import type {
  SfPiChip,
  SfPiFact,
  SfPiResultCard,
  SfPiSection,
} from "../../../lib/common/display/result-card.ts";

export const MODEL_PACKET_MAX_CHARS = 6_000;

const TOOL = { id: "sf-fin", label: "SF Fin", icon: "🐟" } as const;

export interface CardInput {
  text: string;
  ok: boolean;
  details: Record<string, unknown>;
}

// ─── Model packet ──────────────────────────────────────────────────────────

/**
 * Bound and sanitize the model-facing text. Session-bearing URLs (frontdoor,
 * OAuth authorize/callback with query strings) are replaced, and any known
 * secret is redacted, even though operations never put them in text.
 */
export function modelPacket(text: string, options: { secrets?: readonly string[] }): string {
  let out = text;
  for (const secret of options.secrets ?? []) {
    if (secret && secret.length >= 3) out = out.split(secret).join("[redacted]");
  }
  out = out.replace(
    /https?:\/\/[^\s)]*(?:frontdoor\.jsp|\/services\/oauth2\/|\/oauth\/|[?&](?:sid|code|token|access_token)=)[^\s)]*/gi,
    "[session URL omitted]",
  );
  if (out.length > MODEL_PACKET_MAX_CHARS) {
    const note = "\n… [truncated; full result in details]";
    out = `${out.slice(0, MODEL_PACKET_MAX_CHARS - note.length)}${note}`;
  }
  return out;
}

// ─── Card dispatch ─────────────────────────────────────────────────────────

export function buildFinCard(input: CardInput): SfPiResultCard {
  const d = input.details;
  const action = str(d.action) ?? "status";
  const operation = str(d.operation);
  const phase = str(d.phase);

  if (action === "salesforce" && Array.isArray(d.checks) && phase === "readiness") {
    return readinessCard(input);
  }
  if (phase === "plan") return planCard(input);
  if (phase === "noop") return noopCard(input);
  if (
    (action === "salesforce" || operation === "publish" || operation === "pause") &&
    phase === "execute"
  ) {
    return executeCard(input);
  }
  if (action === "sdk" && operation === "simulate") return simulationCard(input);
  if (action === "sdk" && (operation === "upload" || operation === "validate")) {
    return procedureCard(input);
  }
  if (action === "agent" && operation === "run") return conversationCard(input);
  if (action === "sdk" && operation === "manifest" && isRecord(d.summary)) {
    return manifestCard(input);
  }
  return genericCard(input);
}

// ─── Readiness ─────────────────────────────────────────────────────────────

type CheckState = "ok" | "missing" | "warn" | "blocked";
interface Check {
  id: string;
  state: CheckState;
  title: string;
  detail?: string;
  fix?: string;
}

const CHECK_ICON: Record<CheckState, string> = {
  ok: "✅",
  missing: "⏳",
  warn: "⚠️",
  blocked: "❌",
};

/** Readiness groups, in the order Fin's own setup asks for them. */
const CHECK_GROUPS: Array<{ title: string; icon: string; ids: RegExp }> = [
  { title: "Package", icon: "📦", ids: /^(package|case-fields|package-permission-set)$/ },
  {
    title: "Org settings",
    icon: "☁️",
    ids: /^(audit-fields|feed-visibility|enhanced-email|lightning-threading|email-to-case)$/,
  },
  {
    title: "Users and permissions",
    icon: "👤",
    ids: /^(external-client-app|access-permission-set|access-audit-permission|profile|fin-user|fin-user-assignments|service-cloud-user|integration-user-assignments|effective-access)$/,
  },
  { title: "Routing", icon: "🧭", ids: /^(case-routing|handoff-queue|field-history)$/ },
  { title: "Connection", icon: "🔗", ids: /^(oauth-connection|fin-side-.*)$/ },
];

function readinessCard(input: CardInput): SfPiResultCard {
  const d = input.details;
  const checks = (d.checks as Check[]).filter((c) => c && typeof c.title === "string");
  const open = checks.filter((c) => c.state !== "ok");
  const firstFix = open.find((c) => c.fix && c.fix !== "human")?.fix;
  const target = str(d.targetOrg);
  const chips: SfPiChip[] = [
    ...(open.length ? [{ label: `${open.length} to do`, tone: "warning" as const }] : []),
    { label: `${checks.length - open.length} ok`, tone: "success" },
  ];
  const sections: SfPiSection[] = [];
  const used = new Set<string>();
  for (const group of CHECK_GROUPS) {
    const rows = checks.filter((c) => group.ids.test(c.id));
    if (!rows.length) continue;
    rows.forEach((c) => used.add(c.id));
    sections.push({ title: group.title, icon: group.icon, rows: rows.map(checkRow) });
  }
  const other = checks.filter((c) => !used.has(c.id));
  if (other.length) sections.push({ title: "Other", icon: "•", rows: other.map(checkRow) });
  return {
    tool: TOOL,
    title: `Fin for Salesforce readiness${target ? ` · ${target}` : ""}`,
    status:
      open.length === 0 ? "success" : open.some((c) => c.state === "blocked") ? "error" : "warning",
    summary:
      open.length === 0
        ? "Salesforce side complete and Fin is connected."
        : `${open.length} item${open.length === 1 ? "" : "s"} left before Fin can work cases in this org.`,
    chips,
    scope: scope(d),
    rails: [{ label: "API", items: [{ verb: "READ", target: "Salesforce org (read-only)" }] }],
    sections: sections.map((s) => ({ ...s, collapsedLimit: 6 })),
    next: firstFix
      ? [
          `sf_fin action='salesforce' operation='${firstFix}'${target ? ` target_org='${target}'` : ""} (plan first)`,
        ]
      : open.length
        ? ["Resolve the remaining item in Fin or Salesforce Setup, then run readiness again."]
        : ["Assign a test case to the Fin user and watch Fin reply."],
    renderHints: { collapsedLines: 28 },
  };
}

const CHECK_LABEL: Record<CheckState, string> = {
  ok: "ok",
  missing: "to do",
  warn: "review",
  blocked: "blocked",
};

function checkRow(check: Check): SfPiFact {
  return {
    icon: CHECK_ICON[check.state] ?? "•",
    label: CHECK_LABEL[check.state] ?? check.state,
    value: check.detail ? `${check.title} — ${check.detail}` : check.title,
    tone: check.state === "ok" ? "success" : check.state === "blocked" ? "error" : "warning",
  };
}

// ─── Plans and results ─────────────────────────────────────────────────────

/** Guardrail rule and reversibility per mutating operation. */
const MUTATIONS: Record<
  string,
  { rule: string; reversible: "reversible" | "one-way" | "org-wide" }
> = {
  package_install: { rule: "native-sf-fin-salesforce-setup", reversible: "reversible" },
  audit_fields_enable: { rule: "native-sf-fin-salesforce-setup", reversible: "org-wide" },
  digital_experiences_enable: { rule: "native-sf-fin-salesforce-setup", reversible: "one-way" },
  permissions_apply: { rule: "native-sf-fin-salesforce-setup", reversible: "reversible" },
  connect: { rule: "native-sf-fin-salesforce-setup", reversible: "reversible" },
  publish: { rule: "native-sf-fin-procedure-state", reversible: "reversible" },
  pause: { rule: "native-sf-fin-procedure-state", reversible: "reversible" },
  guidance_state: { rule: "native-sf-fin-procedure-state", reversible: "reversible" },
  install: { rule: "native-sf-fin-cli-install", reversible: "reversible" },
};

const REVERSIBILITY_CHIP: Record<string, SfPiChip> = {
  reversible: { label: "↩ reversible", tone: "success" },
  "one-way": { label: "⚠ one-way", tone: "error" },
  "org-wide": { label: "🌐 org-wide", tone: "warning" },
};

function planCard(input: CardInput): SfPiResultCard {
  const d = input.details;
  const op = str(d.operation) ?? str(d.action) ?? "change";
  const meta = MUTATIONS[op];
  const reversible = d.oneWay === true ? "one-way" : meta?.reversible;
  const lines = textLines(input.text);
  const steps = lines
    .filter((l) => /^[-•]\s|^\s+-\s/.test(l))
    .map((l) => l.replace(/^\s*[-•]\s*/, ""));
  const execute = lines.find((l) => /allow_mutation=true/.test(l));
  return {
    tool: TOOL,
    title: `Plan · ${humanize(op)}`,
    status: input.ok ? "warning" : "error",
    summary: (lines[0] ?? "").replace(/^Plan:\s*/, ""),
    chips: [
      ...(reversible && REVERSIBILITY_CHIP[reversible] ? [REVERSIBILITY_CHIP[reversible]] : []),
      ...(meta ? [{ label: `🔒 ${meta.rule}`, tone: "info" as const }] : []),
    ],
    scope: scope(d),
    sections: steps.length
      ? [
          {
            title: "What changes",
            icon: "🛠️",
            rows: steps.map((s, i) => ({ label: `${i + 1}`, value: s })),
            collapsedLimit: 6,
          },
        ]
      : [],
    next: [
      execute
        ? execute.replace(/^To (execute|proceed),?\s*(call\s*)?:?\s*/i, "")
        : "Re-run with allow_mutation=true after review (SF Guardrail asks for approval).",
    ],
  };
}

function executeCard(input: CardInput): SfPiResultCard {
  const d = input.details;
  const op = str(d.operation) ?? str(d.action) ?? "change";
  const meta = MUTATIONS[op];
  const lines = textLines(input.text);
  const checks = Array.isArray(d.checks) ? (d.checks as Check[]) : [];
  const open = checks.filter((c) => c.state !== "ok");
  const problems = Array.isArray(d.problems) ? (d.problems as string[]) : [];
  return {
    tool: TOOL,
    title: `${input.ok ? "Applied" : "Not applied"} · ${humanize(op)}`,
    status: input.ok ? "success" : "error",
    summary: stripStatus(lines[0] ?? ""),
    chips: [
      { label: input.ok ? "verified" : "check failed", tone: input.ok ? "success" : "error" },
      ...(meta ? [{ label: `🔒 ${meta.rule}`, tone: "info" as const }] : []),
    ],
    scope: scope(d),
    sections: [
      ...(problems.length
        ? [
            {
              title: "Problems",
              icon: "❌",
              rows: problems.map((p, i) => ({
                label: `${i + 1}`,
                value: p,
                tone: "error" as const,
              })),
            },
          ]
        : []),
      ...(checks.length
        ? [
            {
              title: open.length ? `Still to do (${open.length})` : "Readiness",
              icon: open.length ? "⏳" : "✅",
              rows: (open.length ? open : checks.slice(0, 3)).map(checkRow),
              collapsedLimit: 4,
            },
          ]
        : []),
    ],
    next: lines.filter((l) => /^Next:/.test(l)).map((l) => l.replace(/^Next:\s*/, "")),
  };
}

function noopCard(input: CardInput): SfPiResultCard {
  const d = input.details;
  const op = str(d.operation) ?? str(d.action) ?? "change";
  return {
    tool: TOOL,
    title: `Already done · ${humanize(op)}`,
    status: "success",
    summary: stripStatus(textLines(input.text)[0] ?? ""),
    chips: [{ label: "no change", tone: "success" }],
    scope: scope(d),
  };
}

// ─── Procedures and simulations ────────────────────────────────────────────

function procedureCard(input: CardInput): SfPiResultCard {
  const d = input.details;
  const id = str(d.procedureId);
  const state = str(d.savedState);
  const version = str(d.savedVersion);
  const issues = Array.isArray(d.issues)
    ? (d.issues as Array<{ path: string; message: string }>)
    : [];
  const warnings = Array.isArray(d.warnings)
    ? (d.warnings as Array<{ path: string; message: string }>)
    : [];
  const drift = Array.isArray(d.drift) ? (d.drift as string[]) : [];
  const lines = textLines(input.text);
  return {
    tool: TOOL,
    title: `Procedure · ${str(d.operation) === "validate" ? "validate" : "upload"}`,
    status: !input.ok ? "error" : warnings.length ? "warning" : "success",
    summary: `${stripStatus(lines[0] ?? "")}${id && !(lines[0] ?? "").includes(id) ? ` (procedure ${id})` : ""}`,
    chips: [
      ...(state
        ? [{ label: state, tone: state === "live" ? ("warning" as const) : ("info" as const) }]
        : []),
      ...(version ? [{ label: `v${version}`, tone: "muted" as const }] : []),
      ...(d.verified === true ? [{ label: "round-trip verified", tone: "success" as const }] : []),
    ],
    sections: [
      ...(issues.length
        ? [
            {
              title: "Issues",
              icon: "❌",
              rows: issues.map((i) => fact(i.path, i.message, "error")),
            },
          ]
        : []),
      ...(drift.length
        ? [
            {
              title: "Changed on save",
              icon: "⚠️",
              rows: drift.map((p) => fact("path", p, "warning")),
            },
          ]
        : []),
      ...(warnings.length
        ? [
            {
              title: "Warnings",
              icon: "⚠️",
              rows: warnings.map((w) => fact(w.path, w.message, "warning")),
            },
          ]
        : []),
    ],
    next: lines.filter((l) => /^Next edit:/.test(l)).map((l) => l.replace(/^Next edit:\s*/, "")),
  };
}

function simulationCard(input: CardInput): SfPiResultCard {
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
  const tested = str(d.tested);
  return {
    tool: TOOL,
    title: `Simulations${d.procedureId ? ` · procedure ${String(d.procedureId)}` : ""}`,
    status: input.ok ? "success" : "error",
    summary:
      textLines(input.text).find((l) => /^Simulations:/.test(l)) ?? textLines(input.text)[0] ?? "",
    chips: [
      {
        label: `${passed}/${total} passed`,
        tone: passed === total && total > 0 ? "success" : "error",
      },
      ...(tested ? [{ label: `${tested} tested`, tone: "info" as const }] : []),
    ],
    sections: runs.length
      ? [
          {
            title: "Simulations",
            icon: "🧪",
            rows: runs.map((r) => ({
              icon: r.passed === true ? "✅" : r.passed === false ? "❌" : "⏳",
              label: r.status,
              value: [r.name ?? r.runId, ...(r.failures ?? [])].join(" — "),
              tone:
                r.passed === true
                  ? ("success" as const)
                  : r.passed === false
                    ? ("error" as const)
                    : ("warning" as const),
            })),
            collapsedLimit: 8,
          },
        ]
      : [],
    next: input.ok
      ? []
      : ["Read each failed assertion, fix the procedure or the test, and simulate again."],
  };
}

// ─── Conversations ─────────────────────────────────────────────────────────

function conversationCard(input: CardInput): SfPiResultCard {
  const d = input.details;
  const transcript = Array.isArray(d.transcript)
    ? (d.transcript as Array<{ role: string; text: string }>)
    : [];
  const status = str(d.status);
  return {
    tool: TOOL,
    title: `Fin conversation${d.conversationId ? ` · ${String(d.conversationId)}` : ""}`,
    status: input.ok ? "success" : "warning",
    summary: status === "answered" ? "Fin answered." : "Fin did not reply within the poll limit.",
    chips: [
      { label: status ?? "unknown", tone: input.ok ? "success" : "warning" },
      { label: "💲 billable", tone: "warning" },
    ],
    sections: transcript.length
      ? [
          {
            title: "Conversation",
            icon: "💬",
            rows: transcript.map((t) => ({
              icon: t.role === "user" ? "👤" : "🤖",
              label: t.role === "user" ? "User" : "Fin",
              value: t.text,
              tone: t.role === "user" ? ("muted" as const) : ("info" as const),
            })),
            collapsedLimit: 6,
          },
        ]
      : [],
  };
}

// ─── Manifest ──────────────────────────────────────────────────────────────

function manifestCard(input: CardInput): SfPiResultCard {
  const summary = input.details.summary as {
    workspace?: { name?: string };
    counts: Record<string, number>;
    items: Record<string, Array<{ id?: string; name?: string; state?: string }>>;
  };
  const sections: SfPiSection[] = Object.entries(summary.items ?? {})
    .filter(([, list]) => list.length > 0)
    .map(([kind, list]) => ({
      title: humanize(kind),
      icon: "📦",
      rows: list.map((item) => ({
        icon:
          item.state === "live"
            ? "🟢"
            : item.state === "draft"
              ? "🟡"
              : item.state === "paused"
                ? "⏸️"
                : "•",
        label: item.id ?? "",
        value: `${item.name ?? "(unnamed)"}${item.state ? ` · ${item.state}` : ""}`,
      })),
      collapsedLimit: 5,
    }));
  return {
    tool: TOOL,
    title: `Fin workspace · ${summary.workspace?.name ?? "manifest"}`,
    status: input.ok ? "info" : "error",
    summary: Object.entries(summary.counts ?? {})
      .map(([k, n]) => `${n} ${k}`)
      .join(" · "),
    rails: [{ label: "CLI", items: [{ verb: "READ", target: "intercom fin manifest" }] }],
    sections,
  };
}

// ─── Generic ───────────────────────────────────────────────────────────────

function genericCard(input: CardInput): SfPiResultCard {
  const d = input.details;
  const lines = textLines(input.text);
  const title = [str(d.action) ?? "status", str(d.operation)].filter(Boolean).join(" · ");
  return {
    tool: TOOL,
    title: humanize(title),
    status: input.ok ? "info" : "error",
    summary: stripStatus(lines[0] ?? ""),
    sections:
      lines.length > 1
        ? [
            {
              title: "Details",
              icon: "📄",
              rows: lines.slice(1).map((l, i) => ({ label: `${i + 1}`, value: l })),
              collapsedLimit: 8,
            },
          ]
        : [],
    renderHints: { collapsedLines: 14 },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const STATUS_PREFIXES = ["✅", "❌", "⚠️", "⚠", "ℹ️", "ℹ"];

/** Drop one leading status emoji (the card shows status itself). */
function stripStatus(line: string): string {
  const trimmed = line.trimStart();
  const prefix = STATUS_PREFIXES.find((p) => trimmed.startsWith(p));
  return prefix ? trimmed.slice(prefix.length).trimStart() : trimmed;
}

function scope(d: Record<string, unknown>): SfPiFact[] {
  return [
    ...optionalFact("org", str(d.targetOrg), "info"),
    ...optionalFact("type", str(d.orgType)),
  ];
}

function optionalFact(
  label: string,
  value: string | undefined,
  tone?: SfPiFact["tone"],
): SfPiFact[] {
  return value ? [{ label, value, ...(tone ? { tone } : {}) }] : [];
}

function fact(label: string, value: string, tone: SfPiFact["tone"]): SfPiFact {
  return { label, value, tone };
}

function textLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
}

function humanize(value: string): string {
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value
    : typeof value === "number"
      ? String(value)
      : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
