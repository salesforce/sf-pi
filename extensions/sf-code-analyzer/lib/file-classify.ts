/* SPDX-License-Identifier: Apache-2.0 */
/** File classification for automatic Code Analyzer scans. */
import path from "node:path";

export interface CodeAnalyzerTarget {
  path: string;
  selector: string;
  kind: "apex" | "javascript" | "flow" | "regex";
}

export function classifyCodeAnalyzerTarget(filePath: string): CodeAnalyzerTarget | null {
  const normalized = path.normalize(filePath);
  const lower = normalized.toLowerCase();
  if (lower.endsWith(".cls") || lower.endsWith(".trigger") || lower.endsWith(".apex")) {
    return { path: normalized, selector: "pmd:Recommended", kind: "apex" };
  }
  if (lower.endsWith(".js") || lower.endsWith(".ts")) {
    return { path: normalized, selector: "eslint:Recommended", kind: "javascript" };
  }
  if (lower.endsWith(".flow-meta.xml")) {
    return { path: normalized, selector: "flow:Recommended", kind: "flow" };
  }
  return null;
}

export function isProductionApexFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  if (!base.endsWith(".cls") && !base.endsWith(".trigger") && !base.endsWith(".apex")) {
    return false;
  }
  return !base.endsWith("test.cls") && !base.endsWith("tests.cls") && !base.includes("testfactory");
}
