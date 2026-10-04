/* SPDX-License-Identifier: Apache-2.0 */
/** Pure accessibility-snapshot parsing for Salesforce Setup navigation. */

export interface SetupCategoryMatch {
  label: string;
  treeRef: string;
  expansionRef?: string;
  linkRef?: string;
  expanded?: boolean;
}

export interface SetupItemMatch {
  label: string;
  category?: string;
  treeRef: string;
  linkRef?: string;
  selected: boolean;
}

export interface SetupMenuEntryMatch {
  label: string;
  ref: string;
}

export function findSetupCategory(snapshot: string, label: string): SetupCategoryMatch | undefined {
  const expected = normalizeLabel(label);
  const lines = snapshot.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const item = parseTreeItem(line);
    if (!item || item.level !== 1 || normalizeLabel(item.label) !== expected) continue;
    const descendants = descendantsUntilPeer(lines, index, leadingSpaces(line));
    const expansion = descendants.find((entry) =>
      /^\s*- button "(?:Expand|Collapse)"/iu.test(entry),
    );
    const link = descendants.find((entry) => {
      const parsed = parseLink(entry);
      return parsed && normalizeLabel(parsed.label) === expected;
    });
    return {
      label: item.label,
      treeRef: item.ref,
      ...(expansion ? { expansionRef: extractRef(expansion) } : {}),
      ...(link ? { linkRef: extractRef(link) } : {}),
      ...(item.expanded === undefined ? {} : { expanded: item.expanded }),
    };
  }
  return undefined;
}

export function findSetupItemCandidates(
  snapshot: string,
  label: string,
  category?: string,
): SetupItemMatch[] {
  const expected = normalizeLabel(label);
  const expectedCategory = category ? normalizeLabel(category) : undefined;
  const lines = snapshot.split(/\r?\n/u);
  const out: SetupItemMatch[] = [];
  let currentCategory: string | undefined;
  let currentCategoryIndent = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const item = parseTreeItem(line);
    if (!item) continue;
    const indent = leadingSpaces(line);
    if (item.level === 1) {
      currentCategory = item.label;
      currentCategoryIndent = indent;
    } else if (indent <= currentCategoryIndent) {
      currentCategory = undefined;
      currentCategoryIndent = -1;
    }
    if (normalizeLabel(item.label) !== expected) continue;
    if (expectedCategory && normalizeLabel(currentCategory ?? "") !== expectedCategory) continue;
    const descendants = descendantsUntilPeer(lines, index, indent);
    const link = descendants.find((entry) => {
      const parsed = parseLink(entry);
      return parsed && normalizeLabel(parsed.label) === expected;
    });
    out.push({
      label: item.label,
      ...(item.level && item.level > 1 && currentCategory ? { category: currentCategory } : {}),
      treeRef: item.ref,
      ...(link ? { linkRef: extractRef(link) } : {}),
      selected: item.selected,
    });
  }
  return out;
}

export function findSetupMenuEntry(
  snapshot: string,
  label: string,
): SetupMenuEntryMatch | undefined {
  const expected = normalizeLabel(label);
  for (const line of snapshot.split(/\r?\n/u)) {
    const match = line.match(/^\s*- menuitem "([^"]+)".*\bref=(e\d+)/iu);
    if (!match) continue;
    const accessibleLabel = (match[1] ?? "").replace(/\s+Opens in a new tab\s*$/iu, "").trim();
    if (normalizeLabel(accessibleLabel) !== expected) continue;
    return { label: accessibleLabel, ref: match[2] ?? "" };
  }
  return undefined;
}

export function setupMenuEntryLabels(snapshot: string, limit = 10): string[] {
  const labels: string[] = [];
  for (const line of snapshot.split(/\r?\n/u)) {
    const match = line.match(/^\s*- menuitem "([^"]+)"/iu);
    if (!match) continue;
    const label = (match[1] ?? "").replace(/\s+Opens in a new tab\s*$/iu, "").trim();
    if (!label || labels.some((item) => normalizeLabel(item) === normalizeLabel(label))) continue;
    labels.push(label);
    if (labels.length >= Math.max(1, limit)) break;
  }
  return labels;
}

export function setupNavigationLabels(snapshot: string, limit = 10): string[] {
  const labels: string[] = [];
  for (const line of snapshot.split(/\r?\n/u)) {
    const item = parseTreeItem(line);
    if (!item || labels.some((label) => normalizeLabel(label) === normalizeLabel(item.label))) {
      continue;
    }
    labels.push(item.label);
    if (labels.length >= Math.max(1, limit)) break;
  }
  return labels;
}

export function findQuickFindRef(snapshot: string): string | undefined {
  const line = snapshot
    .split(/\r?\n/u)
    .find((candidate) => /^\s*- searchbox "Quick Find"/iu.test(candidate));
  return line ? extractRef(line) : undefined;
}

export function findGlobalSetupButton(snapshot: string): SetupCategoryMatch | undefined {
  for (const line of snapshot.split(/\r?\n/u)) {
    const match = line.match(/^\s*- button "Setup" \[([^\]]+)\]/iu);
    if (!match) continue;
    const expanded = match[1]?.match(/\bexpanded=(true|false)\b/iu)?.[1];
    const ref = extractRef(line);
    if (!ref || !expanded) continue;
    return {
      label: "Setup",
      treeRef: ref,
      expansionRef: ref,
      expanded: expanded === "true",
    };
  }
  return undefined;
}

function descendantsUntilPeer(lines: string[], index: number, parentIndent: number): string[] {
  const out: string[] = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? "";
    if (line.trim() && leadingSpaces(line) <= parentIndent) break;
    out.push(line);
  }
  return out;
}

function parseTreeItem(
  line: string,
):
  | { label: string; ref: string; level?: number; expanded?: boolean; selected: boolean }
  | undefined {
  const match = line.match(/^\s*- treeitem "([^"]+)"(?: \[([^\]]+)\])?/iu);
  if (!match) return undefined;
  const attributes = match[2] ?? "";
  const ref = extractRef(line);
  if (!ref) return undefined;
  const level = attributes.match(/\blevel=(\d+)\b/iu)?.[1];
  const expanded = attributes.match(/\bexpanded=(true|false)\b/iu)?.[1];
  return {
    label: match[1] ?? "",
    ref,
    ...(level ? { level: Number(level) } : {}),
    ...(expanded ? { expanded: expanded === "true" } : {}),
    selected: /\bselected\b/iu.test(attributes),
  };
}

function parseLink(line: string): { label: string; ref?: string } | undefined {
  const match = line.match(/^\s*- link "([^"]+)"/iu);
  return match ? { label: match[1] ?? "", ref: extractRef(line) } : undefined;
}

function extractRef(line: string): string | undefined {
  return line.match(/\bref=@?(e\d+)\b/iu)?.[1]?.toLowerCase();
}

function leadingSpaces(line: string): number {
  return line.match(/^\s*/u)?.[0].length ?? 0;
}

function normalizeLabel(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}
