/* SPDX-License-Identifier: Apache-2.0 */
/** SFDX project and LWC bundle discovery helpers. */

import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  LwcBundleInfo,
  LwcMetadataInfo,
  LwcProjectScan,
  PackageDirInfo,
  SfdxProjectInfo,
} from "./types.ts";

const MAX_UPWARD_DEPTH = 8;

export async function resolveProject(workspace: string): Promise<SfdxProjectInfo> {
  const projectRoot = await findProjectRoot(path.resolve(workspace));
  if (!projectRoot) {
    throw new Error("No sfdx-project.json found. sf-lwc V1 supports SFDX projects only.");
  }
  const raw = JSON.parse(await readFile(path.join(projectRoot, "sfdx-project.json"), "utf8")) as {
    sourceApiVersion?: string;
    packageDirectories?: Array<{ path?: string; default?: boolean }>;
  };
  const packageDirs = (raw.packageDirectories ?? [])
    .filter((entry): entry is { path: string; default?: boolean } => typeof entry.path === "string")
    .map<PackageDirInfo>((entry) => ({
      path: entry.path,
      fullPath: path.resolve(projectRoot, entry.path),
      default: entry.default,
    }));
  if (packageDirs.length === 0) throw new Error("sfdx-project.json has no packageDirectories.");
  return { projectRoot, sourceApiVersion: raw.sourceApiVersion, packageDirs };
}

export async function scanProject(workspace: string, packageDir?: string): Promise<LwcProjectScan> {
  const project = await resolveProject(workspace);
  const selected = selectPackageDirs(project, packageDir);
  const bundles: LwcBundleInfo[] = [];
  const omitted: string[] = [];
  for (const pkg of selected) {
    const lwcRoots = await findLwcRoots(pkg.fullPath);
    for (const lwcRoot of lwcRoots) {
      const children = await safeReaddir(lwcRoot);
      for (const child of children) {
        const bundlePath = path.join(lwcRoot, child.name);
        if (!child.isDirectory() || child.name.startsWith(".")) continue;
        const bundle = await readBundle(pkg, lwcRoot, bundlePath);
        if (bundle.files.length === 0) {
          omitted.push(bundlePath);
          continue;
        }
        bundles.push(bundle);
      }
    }
  }
  bundles.sort((a, b) => a.name.localeCompare(b.name));
  return { project, bundles, omitted };
}

export function selectPackageDirs(project: SfdxProjectInfo, packageDir?: string): PackageDirInfo[] {
  if (!packageDir) return project.packageDirs;
  const normalized = packageDir.replace(/\\/g, "/").replace(/\/$/, "");
  const matches = project.packageDirs.filter(
    (pkg) =>
      pkg.path === normalized || pkg.fullPath === path.resolve(project.projectRoot, packageDir),
  );
  if (matches.length === 0) throw new Error(`Unknown package directory: ${packageDir}`);
  return matches;
}

export async function findBundle(
  workspace: string,
  component: string,
  packageDir?: string,
): Promise<{ scan: LwcProjectScan; bundle: LwcBundleInfo }> {
  const scan = await scanProject(workspace, packageDir);
  const matches = scan.bundles.filter(
    (bundle) => bundle.name.toLowerCase() === component.toLowerCase(),
  );
  if (matches.length === 0) throw new Error(`LWC component not found: ${component}`);
  if (matches.length > 1)
    throw new Error(
      `Ambiguous LWC component '${component}' found in multiple package directories.`,
    );
  return { scan, bundle: matches[0] };
}

export function relativeToProject(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).replace(/\\/g, "/");
}

async function readBundle(
  pkg: PackageDirInfo,
  lwcRoot: string,
  bundlePath: string,
): Promise<LwcBundleInfo> {
  const top = await safeReaddir(bundlePath);
  const files: string[] = [];
  const testFiles: string[] = [];
  for (const entry of top) {
    const full = path.join(bundlePath, entry.name);
    if (entry.isFile()) files.push(full);
    if (entry.isDirectory() && entry.name === "__tests__") {
      const tests = await collectFiles(full, (file) => /\.test\.(js|ts)$/i.test(file));
      testFiles.push(...tests);
    }
  }
  files.sort();
  testFiles.sort();
  const metaFile = files.find((file) => file.endsWith(".js-meta.xml"));
  const metadata = metaFile ? parseMetadata(await readFile(metaFile, "utf8")) : undefined;
  return {
    name: path.basename(bundlePath),
    packageDir: pkg.path,
    packageDirPath: pkg.fullPath,
    lwcRoot,
    bundlePath,
    files,
    testFiles,
    metadata,
  };
}

async function findProjectRoot(start: string): Promise<string | undefined> {
  let current = start;
  for (let i = 0; i <= MAX_UPWARD_DEPTH; i += 1) {
    if (await exists(path.join(current, "sfdx-project.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

async function findLwcRoots(packageRoot: string): Promise<string[]> {
  const roots: string[] = [];
  await walkDirs(packageRoot, async (dir) => {
    if (path.basename(dir) === "lwc") roots.push(dir);
  });
  roots.sort();
  return roots;
}

async function walkDirs(dir: string, onDir: (dir: string) => Promise<void>): Promise<void> {
  const entries = await safeReaddir(dir);
  await onDir(dir);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === ".sf" ||
      entry.name === ".sfdx"
    )
      continue;
    await walkDirs(path.join(dir, entry.name), onDir);
  }
}

async function collectFiles(dir: string, include: (file: string) => boolean): Promise<string[]> {
  const entries = await safeReaddir(dir);
  const result: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await collectFiles(full, include)));
    if (entry.isFile() && include(full)) result.push(full);
  }
  return result;
}

function parseMetadata(xml: string): LwcMetadataInfo {
  return {
    apiVersion: firstTag(xml, "apiVersion"),
    isExposed: firstTag(xml, "isExposed")?.toLowerCase() === "true",
    masterLabel: firstTag(xml, "masterLabel"),
    targets: [...xml.matchAll(/<target>\s*([^<]+?)\s*<\/target>/g)].map((m) => m[1]),
  };
}

function firstTag(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>\\s*([^<]+?)\\s*<\\/${tag}>`, "i").exec(xml);
  return match?.[1]?.trim();
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeReaddir(
  dir: string,
): Promise<Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
