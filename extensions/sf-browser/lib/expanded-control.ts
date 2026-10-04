/* SPDX-License-Identifier: Apache-2.0 */
/** Parsing helpers for idempotent Salesforce disclosure controls. */

export interface SnapshotExpansionControl {
  targetRef: string;
  controlRef: string;
  label: string;
  role: string;
  expanded: boolean;
  disabled: boolean;
  line: string;
}

export function expansionStateFromSnapshotLine(line: string): boolean | undefined {
  const match = line.match(/\bexpanded=(true|false)\b/iu);
  return match?.[1] === "true" ? true : match?.[1] === "false" ? false : undefined;
}

export function findExpansionControlInSnapshot(
  snapshot: string,
  targetRef: string,
): SnapshotExpansionControl | undefined {
  const normalizedTarget = normalizeRef(targetRef);
  if (!normalizedTarget) return undefined;
  const lines = snapshot.split(/\r?\n/u);
  const targetIndex = lines.findIndex((line) => extractRef(line) === normalizedTarget);
  if (targetIndex < 0) return undefined;

  const targetLine = lines[targetIndex] ?? "";
  const expanded = expansionStateFromSnapshotLine(targetLine);
  if (expanded === undefined) return undefined;
  const role = extractRole(targetLine);
  const label = extractLabel(targetLine);
  if (!role || !label) return undefined;

  let controlRef = normalizedTarget;
  if (role.toLowerCase() === "treeitem") {
    const targetIndent = leadingSpaces(targetLine);
    controlRef = "";
    for (let index = targetIndex + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line.trim() && leadingSpaces(line) <= targetIndent) break;
      if (!/^\s*- button "(?:Expand|Collapse)"/iu.test(line)) continue;
      controlRef = extractRef(line) ?? "";
      if (controlRef) break;
    }
    if (!controlRef) return undefined;
  }

  return {
    targetRef: normalizedTarget,
    controlRef,
    label,
    role,
    expanded,
    disabled: /\bdisabled\b/iu.test(targetLine),
    line: targetLine.trim(),
  };
}

export function findExpansionControlByLabel(
  snapshot: string,
  label: string,
  role?: string,
): SnapshotExpansionControl | undefined {
  const normalizedLabel = normalizeLabel(label);
  for (const line of snapshot.split(/\r?\n/u)) {
    const ref = extractRef(line);
    if (!ref || expansionStateFromSnapshotLine(line) === undefined) continue;
    if (normalizeLabel(extractLabel(line) ?? "") !== normalizedLabel) continue;
    if (role && extractRole(line)?.toLowerCase() !== role.toLowerCase()) continue;
    const found = findExpansionControlInSnapshot(snapshot, ref);
    if (found) return found;
  }
  return undefined;
}

function extractRef(line: string): string | undefined {
  return normalizeRef(line.match(/\bref=(@?e\d+)\b/iu)?.[1]);
}

function extractRole(line: string): string | undefined {
  return line.match(/^\s*- ([A-Za-z][\w-]*)\b/u)?.[1];
}

function extractLabel(line: string): string | undefined {
  return line.match(/"([^"]+)"/u)?.[1];
}

function leadingSpaces(line: string): number {
  return line.match(/^\s*/u)?.[0].length ?? 0;
}

function normalizeRef(ref: string | undefined): string | undefined {
  const match = ref?.trim().match(/^@?(e\d+)$/iu);
  return match?.[1].toLowerCase();
}

function normalizeLabel(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}
