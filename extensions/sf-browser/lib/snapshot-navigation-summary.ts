/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded global-chrome and Setup-tree sections for compact browser snapshots. */
import { truncateLine } from "@earendil-works/pi-coding-agent";

const MAX_LINE_BYTES = 260;
const MAX_NAV_LINES = 12;

export function collectGlobalNavigationSummary(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const button = line.match(/^- button "(App Launcher|Setup)" \[([^\]]+)\]/iu);
    if (button) {
      const expanded = button[2]?.match(/\bexpanded=(true|false)\b/iu)?.[1];
      out.push(
        [
          button[1],
          expanded === "true" ? "expanded" : expanded === "false" ? "collapsed" : undefined,
          extractRef(line),
        ]
          .filter(Boolean)
          .join(" · "),
      );
      continue;
    }
    if (/^- combobox "(?:Search Setup|Search apps and items\.\.\.)"/iu.test(line)) {
      out.push(formatLine(line));
      continue;
    }
    if (/^- menuitem /iu.test(line)) {
      out.push(formatLine(line));
      continue;
    }
    if (/^- option /iu.test(line) && out.length < MAX_NAV_LINES) {
      out.push(formatLine(line));
    }
    if (out.length >= MAX_NAV_LINES) break;
  }
  return unique(out).slice(0, MAX_NAV_LINES);
}

export function collectSetupNavigationSummary(lines: string[], focusTerms: string[]): string[] {
  const out: string[] = [];
  const quickFindLine = lines.find((line) => /^\s*- searchbox "Quick Find"/iu.test(line));
  const quickFindValue = quickFindLine?.match(/:\s*(.+)$/u)?.[1]?.trim();
  if (quickFindLine) {
    out.push(
      [
        `Quick Find${quickFindValue ? `: ${redactSnapshotText(quickFindValue)}` : ""}`,
        extractRef(quickFindLine),
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }

  const loweredFocus = focusTerms.map((term) => term.toLowerCase());
  const loweredQuickFind = quickFindValue?.toLowerCase();
  const selectedLines: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const tree = parseTreeItem(line);
    if (!tree) continue;
    if (tree.selected) selectedLines.push(formatLine(line.trim()));
    if (tree.level !== 1) continue;

    const descendants = setupTreeDescendants(lines, index, leadingSpaces(line));
    const matchesFocus = loweredFocus.some((term) => tree.label.toLowerCase().includes(term));
    const matchesQuickFind = Boolean(
      loweredQuickFind &&
      (tree.label.toLowerCase().includes(loweredQuickFind) ||
        descendants.some((child) => child.label.toLowerCase().includes(loweredQuickFind))),
    );
    if (!matchesFocus && !matchesQuickFind && !tree.selected) continue;

    const expansionControl = descendants.find((child) => child.kind === "expansion-control");
    const categoryLink = descendants.find(
      (child) =>
        child.kind === "link" && normalizeNavLabel(child.label) === normalizeNavLabel(tree.label),
    );
    out.push(
      [
        tree.label,
        tree.expanded === true ? "expanded" : tree.expanded === false ? "collapsed" : "section",
        tree.ref ? `tree ${tree.ref}` : undefined,
        expansionControl?.ref ? `expansion control ${expansionControl.ref}` : undefined,
        categoryLink?.ref ? `link ${categoryLink.ref}` : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
    );

    if (tree.expanded) {
      for (const child of descendants.filter((item) => item.kind === "treeitem")) {
        const childLink = descendants.find(
          (item) =>
            item.kind === "link" &&
            item.indent > child.indent &&
            normalizeNavLabel(item.label) === normalizeNavLabel(child.label),
        );
        out.push(
          [
            `Child: ${child.label}`,
            childLink?.ref ? `link ${childLink.ref}` : child.ref ? `tree ${child.ref}` : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
        );
        if (out.length >= MAX_NAV_LINES) break;
      }
    }
    if (out.length >= MAX_NAV_LINES) break;
  }

  for (const selected of selectedLines) {
    if (out.length >= MAX_NAV_LINES) break;
    out.push(selected);
  }
  return unique(out).slice(0, MAX_NAV_LINES);
}

type SetupTreeItem = {
  label: string;
  level?: number;
  expanded?: boolean;
  selected: boolean;
  ref?: string;
};

type SetupTreeDescendant = {
  kind: "treeitem" | "link" | "expansion-control";
  label: string;
  ref?: string;
  indent: number;
};

function parseTreeItem(line: string): SetupTreeItem | undefined {
  const match = line.match(/^\s*- treeitem "([^"]+)"(?: \[([^\]]+)\])?/iu);
  if (!match) return undefined;
  const attributes = match[2] ?? "";
  const level = attributes.match(/\blevel=(\d+)\b/iu)?.[1];
  const expanded = attributes.match(/\bexpanded=(true|false)\b/iu)?.[1];
  return {
    label: match[1] ?? "",
    ...(level ? { level: Number(level) } : {}),
    ...(expanded ? { expanded: expanded === "true" } : {}),
    selected: /\bselected\b/iu.test(attributes),
    ref: extractRef(line),
  };
}

function setupTreeDescendants(
  lines: string[],
  parentIndex: number,
  parentIndent: number,
): SetupTreeDescendant[] {
  const out: SetupTreeDescendant[] = [];
  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const indent = leadingSpaces(line);
    if (line.trim() && indent <= parentIndent) break;
    const tree = parseTreeItem(line);
    if (tree) {
      out.push({ kind: "treeitem", label: tree.label, ref: tree.ref, indent });
      continue;
    }
    const button = line.match(/^\s*- button "(Expand|Collapse)"/iu);
    if (button) {
      out.push({
        kind: "expansion-control",
        label: button[1] ?? "",
        ref: extractRef(line),
        indent,
      });
      continue;
    }
    const link = line.match(/^\s*- link "([^"]+)"/iu);
    if (link) {
      out.push({ kind: "link", label: link[1] ?? "", ref: extractRef(line), indent });
    }
  }
  return out;
}

function extractRef(line: string): string | undefined {
  return line.match(/\bref=(e\d+)\b/u)?.[1];
}

function leadingSpaces(line: string): number {
  return line.match(/^\s*/u)?.[0].length ?? 0;
}

function normalizeNavLabel(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

function formatLine(line: string): string {
  return truncateLine(redactSnapshotText(line).replace(/\s+/gu, " "), MAX_LINE_BYTES).text;
}

function redactSnapshotText(text: string): string {
  return text
    .replace(/\bWelcome,\s*[^,"]+/giu, "Welcome, <user>")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "<email>")
    .replace(/https?:\/\/[^\s"]+/giu, "<url>");
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
