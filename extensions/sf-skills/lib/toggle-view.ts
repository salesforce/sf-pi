/* SPDX-License-Identifier: Apache-2.0 */
/** Invocation toggle overlay — split list + preview inside the SF Pi bordered pane. */
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  type Focusable,
  matchesKey,
  Text,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { fitColumns, renderColumns, type ColumnSpec } from "./funnel-view/layout.ts";
import { modeForToggleSkill, packLabelFor, type ToggleSkill } from "./invocation/inventory.ts";
import {
  SKILL_PACKS,
  type SkillInvocationMode,
  type SkillInvocationPolicy,
} from "./invocation/types.ts";
import {
  TOGGLE_BODY_LINES,
  TOGGLE_CHROME,
  TOGGLE_INVOCATION_HEADER,
  TOGGLE_INVOCATION_MIN,
  TOGGLE_ORIGIN_HEADER,
  TOGGLE_ORIGIN_MIN,
  buildPreviewLines,
  splitTogglePane,
  type TogglePreviewSelection,
} from "./toggle-layout.ts";

export interface ToggleViewResult {
  action: "apply" | "cancel";
  policy: SkillInvocationPolicy;
}

export interface ToggleRow {
  kind: "pack" | "skill";
  id: string;
  name: string;
  origin: "Salesforce" | "Community";
  packId: string;
  packLabel: string;
  count?: number;
  mode: SkillInvocationMode | "mixed";
  locked: boolean;
  expanded?: boolean;
  description?: string;
  filePath?: string;
}

const COLUMNS: ColumnSpec[] = [
  { key: "cur", header: "", min: 1 },
  { key: "icon", header: "", min: 2 },
  { key: "name", header: "Name", min: 16, weight: 1 },
  { key: "origin", header: TOGGLE_ORIGIN_HEADER, min: TOGGLE_ORIGIN_MIN },
  { key: "count", header: "#", min: 3, align: "right" },
  { key: "state", header: TOGGLE_INVOCATION_HEADER, min: TOGGLE_INVOCATION_MIN },
];

const LAYOUT = { gap: 1, leftPad: 0, rightPad: 0 } as const;

const PACK_ICONS: Record<string, string> = {
  platform: "⚙",
  dx: "🚀",
  experience: "🖥",
  "ui-bundle": "📦",
  "design-systems": "🎨",
  agentforce: "✦",
  data360: "◉",
  omnistudio: "📑",
  automation: "⚡",
  integration: "🔌",
  commerce: "🛍",
  mobile: "📱",
  service: "🎧",
  sales: "💼",
  other: "•",
  community: "🧩",
};

export function buildToggleRows(
  skills: readonly ToggleSkill[],
  policy: SkillInvocationPolicy,
  expanded: ReadonlySet<string>,
  query: string,
): ToggleRow[] {
  const needle = query.trim().toLowerCase();
  if (needle) {
    return skills
      .filter((skill) =>
        `${skill.name} ${skill.description} ${skill.origin} ${skill.packLabel}`
          .toLowerCase()
          .includes(needle),
      )
      .map((skill) => skillRow(skill, policy));
  }

  const rows: ToggleRow[] = [];
  for (const pack of visiblePacks(skills)) {
    const members = skills.filter((skill) => skill.packId === pack.id);
    if (members.length === 0) continue;
    const modes = new Set(members.map((skill) => modeForToggleSkill(skill, policy)));
    const origin = pack.id === "community" ? "Community" : "Salesforce";
    rows.push({
      kind: "pack",
      id: pack.id,
      name: pack.label,
      origin,
      packId: pack.id,
      packLabel: pack.label,
      count: members.length,
      mode: singleMode(modes),
      locked: members.every((skill) => skill.authorDisabled || !skill.writable),
      expanded: expanded.has(pack.id),
    });
    if (!expanded.has(pack.id)) continue;
    for (const skill of members) rows.push(skillRow(skill, policy));
  }
  return rows;
}

export class SkillToggleViewComponent implements Focusable {
  focused = true;
  private search = "";
  private cursor = 0;
  private policy: SkillInvocationPolicy;
  private expanded = new Set<string>();

  constructor(
    private readonly theme: Theme,
    private readonly skills: ToggleSkill[],
    initial: SkillInvocationPolicy,
    private readonly done: (result: ToggleViewResult) => void,
  ) {
    this.policy = {
      default: initial.default,
      packs: { ...initial.packs },
      skills: { ...initial.skills },
    };
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done({ action: "cancel", policy: this.policy });
      return;
    }
    if (matchesKey(data, "ctrl+s")) {
      this.done({ action: "apply", policy: this.policy });
      return;
    }
    if (matchesKey(data, "up")) {
      this.cursor = Math.max(0, this.cursor - 1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.cursor = Math.min(Math.max(0, this.rows().length - 1), this.cursor + 1);
      return;
    }
    if (matchesKey(data, "left")) {
      this.setExpanded(false);
      return;
    }
    if (matchesKey(data, "right")) {
      this.setExpanded(true);
      return;
    }
    if (matchesKey(data, "space")) {
      this.toggleSelected();
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.search = [...this.search].slice(0, -1).join("");
      this.cursor = 0;
      return;
    }
    if (data.length === 1 && data >= " " && data !== "\u007f") {
      this.search += data;
      this.cursor = 0;
    }
  }

  render(width: number): string[] {
    const t = this.theme;
    const inner = Math.max(70, width - TOGGLE_CHROME);
    const pane = splitTogglePane(inner);
    const rows = this.rows();
    const selected = rows[this.cursor];
    const start = Math.max(
      0,
      Math.min(
        this.cursor - Math.floor(TOGGLE_BODY_LINES / 2),
        Math.max(0, rows.length - TOGGLE_BODY_LINES),
      ),
    );
    const slice = rows.slice(start, start + TOGGLE_BODY_LINES);
    const widths = fitColumns(pane.left, COLUMNS, LAYOUT);
    const agentCount = this.skills.filter(
      (skill) => modeForToggleSkill(skill, this.policy) === "agent-invocable",
    ).length;
    const salesforce = this.skills.filter((skill) => skill.origin === "salesforce").length;
    const community = this.skills.length - salesforce;
    const approx = Math.ceil(
      this.skills
        .filter((skill) => modeForToggleSkill(skill, this.policy) === "agent-invocable")
        .reduce((sum, skill) => sum + skill.description.length, 0) / 4,
    );

    const header = [
      t.fg("accent", t.bold("SF Skills Toggle")) +
        t.fg("dim", `   ${agentCount}/${this.skills.length} on  ·  ~${approx} tok`),
      t.fg(
        "muted",
        `Search: ${this.search || "(type to filter)"}   SF ${salesforce}  ·  Community ${community}`,
      ),
      "",
    ];

    const tableHeader = t.fg(
      "toolTitle",
      renderColumns(
        COLUMNS.map((col) => ({ text: col.header, align: col.align })),
        widths,
        LAYOUT,
      ),
    );
    const leftBody = [tableHeader];
    if (slice.length === 0) leftBody.push(t.fg("dim", "No skills found."));
    for (const row of slice) leftBody.push(this.renderListRow(row, row === selected, widths));
    while (leftBody.length < TOGGLE_BODY_LINES + 1) leftBody.push("");

    const preview = [
      t.fg("toolTitle", t.bold("Preview")),
      ...buildPreviewLines({
        width: pane.right,
        row: selected ? toPreviewSelection(selected) : undefined,
        members: selected?.kind === "pack" ? this.previewMembers(selected.id) : [],
      }).map((line, index) => this.colorPreviewLine(line, index, selected)),
    ];

    const divider = t.fg("borderMuted", "│");
    const combined: string[] = [];
    for (let i = 0; i < TOGGLE_BODY_LINES + 1; i++) {
      const left = fitPane(leftBody[i] ?? "", pane.left);
      const right = fitPane(preview[i] ?? "", pane.right);
      combined.push(`${left} ${divider} ${right}`);
    }

    const footer = ["", formatHints(t)];

    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => t.fg("borderAccent", s)));
    for (const line of [...header, ...combined, ...footer]) {
      container.addChild(new Text(line, 1, 0));
    }
    container.addChild(new DynamicBorder((s: string) => t.fg("borderAccent", s)));
    // Pi 1.6+ returns a read-only array it may cache and reuse; copy it.
    return [...container.render(width)];
  }

  invalidate(): void {}

  private rows(): ToggleRow[] {
    return buildToggleRows(this.skills, this.policy, this.expanded, this.search);
  }

  private renderListRow(row: ToggleRow, active: boolean, widths: number[]): string {
    const t = this.theme;
    const marker = active ? t.fg("accent", "→") : " ";
    const icon = row.kind === "pack" ? packIcon(row.packId) : " ";
    const fold = row.kind === "pack" ? (row.expanded ? "▾" : "▸") : " ";
    const label = row.kind === "pack" ? `${fold} ${t.bold(row.name)}` : `  ${row.name}`;
    const name = row.kind === "pack" ? t.fg("toolTitle", t.bold(label)) : t.fg("text", label);
    const origin = t.fg("dim", row.origin);
    const count = row.kind === "pack" ? t.fg("muted", String(row.count ?? "")) : "";
    const state = this.invocationLabel(row);
    return renderColumns(
      [
        { text: marker },
        { text: icon },
        { text: name },
        { text: origin },
        { text: count, align: "right" },
        { text: state },
      ],
      widths,
      LAYOUT,
    );
  }

  private invocationLabel(row: ToggleRow): string {
    const t = this.theme;
    if (row.locked) return t.fg("muted", "■ locked");
    if (row.mode === "agent-invocable") return t.fg("success", "✓ agent-invocable");
    if (row.mode === "mixed") return t.fg("warning", "◐ mixed");
    return t.fg("muted", "○ manual-only");
  }

  private colorPreviewLine(line: string, index: number, selected?: ToggleRow): string {
    const t = this.theme;
    if (!selected || !line) return line;
    if (index === 0) return t.fg("accent", t.bold(line));
    if (index === 2) {
      if (selected.locked) return t.fg("muted", line);
      if (selected.mode === "agent-invocable") return t.fg("success", line);
      if (selected.mode === "mixed") return t.fg("warning", line);
      return t.fg("dim", line);
    }
    if (line === "When to load" || line === "Pack" || line === "Members" || line === "Path") {
      return t.fg("toolTitle", t.bold(line));
    }
    return t.fg("text", line);
  }

  private previewMembers(packId: string) {
    return this.skills
      .filter((skill) => skill.packId === packId)
      .map((skill) => ({
        name: skill.name,
        on: modeForToggleSkill(skill, this.policy) === "agent-invocable",
        locked: skill.authorDisabled || !skill.writable,
      }));
  }

  private setExpanded(open: boolean): void {
    const row = this.rows()[this.cursor];
    if (!row) return;
    const packId = row.kind === "pack" ? row.id : row.packId;
    if (!packId) return;
    if (open) this.expanded.add(packId);
    else this.expanded.delete(packId);
    this.cursor = Math.max(
      0,
      this.rows().findIndex((candidate) => candidate.kind === "pack" && candidate.id === packId),
    );
  }

  private toggleSelected(): void {
    const row = this.rows()[this.cursor];
    if (!row || row.locked) return;
    const next: SkillInvocationMode =
      row.mode === "agent-invocable" ? "manual-only" : "agent-invocable";
    if (row.kind === "pack") {
      const skills = { ...this.policy.skills };
      const members = this.skills.filter((skill) => skill.packId === row.id);
      for (const skill of members) delete skills[skill.name];
      if (row.id === "community") {
        const nextSkills = { ...skills };
        for (const skill of members) nextSkills[skill.name] = next;
        this.policy = { ...this.policy, skills: nextSkills };
        return;
      }
      this.policy = {
        ...this.policy,
        packs: { ...this.policy.packs, [row.id]: next },
        skills,
      };
      return;
    }
    this.policy = {
      ...this.policy,
      skills: { ...this.policy.skills, [row.id]: next },
    };
  }
}

function skillRow(skill: ToggleSkill, policy: SkillInvocationPolicy): ToggleRow {
  return {
    kind: "skill",
    id: skill.name,
    name: skill.name,
    origin: skill.origin === "salesforce" ? "Salesforce" : "Community",
    packId: skill.packId,
    packLabel: skill.packLabel,
    mode: modeForToggleSkill(skill, policy),
    locked: skill.authorDisabled || !skill.writable,
    description: skill.description,
    filePath: skill.filePath,
  };
}

function visiblePacks(skills: readonly ToggleSkill[]): Array<{ id: string; label: string }> {
  const packs = SKILL_PACKS.filter((pack) => skills.some((skill) => skill.packId === pack.id)).map(
    (pack) => ({
      id: pack.id,
      label: pack.label,
    }),
  );
  if (skills.some((skill) => skill.packId === "community")) {
    packs.push({ id: "community", label: packLabelFor("community") });
  }
  return packs;
}

function packIcon(packId: string): string {
  return PACK_ICONS[packId] ?? "•";
}

function singleMode(modes: Set<SkillInvocationMode>): SkillInvocationMode | "mixed" {
  if (modes.size !== 1) return "mixed";
  for (const mode of modes) return mode;
  return "mixed";
}

function formatHints(theme: Theme): string {
  const key = (value: string) => theme.fg("accent", theme.bold(value));
  const label = (value: string) => theme.fg("dim", value);
  const sep = theme.fg("borderMuted", " · ");
  return [
    `${key("↑↓")} ${label("move")}`,
    `${key("←→")} ${label("fold pack")}`,
    `${key("space")} ${label("toggle")}`,
    `${key("ctrl+s")} ${label("apply")}`,
    `${key("esc")} ${label("cancel")}`,
  ].join(sep);
}

function fitPane(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "…");
  const pad = Math.max(0, width - visibleWidth(clipped));
  return clipped + " ".repeat(pad);
}

function toPreviewSelection(row: ToggleRow): TogglePreviewSelection {
  return {
    kind: row.kind,
    id: row.id,
    packLabel: row.packLabel,
    origin: row.origin,
    mode: row.mode,
    locked: row.locked,
    description: row.description,
    filePath: row.filePath,
  };
}
