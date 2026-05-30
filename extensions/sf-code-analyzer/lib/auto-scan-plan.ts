/* SPDX-License-Identifier: Apache-2.0 */
/** Pure planning for deferred Code Analyzer auto-scans. */
import { classifyCodeAnalyzerTarget, isProductionApexFile } from "./file-classify.ts";

export interface AutoScanGroup {
  selector: string;
  targets: string[];
}

export interface AutoScanPlan {
  groups: AutoScanGroup[];
  apexGuruCandidates: string[];
  skipped: string[];
}

export function planAutoScanGroups(files: string[]): AutoScanPlan {
  const unique = [...new Set(files)].sort();
  const groups = new Map<string, string[]>();
  const apexGuruCandidates: string[] = [];
  const skipped: string[] = [];

  for (const file of unique) {
    const target = classifyCodeAnalyzerTarget(file);
    if (!target) {
      skipped.push(file);
      continue;
    }
    const list = groups.get(target.selector) ?? [];
    list.push(target.path);
    groups.set(target.selector, list);
    if (isProductionApexFile(target.path)) {
      apexGuruCandidates.push(target.path);
    }
  }

  return {
    groups: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([selector, targets]) => ({ selector, targets })),
    apexGuruCandidates,
    skipped,
  };
}
