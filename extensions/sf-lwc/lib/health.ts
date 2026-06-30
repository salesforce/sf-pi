/* SPDX-License-Identifier: Apache-2.0 */
/** LWC bundle health analysis helpers. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { row } from "./digest.ts";
import { relativeToProject } from "./project.ts";
import type { DigestRow, LwcBundleInfo, LwcDiagnostic } from "./types.ts";

export type LwcHealthSeverity = "warning" | "advisory";

export interface LwcBundleHealthFinding {
  severity: LwcHealthSeverity;
  code:
    | "missing-js"
    | "missing-meta"
    | "missing-html-for-ui-component"
    | "diagnostic-error"
    | "missing-test";
  message: string;
  file?: string;
}

export async function analyzeBundleHealth(
  bundle: LwcBundleInfo,
  projectRoot: string,
  diagnostics: LwcDiagnostic[] = [],
): Promise<LwcBundleHealthFinding[]> {
  const findings: LwcBundleHealthFinding[] = [];
  const expectedJs = path.join(bundle.bundlePath, `${bundle.name}.js`);
  const expectedTs = path.join(bundle.bundlePath, `${bundle.name}.ts`);
  const expectedHtml = path.join(bundle.bundlePath, `${bundle.name}.html`);
  const expectedMeta = path.join(bundle.bundlePath, `${bundle.name}.js-meta.xml`);
  const scriptFile = bundle.files.includes(expectedJs)
    ? expectedJs
    : bundle.files.includes(expectedTs)
      ? expectedTs
      : undefined;

  if (!scriptFile) {
    findings.push({
      severity: "warning",
      code: "missing-js",
      message: `missing required JavaScript file: ${bundle.name}.js`,
      file: relativeToProject(projectRoot, expectedJs),
    });
  }

  if (!bundle.files.includes(expectedMeta)) {
    findings.push({
      severity: "warning",
      code: "missing-meta",
      message: `missing js-meta.xml: ${bundle.name}.js-meta.xml`,
      file: relativeToProject(projectRoot, expectedMeta),
    });
  }

  if (
    scriptFile &&
    !bundle.files.includes(expectedHtml) &&
    (await looksLikeUiComponent(scriptFile))
  ) {
    findings.push({
      severity: "warning",
      code: "missing-html-for-ui-component",
      message: `missing template file for likely UI component: ${bundle.name}.html`,
      file: relativeToProject(projectRoot, expectedHtml),
    });
  }

  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== "error") continue;
    findings.push({
      severity: "warning",
      code: "diagnostic-error",
      message: diagnostic.message,
      file: diagnostic.file,
    });
  }

  if (bundle.testFiles.length === 0) {
    findings.push({
      severity: "advisory",
      code: "missing-test",
      message: "No colocated LWC Jest test found.",
    });
  }

  return findings;
}

export function hasHealthWarnings(findings: LwcBundleHealthFinding[]): boolean {
  return findings.some((finding) => finding.severity === "warning");
}

export function primaryHealthReason(findings: LwcBundleHealthFinding[]): string | undefined {
  return findings.find((finding) => finding.severity === "warning")?.message;
}

export function healthRows(findings: LwcBundleHealthFinding[]): DigestRow[] {
  const displayed = findings.filter((finding) => finding.severity === "warning");
  if (!displayed.length) return [row("✅", "Status", "healthy")];
  return displayed
    .slice(0, 8)
    .map((finding) =>
      row(
        "⚠️",
        finding.code,
        finding.file ? `${finding.message} · ${finding.file}` : finding.message,
      ),
    );
}

export function healthSummary(findings: LwcBundleHealthFinding[]): string {
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const advisories = findings.filter((finding) => finding.severity === "advisory").length;
  const bits = warnings ? [`warnings=${warnings}`] : ["healthy"];
  if (advisories) bits.push(`advisories=${advisories}`);
  return bits.join(" · ");
}

async function looksLikeUiComponent(jsFile: string): Promise<boolean> {
  try {
    const source = await readFile(jsFile, "utf8");
    return /from\s+['"]lwc['"]/.test(source) && /\bLightningElement\b/.test(source);
  } catch {
    return false;
  }
}
