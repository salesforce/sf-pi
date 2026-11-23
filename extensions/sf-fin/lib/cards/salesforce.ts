/* SPDX-License-Identifier: Apache-2.0 */
/** Fin for Salesforce cards: readiness and how Fin worked cases. */
import type { FinBlock, FinCard, FinRow, FinSpan, FinTone } from "../fin-card.ts";
import { FIX_LABEL, localTime, humanize, str, num, isRecord, isString } from "./helpers.ts";
import type { CardInput } from "./helpers.ts";

// ─── Readiness ─────────────────────────────────────────────────────────────

export type CheckState = "ok" | "missing" | "warn" | "blocked";
export interface Check {
  id: string;
  state: CheckState;
  title: string;
  detail?: string;
  fix?: string;
}

/** Readiness groups, in the order Fin's own setup asks for them. */
const CHECK_GROUPS: Array<{ title: string; icon: string; ids: RegExp }> = [
  { title: "Package", icon: "📦", ids: /^(package|case-fields|package-permission-set)$/ },
  {
    title: "Settings",
    icon: "☁️",
    ids: /^(audit-fields|feed-visibility|enhanced-email|lightning-threading|email-to-case)$/,
  },
  {
    title: "Access",
    icon: "👤",
    ids: /^(external-client-app|access-permission-set|access-audit-permission|profile|fin-user|fin-user-assignments|service-cloud-user|integration-user-assignments|effective-access)$/,
  },
  { title: "Routing", icon: "🧭", ids: /^(case-routing|handoff-queue|field-history)$/ },
  { title: "Connection", icon: "🔗", ids: /^(oauth-connection|fin-side-.*)$/ },
];

export function readinessCard(input: CardInput): FinCard {
  const d = input.details;
  const checks = (d.checks as Check[]).filter((c) => c && typeof c.title === "string");
  const open = checks.filter((c) => c.state !== "ok");
  const passing = checks.length - open.length;
  const blocked = open.some((c) => c.state === "blocked");
  const firstFix = open.find((c) => c.fix && c.fix !== "human")?.fix;
  const groups = CHECK_GROUPS.map((g) => ({
    ...g,
    checks: checks.filter((c) => g.ids.test(c.id)),
  })).filter((g) => g.checks.length);
  const grouped = new Set(groups.flatMap((g) => g.checks.map((c) => c.id)));
  const other = checks.filter((c) => !grouped.has(c.id));
  if (other.length) groups.push({ title: "Other", icon: "•", ids: /$^/, checks: other });

  const connected = d.connected === true;
  const lead: FinSpan[] =
    open.length === 0
      ? [{ text: "Fin is connected and ready to work cases.", tone: "success", bold: true }]
      : connected
        ? [
            { text: "Fin is connected and cases reach it. ", tone: "success", bold: true },
            {
              text: `${open.length} item${open.length === 1 ? "" : "s"} to review before go-live.`,
              tone: "warning",
            },
          ]
        : [
            {
              text: `${open.length} item${open.length === 1 ? "" : "s"} left before Fin can work cases in this org.`,
              tone: blocked ? "error" : "warning",
            },
          ];

  const blocks: FinBlock[] = [
    {
      kind: "meter",
      done: passing,
      total: checks.length,
      label: `${passing} of ${checks.length} checks pass`,
      restTone: blocked ? "error" : "warning",
    },
    {
      kind: "stages",
      stages: groups.map((g) => ({
        label: g.title,
        state: g.checks.some((c) => c.state !== "ok") ? "open" : "ok",
      })),
    },
  ];
  if (open.length) {
    blocks.push({
      kind: "rows",
      title: "Needs you",
      icon: "⚠",
      rows: open.flatMap((c) => checkRows(c, true)),
    });
  }
  for (const g of groups) {
    blocks.push({
      kind: "rows",
      title: g.title,
      icon: g.icon,
      note: `${g.checks.filter((c) => c.state === "ok").length}/${g.checks.length}`,
      rows: g.checks.map((c) => checkRow(c)),
      expandedOnly: true,
    });
  }
  const target = str(d.targetOrg);
  return {
    status: open.length === 0 ? "success" : blocked ? "error" : "warning",
    icon: "☁️",
    title: "Fin for Salesforce",
    meta: [target, str(d.orgType)].filter(isString),
    lead,
    blocks,
    next: firstFix
      ? `${FIX_LABEL[firstFix] ?? humanize(firstFix)}. The agent plans it first; you approve the change.`
      : open.length
        ? open.every((c) => c.state === "warn")
          ? "Nothing to run. Review the item above in Fin or Salesforce Setup."
          : "Resolve the item above in Fin or Salesforce Setup, then check readiness again."
        : "Assign a test case to the Fin user and watch Fin reply.",
    hint: open.length ? "ctrl+o shows all checks" : undefined,
  };
}

const CHECK_GLYPH: Record<CheckState, { glyph: string; tone: FinTone }> = {
  ok: { glyph: "✓", tone: "success" },
  missing: { glyph: "○", tone: "warning" },
  warn: { glyph: "⚠", tone: "warning" },
  blocked: { glyph: "✕", tone: "error" },
};

export function checkRow(check: Check): FinRow {
  const g = CHECK_GLYPH[check.state] ?? CHECK_GLYPH.missing;
  return { icon: g.glyph, iconTone: g.tone, value: check.title };
}

/** An open check with its explanation on the lines under it. */
function checkRows(check: Check, withDetail: boolean): FinRow[] {
  const rows = [{ ...checkRow(check), value: [{ text: check.title, bold: true }] as FinSpan[] }];
  if (withDetail && check.detail) rows.push({ value: [{ text: check.detail, tone: "muted" }] });
  return rows;
}

// ─── Observe ───────────────────────────────────────────────────────────────

/**
 * Fin's resolution states as plain words. Fin writes them to the case as
 * finai__FinResolutionState__c; observe passes on the picklist labels.
 */
const OUTCOMES: Array<{ state: string; label: string; tone: FinTone; short: string }> = [
  { state: "Soft Resolution", label: "Answered, no follow-up", tone: "success", short: "answered" },
  { state: "Hard Resolution", label: "Customer confirmed", tone: "success", short: "confirmed" },
  { state: "Routed to Team", label: "Handed to your team", tone: "warning", short: "handed off" },
  { state: "Abandoned", label: "Customer left", tone: "muted", short: "customer left" },
];

export function observeCard(input: CardInput): FinCard {
  const d = input.details;
  const involved = num(d.involved) ?? 0;
  const owned = num(d.finUserOwned) ?? 0;
  const routed = num(d.routed) ?? 0;
  const rate = num(d.resolutionRate);
  const byResolution = isRecord(d.byResolution) ? (d.byResolution as Record<string, number>) : {};
  const recent = Array.isArray(d.recent)
    ? (d.recent as Array<{
        caseNumber: string;
        status?: string;
        resolution?: string;
        subject?: string;
        lastModified?: string;
      }>)
    : [];
  const target = str(d.targetOrg);
  if (involved === 0 && owned === 0) {
    return {
      status: "info",
      icon: "📊",
      title: "Fin on Salesforce cases",
      meta: [target].filter(isString),
      lead: "Fin has not worked a case yet.",
      next: "Make sure Fin's Salesforce cases channel is live, then assign one test case to the Fin user.",
    };
  }
  const outcome = (state?: string) => OUTCOMES.find((o) => o.state === state);
  const known = new Set(OUTCOMES.map((o) => o.state));
  const extra = Object.keys(byResolution).filter((state) => !known.has(state));
  const caseRows: FinRow[] = recent.map((c) => {
    const o = outcome(c.resolution);
    return {
      icon: o ? "●" : "○",
      iconTone: o?.tone ?? "dim",
      value: [
        { text: c.caseNumber, tone: "info" },
        { text: `  ${localTime(c.lastModified) ?? ""}`.padEnd(16), tone: "muted" },
        { text: ` ${(c.status ?? "?").padEnd(8)}` },
        {
          text: ` ${(o?.short ?? (c.resolution ? c.resolution : "no Fin result")).padEnd(14)}`,
          tone: o?.tone ?? "muted",
        },
        ...(c.subject ? [{ text: ` ${c.subject}`, tone: "muted" as const }] : []),
      ],
    };
  });
  return {
    status: "success",
    icon: "📊",
    title: "Fin on Salesforce cases",
    meta: [target].filter(isString),
    lead: [
      ...(rate !== undefined
        ? [
            { text: `${Math.round(rate * 100)}%`, tone: "success" as const, bold: true },
            { text: " resolved    ", tone: "muted" as const },
          ]
        : []),
      { text: String(involved), bold: true },
      { text: ` case${involved === 1 ? "" : "s"} worked    `, tone: "muted" },
      { text: String(routed), bold: true },
      { text: " handed to a person    ", tone: "muted" },
      { text: String(owned), bold: true },
      { text: " assigned to Fin now", tone: "muted" },
    ],
    blocks: [
      {
        kind: "bars",
        title: "How Fin resolved them",
        icon: "📊",
        items: [
          ...OUTCOMES.map((o) => ({
            label: o.label,
            count: byResolution[o.state] ?? 0,
            total: Math.max(1, involved),
            tone: o.tone,
          })),
          ...extra.map((state) => ({
            label: state,
            count: byResolution[state] ?? 0,
            total: Math.max(1, involved),
          })),
        ],
      },
      ...(recent.length
        ? [{ kind: "rows" as const, title: "Latest cases", icon: "🗂️", rows: caseRows }]
        : []),
      {
        kind: "rows",
        title: "Fin's field values",
        icon: "🏷️",
        rows: Object.entries(byResolution).map(([state, n]) => ({
          label: String(n),
          value: [
            { text: state },
            { text: `  ${outcome(state)?.label ?? ""}`, tone: "muted" as const },
          ],
        })),
        expandedOnly: true,
      },
    ],
    next:
      owned > involved
        ? `${owned - involved} case${owned - involved === 1 ? "" : "s"} assigned to Fin ${owned - involved === 1 ? "has" : "have"} no Fin result. Fin only works cases assigned while its channel is live.`
        : undefined,
  };
}
