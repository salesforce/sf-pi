/* SPDX-License-Identifier: Apache-2.0 */
/** Focused LWC diagnostics through public LWC compiler packages. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { transformSync } from "@lwc/compiler";
import templateCompiler from "@lwc/template-compiler";
import type { LwcDiagnostic } from "./types.ts";

const TEMPLATE_TYPOS = ["<lighting-", "<lightening-", "<lihgtning-"];

export async function diagnoseLocalFile(
  filePath: string,
  projectRoot = process.cwd(),
): Promise<LwcDiagnostic[]> {
  const source = await readFile(filePath, "utf8");
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  if (/\.html$/i.test(filePath)) return diagnoseTemplate(relative, path.basename(filePath), source);
  if (/\.(js|ts)$/i.test(filePath))
    return diagnoseScript(relative, path.basename(filePath), source);
  if (/\.css$/i.test(filePath)) return diagnoseCss(relative, source);
  if (/\.js-meta\.xml$/i.test(filePath)) return diagnoseMetadata(relative, source);
  return [
    {
      file: relative,
      severity: "warning",
      message: "Unsupported LWC diagnostic file type. Use .html, .js, .ts, .css, or .js-meta.xml.",
      source: "sf-lwc",
    },
  ];
}

export function diagnoseTemplate(file: string, filename: string, source: string): LwcDiagnostic[] {
  const diagnostics: LwcDiagnostic[] = [];
  try {
    const result = templateCompiler(source, filename, {});
    for (const warning of result.warnings ?? [])
      diagnostics.push(fromCompilerWarning(file, warning, "lwc-template", source));
  } catch (error) {
    diagnostics.push(fromThrownError(file, error, "lwc-template"));
  }
  diagnostics.push(...diagnoseTemplateTypos(file, source));
  return diagnostics;
}

export function diagnoseScript(file: string, filename: string, source: string): LwcDiagnostic[] {
  const name = filename.replace(/\.(js|ts)$/i, "");
  try {
    transformSync(source, filename, { name, namespace: "c" });
    return [];
  } catch (error) {
    return [fromThrownError(file, error, "lwc-js")];
  }
}

export function diagnoseCss(file: string, source: string): LwcDiagnostic[] {
  const diagnostics: LwcDiagnostic[] = [];
  if (/\.slds-[\w-]+\s*[{,]/.test(source)) {
    diagnostics.push(styleDiagnostic(file, "SLDS class override selector detected."));
  }
  if (/--lwc-[\w-]+/.test(source)) {
    diagnostics.push(styleDiagnostic(file, "Deprecated LWC design token usage detected."));
  }
  if (/\b(?:t|token)\s*\(/.test(source)) {
    diagnostics.push(styleDiagnostic(file, "Legacy token syntax detected."));
  }
  if (/(#[0-9a-fA-F]{3,8}\b|rgba?\(|\b\d+(?:\.\d+)?(?:px|rem|em)\b)/.test(source)) {
    diagnostics.push(
      styleDiagnostic(
        file,
        "Hardcoded style value detected; SLDS 2 linter can determine whether a hook is appropriate.",
      ),
    );
  }
  return diagnostics;
}

export function diagnoseMetadata(file: string, source: string): LwcDiagnostic[] {
  const diagnostics: LwcDiagnostic[] = [];
  if (!/<LightningComponentBundle\b/i.test(source)) {
    diagnostics.push({
      file,
      severity: "error",
      message: "Missing LightningComponentBundle root element.",
      source: "lwc-meta",
    });
  }
  if (!/<apiVersion>\s*[^<]+\s*<\/apiVersion>/i.test(source)) {
    diagnostics.push({
      file,
      severity: "warning",
      message: "Missing apiVersion in LWC metadata.",
      source: "lwc-meta",
    });
  }
  const openTags = [...source.matchAll(/<([A-Za-z][\w:.-]*)(?:\s[^>]*)?>/g)]
    .filter((match) => !/\/\s*>$/.test(match[0]))
    .map((match) => match[1]);
  const closeTags = [...source.matchAll(/<\/([A-Za-z][\w:.-]*)>/g)].map((match) => match[1]);
  for (const tag of openTags.filter(
    (name) =>
      !source.includes(`</${name}>`) && !["target", "LightningComponentBundle"].includes(name),
  )) {
    if (!closeTags.includes(tag))
      diagnostics.push({
        file,
        severity: "error",
        message: `Unclosed XML tag: ${tag}.`,
        source: "lwc-meta",
      });
  }
  return diagnostics;
}

function styleDiagnostic(file: string, message: string): LwcDiagnostic {
  return {
    file,
    severity: "info",
    message,
    source: "sf-lwc",
  };
}

function diagnoseTemplateTypos(file: string, source: string): LwcDiagnostic[] {
  const diagnostics: LwcDiagnostic[] = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, lineIndex) => {
    for (const typo of TEMPLATE_TYPOS) {
      const column = line.indexOf(typo);
      if (column >= 0) {
        diagnostics.push({
          file,
          severity: "error",
          message: `${typo} is not a valid namespace. Did you mean <lightning-?`,
          line: lineIndex + 1,
          column: column + 1,
          source: "lwc-template",
        });
      }
    }
  });
  return diagnostics;
}

function fromCompilerWarning(
  file: string,
  warning: {
    message?: string;
    code?: string | number;
    level?: string | number;
    location?: { start?: number; length?: number };
  },
  sourceName: LwcDiagnostic["source"],
  text: string,
): LwcDiagnostic {
  const pos = offsetToLineColumn(text, warning.location?.start ?? 0);
  return {
    file,
    severity: String(warning.level ?? "error")
      .toLowerCase()
      .includes("warning")
      ? "warning"
      : "error",
    message: warning.message ?? "LWC diagnostic",
    line: pos.line,
    column: pos.column,
    code: warning.code,
    source: sourceName,
  };
}

function fromThrownError(
  file: string,
  error: unknown,
  sourceName: LwcDiagnostic["source"],
): LwcDiagnostic {
  const candidate = error as {
    message?: string;
    code?: string | number;
    location?: { line?: number; column?: number };
  };
  const location = candidate.location ?? extractBabelLocation(candidate.message ?? "");
  return {
    file,
    severity: "error",
    message: cleanMessage(candidate.message ?? String(error)),
    line: location?.line,
    column: location?.column,
    code: candidate.code,
    source: sourceName,
  };
}

function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const prefix = text.slice(0, Math.max(0, offset));
  const lines = prefix.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function extractBabelLocation(message: string): { line?: number; column?: number } | undefined {
  const match = />\s*(\d+)\s*\|[\s\S]*?\n\s*\|\s*(\^+)/m.exec(message);
  if (!match) return undefined;
  return { line: Number.parseInt(match[1], 10), column: undefined };
}

function cleanMessage(message: string): string {
  const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  return message.replaceAll(ansiEscape, "").split("\n").slice(0, 4).join("\n").trim();
}
