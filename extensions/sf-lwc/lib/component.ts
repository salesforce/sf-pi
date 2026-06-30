/* SPDX-License-Identifier: Apache-2.0 */
/** LWC component inspection helpers. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { diagnoseLocalFile } from "./diagnostics.ts";
import { findBundle, relativeToProject } from "./project.ts";
import type { LwcBundleInfo, LwcComponentInspection, LwcProjectScan } from "./types.ts";

export async function inspectComponent(params: {
  workspace: string;
  component: string;
  packageDir?: string;
  includeSource?: boolean;
}): Promise<{ scan: LwcProjectScan; inspection: LwcComponentInspection }> {
  const { scan, bundle } = await findBundle(params.workspace, params.component, params.packageDir);
  const sourceFiles = bundle.files.filter((file) => /\.(js|ts|html|css|js-meta\.xml)$/i.test(file));
  const diagnosticFiles = sourceFiles.filter((file) =>
    /\.(js|ts|html|css|js-meta\.xml)$/i.test(file),
  );
  const source: Record<string, string> = {};
  for (const file of sourceFiles)
    source[relativeToProject(scan.project.projectRoot, file)] = await readFile(file, "utf8");

  const jsSource = joinSources(
    sourceFiles.filter((file) => /\.(js|ts)$/i.test(file)),
    source,
  );
  const htmlSource = joinSources(
    sourceFiles.filter((file) => /\.html$/i.test(file)),
    source,
  );
  const cssSource = joinSources(
    sourceFiles.filter((file) => /\.css$/i.test(file)),
    source,
  );
  const diagnostics = (
    await Promise.all(
      diagnosticFiles.map((file) => diagnoseLocalFile(file, scan.project.projectRoot)),
    )
  ).flat();

  return {
    scan,
    inspection: {
      bundle,
      publicApi: unique(extractPublicApi(jsSource)),
      apexImports: unique(extractModuleImports(jsSource, /@salesforce\/apex\/([\w.]+)/g)),
      schemaImports: unique(extractModuleImports(jsSource, /@salesforce\/schema\/([\w.]+)/g)),
      labelImports: unique(extractModuleImports(jsSource, /@salesforce\/label\/([\w.]+)/g)),
      resourceImports: unique(
        extractModuleImports(jsSource, /@salesforce\/resourceUrl\/([\w.]+)/g),
      ),
      childComponents: unique(extractTags(htmlSource, /<\s*c-([a-zA-Z0-9_-]+)/g)),
      lightningTags: unique(extractTags(htmlSource, /<\s*(lightning-[a-zA-Z0-9_-]+)/g)),
      diagnostics,
      styleSignals: extractStyleSignals(cssSource, htmlSource, sourceFiles),
      source: params.includeSource ? source : undefined,
    },
  };
}

export function bundleDisplayRows(bundle: LwcBundleInfo, projectRoot: string): string[] {
  return bundle.files.map((file) => relativeToProject(projectRoot, file));
}

function joinSources(files: string[], sourceByRelativePath: Record<string, string>): string {
  return files
    .map((file) => {
      const basename = path.basename(file);
      const match = Object.entries(sourceByRelativePath).find(([relative]) =>
        relative.endsWith(`/${basename}`),
      );
      return match?.[1] ?? "";
    })
    .join("\n");
}

function extractPublicApi(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/@api\s+(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)/g))
    names.push(match[1]);
  return names;
}

function extractModuleImports(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function extractTags(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

export function extractStyleSignals(
  cssSource: string,
  htmlSource: string,
  sourceFiles: string[],
): string[] {
  const signals: string[] = [];
  if (sourceFiles.some((file) => /\.css$/i.test(file))) signals.push("css-file");
  if (/\.slds-[\w-]+\s*[{,]/.test(cssSource)) signals.push("slds-class-override");
  if (/\bclass\s*=\s*["'][^"']*\bslds-[\w-]+/.test(htmlSource)) signals.push("slds-class-usage");
  if (/--lwc-[\w-]+/.test(cssSource)) signals.push("lwc-design-token");
  if (/\b(?:t|token)\s*\(/.test(cssSource)) signals.push("legacy-token-syntax");
  if (/(#[0-9a-fA-F]{3,8}\b|rgba?\(|\b\d+(?:\.\d+)?(?:px|rem|em)\b)/.test(cssSource)) {
    signals.push("hardcoded-style-value");
  }
  return unique(signals);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
