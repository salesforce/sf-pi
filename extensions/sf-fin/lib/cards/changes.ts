/* SPDX-License-Identifier: Apache-2.0 */
/** Change cards: plans, verified results, refusals, and no-ops. */
import type { FinCard, FinRow } from "../fin-card.ts";
import {
  stripStatus,
  stepRow,
  plainNext,
  stateTone,
  stateGlyph,
  quoted,
  textLines,
  humanize,
  str,
  isString,
} from "./helpers.ts";
import type { CardInput } from "./helpers.ts";
import { checkRow } from "./salesforce.ts";
import type { Check } from "./salesforce.ts";

// ─── Plans and results ─────────────────────────────────────────────────────

/** Guardrail rule and reversibility per mutating operation. */
const MUTATIONS: Record<
  string,
  { rule: string; reversible: "reversible" | "one-way" | "org-wide"; undo: string }
> = {
  package_install: {
    rule: "native-sf-fin-salesforce-setup",
    reversible: "reversible",
    undo: "Uninstall the package in Setup.",
  },
  audit_fields_enable: {
    rule: "native-sf-fin-salesforce-setup",
    reversible: "org-wide",
    undo: "Turn the setting off in Setup. It applies to the whole org.",
  },
  digital_experiences_enable: {
    rule: "native-sf-fin-salesforce-setup",
    reversible: "one-way",
    undo: "Cannot be undone. Salesforce does not let Digital Experiences be turned off.",
  },
  enhanced_email_enable: {
    rule: "native-sf-fin-salesforce-setup",
    reversible: "org-wide",
    undo: "Turn Enhanced Email off in Setup. It applies to the whole org.",
  },
  handoff_queue_create: {
    rule: "native-sf-fin-salesforce-setup",
    reversible: "reversible",
    undo: "Delete the queue in Setup.",
  },
  token_transfer: {
    rule: "native-sf-fin-salesforce-setup",
    reversible: "reversible",
    undo: "Delete the token in Fin.",
  },
  permissions_apply: {
    rule: "native-sf-fin-salesforce-setup",
    reversible: "reversible",
    undo: "Remove the assignments and deactivate the Fin user in Setup.",
  },
  connect: {
    rule: "native-sf-fin-salesforce-setup",
    reversible: "reversible",
    undo: "Disconnect Fin in Fin's Salesforce settings.",
  },
  connector_state: {
    rule: "native-sf-fin-procedure-state",
    reversible: "reversible",
    undo: "Set the connector back to draft.",
  },
  simulations_delete: {
    rule: "native-sf-fin-procedure-state",
    reversible: "one-way",
    undo: "Cannot be undone. Upload the test again to recreate it.",
  },
  publish: {
    rule: "native-sf-fin-procedure-state",
    reversible: "reversible",
    undo: "Pause it again at any time.",
  },
  pause: {
    rule: "native-sf-fin-procedure-state",
    reversible: "reversible",
    undo: "Publish it again at any time. It cannot return to draft.",
  },
  guidance_state: {
    rule: "native-sf-fin-procedure-state",
    reversible: "reversible",
    undo: "Set it back at any time.",
  },
  install: {
    rule: "native-sf-fin-cli-install",
    reversible: "reversible",
    undo: "npm uninstall -g @intercom/cli.",
  },
};

const OP_TITLE: Record<string, string> = {
  package_install: "Install Fin for Salesforce",
  audit_fields_enable: "Turn on audit fields",
  digital_experiences_enable: "Turn on Digital Experiences",
  enhanced_email_enable: "Turn on Enhanced Email",
  handoff_queue_create: "Handoff queue",
  token_transfer: "Fin auth token",
  permissions_apply: "Fin user and permissions",
  connect: "Connect Fin",
  connector_state: "Data connector",
  simulations_delete: "Delete simulation",
  publish: "Publish",
  pause: "Pause",
  guidance_state: "Guidance",
  install: "Install the Fin CLI",
};

/** Slash commands that confirm before changing anything, so they are safe to suggest. */
function slashFor(op: string, d: Record<string, unknown>): string | undefined {
  const procedure = str(d.procedureId);
  if ((op === "publish" || op === "pause") && procedure) return `/sf-fin sdk ${op} ${procedure}`;
  if (op === "install") return "/sf-fin install";
  return undefined;
}

export function planCard(input: CardInput): FinCard {
  const d = input.details;
  const op = str(d.operation) ?? str(d.action) ?? "change";
  const meta = MUTATIONS[op];
  const reversible = d.oneWay === true ? "one-way" : meta?.reversible;
  const lines = textLines(input.text);
  const headline = (lines[0] ?? "").replace(/^Plan:\s*/u, "");
  const steps = lines
    .filter((l) => /^\s*[-•]\s/u.test(l))
    .map((l) => l.replace(/^\s*[-•]\s*/u, ""));
  const effect = lines.slice(1).find((l) => !/^\s*[-•]\s|^To (execute|proceed)|^⚠/u.test(l));
  const warning = lines.find((l) => /^⚠/u.test(l));
  const from = str(d.from);
  const to = str(d.to);
  const name = str(d.name) ?? quoted(headline);
  const slash = slashFor(op, d);
  const rows: FinRow[] = [];
  if (effect) rows.push({ icon: "💬", label: "What happens", value: effect });
  if (meta) {
    rows.push({
      icon: reversible === "one-way" ? "⚠" : reversible === "org-wide" ? "🌐" : "↩",
      iconTone:
        reversible === "one-way" ? "error" : reversible === "org-wide" ? "warning" : "success",
      label: reversible === "one-way" ? "One-way" : reversible === "org-wide" ? "Org-wide" : "Undo",
      value: meta.undo,
      tone: reversible === "one-way" ? "error" : undefined,
    });
    rows.push({
      icon: "🔒",
      label: "Approval",
      value: [{ text: "SF Guardrail asks you first  " }, { text: meta.rule, tone: "dim" }],
    });
  }
  return {
    status: input.ok ? "warning" : "error",
    icon: "🚀",
    title: `${OP_TITLE[op] ?? humanize(op)}${name && (op === "publish" || op === "pause") ? ` · ${name}` : ""}`,
    meta: [str(d.targetOrg), "plan · nothing changed yet"].filter(isString),
    lead: from && to ? undefined : headline,
    blocks: [
      ...(from && to
        ? [
            {
              kind: "flow" as const,
              steps: [
                { label: from, state: "now", tone: stateTone(from), glyph: stateGlyph(from) },
                { label: to, state: "after", tone: stateTone(to), glyph: stateGlyph(to) },
              ],
            },
          ]
        : []),
      ...(steps.length
        ? [
            {
              kind: "rows" as const,
              title: "What changes",
              icon: "🛠️",
              rows: steps.map((s, i) => ({ label: `${i + 1}.`, value: s })),
            },
          ]
        : []),
      ...(warning ? [{ kind: "text" as const, text: warning, tone: "warning" as const }] : []),
      ...(rows.length ? [{ kind: "rows" as const, rows }] : []),
    ],
    next: input.ok
      ? slash
        ? [
            { text: "To go ahead, ask the agent or run  " },
            { text: slash, tone: "info" },
            { text: "  · you approve first", tone: "muted" },
          ]
        : "To go ahead, ask the agent to apply it. You approve the change first."
      : undefined,
  };
}

export function executeCard(input: CardInput): FinCard {
  const d = input.details;
  const op = str(d.operation) ?? str(d.action) ?? "change";
  const lines = textLines(input.text);
  const checks = Array.isArray(d.checks) ? (d.checks as Check[]) : [];
  const open = checks.filter((c) => c.state !== "ok");
  const problems = Array.isArray(d.problems) ? (d.problems as string[]) : [];
  const steps = lines
    .slice(1)
    .filter((l) => /^\s*(✅|⚠️?|❌|⏳)/u.test(l))
    .map((l) => l.trim());
  const next = lines.find((l) => /^Next:/u.test(l))?.replace(/^Next:\s*/u, "");
  return {
    status: input.ok ? "success" : "error",
    icon: input.ok ? "✅" : "🛠️",
    title: `${OP_TITLE[op] ?? humanize(op)} · ${input.ok ? "done" : "not done"}`,
    meta: [str(d.targetOrg), input.ok ? "verified" : undefined].filter(isString),
    lead: stripStatus(lines[0] ?? ""),
    blocks: [
      ...(problems.length
        ? [
            {
              kind: "rows" as const,
              title: "Problems",
              icon: "✕",
              rows: problems.map((p) => ({ icon: "✕", iconTone: "error" as const, value: p })),
            },
          ]
        : []),
      ...(steps.length
        ? [
            {
              kind: "rows" as const,
              rows: steps.map((s) => stepRow(s)),
            },
          ]
        : []),
      ...(open.length
        ? [
            {
              kind: "rows" as const,
              title: "Still to do",
              icon: "⚠",
              note: `${open.length}`,
              rows: open.map((c) => checkRow(c)),
            },
          ]
        : []),
    ],
    next: next ? plainNext(next) : undefined,
  };
}

/** A change SF Fin would not make: why, and the plain next step when it names one. */
export function refusedCard(input: CardInput): FinCard {
  const d = input.details;
  const op = str(d.operation) ?? str(d.action) ?? "change";
  const lines = textLines(input.text);
  return {
    status: "error",
    icon: "🛑",
    title: `${OP_TITLE[op] ?? humanize(op)} · not done`,
    meta: [str(d.targetOrg), "nothing changed"].filter(isString),
    lead: stripStatus(lines[0] ?? ""),
    blocks:
      lines.length > 1
        ? [{ kind: "text", text: [{ text: lines.slice(1).join("  "), tone: "muted" }] }]
        : [],
  };
}

export function noopCard(input: CardInput): FinCard {
  const d = input.details;
  const op = str(d.operation) ?? str(d.action) ?? "change";
  return {
    status: "success",
    icon: "✅",
    title: `Already done · ${OP_TITLE[op] ?? humanize(op)}`,
    meta: [str(d.targetOrg)].filter(isString),
    lead: [{ text: stripStatus(textLines(input.text)[0] ?? ""), tone: "muted" }],
  };
}
