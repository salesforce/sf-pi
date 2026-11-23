/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SF Fin flat Result Card: the shape and its terminal renderer.
 *
 * A Fin card sits directly on Pi's tool tile, like the Apex, SOQL, and Flow
 * cards: one status headline, an optional lead sentence, then small blocks.
 * Long values wrap under their own column, so nothing is cut off with "…".
 * The collapsed view shows what needs the person; `expandedOnly` blocks add
 * the full detail behind ctrl+o.
 *
 * Cards hold plain text only. Colors come from tones at render time, so the
 * same card renders in any Pi theme. The model never sees this card; it gets
 * the operation's own text (see cards.ts `modelPacket`).
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type FinCardStatus = "success" | "warning" | "error" | "info";
export type FinTone = "success" | "warning" | "error" | "info" | "muted" | "dim" | "text";

/** A run of text with one tone; a line is a list of spans. */
export interface FinSpan {
  text: string;
  tone?: FinTone;
  bold?: boolean;
}

export type FinText = string | FinSpan[];

export interface FinRow {
  /** One glyph or emoji; kept in a fixed two-column slot. */
  icon?: string;
  iconTone?: FinTone;
  label?: string;
  value: FinText;
  tone?: FinTone;
}

export type FinBlock =
  | { kind: "text"; text: FinText; tone?: FinTone; expandedOnly?: boolean }
  | {
      kind: "rows";
      title?: string;
      icon?: string;
      /** Quiet text beside the title, such as "3/4". */
      note?: string;
      rows: FinRow[];
      expandedOnly?: boolean;
    }
  | {
      kind: "meter";
      done: number;
      total: number;
      label: string;
      /** Tone of the part not done (open checks amber, failed tests red). */
      restTone?: FinTone;
    }
  | {
      kind: "bars";
      title?: string;
      icon?: string;
      items: Array<{ label: string; count: number; total: number; tone?: FinTone }>;
    }
  | { kind: "stages"; stages: Array<{ label: string; state: "ok" | "open" | "none" }> }
  | {
      kind: "flow";
      steps: Array<{ label: string; state: string; tone?: FinTone; glyph?: string }>;
    }
  | {
      kind: "chat";
      turns: Array<{ who: "you" | "fin"; text: string }>;
      notes?: string[];
    }
  | { kind: "grid"; cells: Array<{ ok: boolean | undefined; text: string }> };

export interface FinCard {
  status: FinCardStatus;
  /** Domain icon beside the title (the status glyph is separate). */
  icon: string;
  title: string;
  /** Quiet facts after the title, such as the org or "plan · nothing changed yet". */
  meta?: string[];
  /** The answer, in one or two sentences. */
  lead?: FinText;
  blocks?: FinBlock[];
  /** One plain next step. */
  next?: FinText;
  /** Quiet line under the next step. */
  hint?: string;
}

const STATUS: Record<FinCardStatus, { glyph: string; tone: FinTone }> = {
  success: { glyph: "✓", tone: "success" },
  warning: { glyph: "⚠", tone: "warning" },
  error: { glyph: "✕", tone: "error" },
  info: { glyph: "ⓘ", tone: "info" },
};

const STATE_GLYPH = { ok: "✓", open: "⚠", none: "○" } as const;
const STATE_TONE: Record<"ok" | "open" | "none", FinTone> = {
  ok: "success",
  open: "warning",
  none: "dim",
};

const INDENT = "  ";

export function renderFinCard(card: FinCard, expanded: boolean, theme: Theme): Component {
  return {
    render: (width: number) =>
      fit(["", ...buildLines(card, expanded, theme, Math.max(20, width))], width),
    invalidate: () => {},
  };
}

/** The plain-text lines of a card (tests and the HTML gallery use this). */
export function finCardLines(
  card: FinCard,
  expanded: boolean,
  theme: Theme,
  width: number,
): string[] {
  return fit(buildLines(card, expanded, theme, Math.max(20, width)), width);
}

function buildLines(card: FinCard, expanded: boolean, theme: Theme, width: number): string[] {
  const t = toner(theme);
  const lines: string[] = [];
  const status = STATUS[card.status];
  const meta = (card.meta ?? []).filter(Boolean);
  lines.push(
    ...wrap(
      `${t(status.tone, status.glyph, true)} ${card.icon} ${t("text", card.title, true)}${
        meta.length ? t("muted", ` · ${meta.join(" · ")}`) : ""
      }`,
      width,
      "    ",
    ),
  );
  if (card.lead) {
    lines.push("");
    lines.push(...wrap(INDENT + spans(card.lead, theme), width, INDENT));
  }
  for (const block of card.blocks ?? []) {
    if ("expandedOnly" in block && block.expandedOnly && !expanded) continue;
    const rendered = renderBlock(block, theme, width);
    if (!rendered.length) continue;
    const headed =
      block.kind === "rows" || block.kind === "bars" ? Boolean(block.title) : block.kind !== "text";
    // Rows that follow another block directly stay grouped; titled blocks get a gap.
    if (headed || lines.length === 1 || !lastWasBlock(lines)) lines.push("");
    lines.push(...rendered);
  }
  if (card.next) {
    lines.push("");
    lines.push(...wrap(`${t("info", "→", true)} ${spans(card.next, theme)}`, width, INDENT));
  }
  if (card.hint) {
    if (!card.next) lines.push("");
    lines.push(...wrap(INDENT + t("muted", card.hint), width, INDENT));
  }
  return lines;
}

function lastWasBlock(lines: string[]): boolean {
  return lines.length > 0 && lines[lines.length - 1] === "";
}

function renderBlock(block: FinBlock, theme: Theme, width: number): string[] {
  const t = toner(theme);
  switch (block.kind) {
    case "text":
      return wrap(INDENT + spans(block.text, theme, block.tone), width, INDENT);
    case "rows": {
      const out: string[] = [];
      if (block.title) out.push(sectionTitle(block.title, block.icon, block.note, theme));
      const labelWidth = Math.min(
        18,
        Math.max(0, ...block.rows.map((r) => (r.label ? visibleWidth(r.label) : 0))),
      );
      const hasIcons = block.rows.some((r) => r.icon);
      for (const row of block.rows) {
        const icon = hasIcons
          ? `${slot(row.icon ? t(row.iconTone ?? "text", row.icon) : "")} `
          : "";
        const label = labelWidth ? `${t("muted", padTo(row.label ?? "", labelWidth))}  ` : "";
        const prefix = `${INDENT}${icon}${label}`;
        out.push(...hanging(prefix, spans(row.value, theme, row.tone), width));
      }
      return out;
    }
    case "meter": {
      const barWidth = Math.max(6, Math.min(18, width - visibleWidth(block.label) - 6));
      return wrap(
        `${INDENT}${meter(block.done, block.total, barWidth, theme, "success", block.restTone)}  ${t("muted", block.label)}`,
        width,
        INDENT,
      );
    }
    case "bars": {
      const out: string[] = [];
      if (block.title) out.push(sectionTitle(block.title, block.icon, undefined, theme));
      const labelWidth = Math.min(26, Math.max(...block.items.map((i) => visibleWidth(i.label))));
      const barWidth = Math.max(4, Math.min(10, width - labelWidth - 12));
      for (const item of block.items) {
        const on = item.count > 0;
        out.push(
          `${INDENT}${t(on ? (item.tone ?? "success") : "dim", on ? "●" : "○")} ${padTo(
            item.label,
            labelWidth,
          )} ${meter(item.count, item.total, barWidth, theme, item.tone)}  ${t(on ? "text" : "muted", String(item.count))}`,
        );
      }
      return out;
    }
    case "stages": {
      // Break between stages, never inside one.
      const parts = block.stages.map(
        (s) => `${t(STATE_TONE[s.state], STATE_GLYPH[s.state])} ${s.label}`,
      );
      const sep = t("dim", "  ›  ");
      const out: string[] = [];
      let line = INDENT;
      for (const part of parts) {
        const candidate = line === INDENT ? line + part : line + sep + part;
        if (line !== INDENT && visibleWidth(candidate) > width) {
          out.push(line);
          line = INDENT + part;
        } else line = candidate;
      }
      out.push(line);
      return out;
    }
    case "flow": {
      const arrow = t("dim", " ──→ ");
      const heads = block.steps.map((s) => `${t(s.tone ?? "text", s.glyph ?? "●")} ${s.label}`);
      // Each state sits under its step's label (after the glyph and its space).
      const lead = (i: number) => visibleWidth(block.steps[i]?.glyph ?? "●") + 1;
      const columns = block.steps.map((s, i) =>
        Math.max(visibleWidth(heads[i] ?? ""), lead(i) + visibleWidth(s.state)),
      );
      const total =
        visibleWidth(INDENT) + columns.reduce((a, c) => a + c, 0) + 5 * (columns.length - 1);
      if (total <= width) {
        const top = INDENT + heads.map((h, i) => padTo(h, columns[i] ?? 0)).join(arrow);
        const bottom =
          INDENT +
          block.steps
            .map((s, i) => padTo(`${" ".repeat(lead(i))}${t("muted", s.state)}`, columns[i] ?? 0))
            .join("     ");
        return [top.trimEnd(), bottom.trimEnd()];
      }
      // Too narrow: one step per line.
      return block.steps.flatMap((s, i) =>
        hanging(
          `${INDENT}${i === 0 ? "  " : t("dim", "→ ")}`,
          `${heads[i] ?? ""}  ${t("muted", s.state)}`,
          width,
        ),
      );
    }
    case "chat": {
      const out: string[] = [];
      for (const turn of block.turns) {
        const who = turn.who === "you" ? t("muted", "You") : t("info", "Fin", true);
        out.push(...hanging(`${INDENT}${who}  ${t("dim", "│")} `, turn.text, width));
      }
      for (const note of block.notes ?? []) {
        out.push(...hanging(`${INDENT}       ${t("dim", "└")} `, t("muted", note), width));
      }
      return out;
    }
    case "grid": {
      const cells = block.cells.map(
        (c) =>
          `${t(c.ok === false ? "error" : c.ok ? "success" : "warning", c.ok === false ? "✕" : c.ok ? "✓" : "⚠")} ${c.text}`,
      );
      const cellWidth = Math.max(...cells.map((c) => visibleWidth(c))) + 3;
      const perLine = Math.max(1, Math.min(3, Math.floor((width - INDENT.length) / cellWidth)));
      const out: string[] = [];
      for (let i = 0; i < cells.length; i += perLine) {
        const chunk = cells.slice(i, i + perLine);
        out.push(
          INDENT + chunk.map((c, j) => (j === chunk.length - 1 ? c : padTo(c, cellWidth))).join(""),
        );
      }
      return out.flatMap((line) => wrap(line, width, INDENT));
    }
  }
}

function sectionTitle(
  title: string,
  icon: string | undefined,
  note: string | undefined,
  theme: Theme,
): string {
  const t = toner(theme);
  return `${t("info", `${icon ? `${icon} ` : ""}${title}`, true)}${note ? `  ${t("muted", note)}` : ""}`;
}

/** Done cells in `tone`; the rest dim, or in `restTone` when the rest is a problem. */
function meter(
  done: number,
  total: number,
  width: number,
  theme: Theme,
  tone: FinTone = "success",
  restTone?: FinTone,
): string {
  const t = toner(theme);
  const ratio = total > 0 ? done / total : 0;
  // Never round a partial result up to full or a non-zero one down to empty.
  let filled = Math.round(ratio * width);
  if (done > 0 && filled === 0) filled = 1;
  if (done < total && filled === width) filled = width - 1;
  const capped = Math.max(0, Math.min(width, filled));
  const rest = width - capped;
  return (
    t(tone, "█".repeat(capped)) +
    (restTone ? t(restTone, "█".repeat(rest)) : t("dim", "░".repeat(rest)))
  );
}

/** A fixed two-column icon slot, so text after any icon lines up. */
function slot(icon: string): string {
  const w = visibleWidth(icon);
  return w >= 2 ? icon : `${icon}${" ".repeat(2 - w)}`;
}

function padTo(text: string, width: number): string {
  const w = visibleWidth(text);
  return w >= width ? text : text + " ".repeat(width - w);
}

/** Wrap `value` after `prefix`; continuation lines indent to the value column. */
function hanging(prefix: string, value: string, width: number): string[] {
  const prefixWidth = visibleWidth(prefix);
  if (prefixWidth > width - 12) return wrap(prefix + value, width, INDENT + "  ");
  const wrapped = wrapTextWithAnsi(value, Math.max(8, width - prefixWidth));
  const indent = " ".repeat(prefixWidth);
  return wrapped.map((line, i) => (i === 0 ? prefix + line : indent + line));
}

/** Wrap a whole line; continuation lines start with `indent`. */
function wrap(line: string, width: number, indent: string): string[] {
  if (visibleWidth(line) <= width) return [line];
  const first = wrapTextWithAnsi(line, width);
  const head = first[0] ?? "";
  const rest = first.slice(1).join(" ");
  if (!rest) return [head];
  const tail = wrapTextWithAnsi(rest.trimStart(), Math.max(8, width - visibleWidth(indent)));
  return [head, ...tail.map((l) => indent + l)];
}

/** Pad every line to the tile width (Pi's tile paints the background). */
function fit(lines: string[], width: number): string[] {
  return lines.flatMap((line) => {
    const pieces = visibleWidth(line) > width ? wrapTextWithAnsi(line, width) : [line];
    return pieces.map((p) => padTo(p, width));
  });
}

function spans(text: FinText, theme: Theme, fallback: FinTone = "text"): string {
  const t = toner(theme);
  if (typeof text === "string") return t(fallback, text);
  return text.map((s) => t(s.tone ?? fallback, s.text, s.bold)).join("");
}

function toner(theme: Theme) {
  return (tone: FinTone, text: string, bold = false): string => {
    if (!text) return "";
    const styled = bold ? theme.bold(text) : text;
    if (tone === "text") return styled;
    const color: ThemeColor = tone === "info" ? "accent" : tone;
    return theme.fg(color, styled);
  };
}

export function isFinCard(value: unknown): value is FinCard {
  if (!value || typeof value !== "object") return false;
  const card = value as Partial<FinCard>;
  return (
    typeof card.title === "string" &&
    typeof card.icon === "string" &&
    (card.status === "success" ||
      card.status === "warning" ||
      card.status === "error" ||
      card.status === "info")
  );
}
