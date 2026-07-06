/* SPDX-License-Identifier: Apache-2.0 */
/** Export latest SOQL artifact to a workspace file. */

import { copyFile, lstat, mkdir, realpath, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { buildDigest, row, section, toolResultFromDigest } from "./digest.ts";
import type { SfSoqlParams, SfSoqlSessionState, SoqlArtifact, ToolResult } from "./types.ts";

export async function exportQueryResult(
  params: SfSoqlParams,
  state: SfSoqlSessionState,
  cwd: string,
): Promise<ToolResult> {
  const outputFile = params.output_file?.trim();
  if (!outputFile) throw new Error("output_file is required for query.export.");
  const target = resolveExportTarget(cwd, outputFile);
  const artifact = findArtifact(state, params.format ?? "csv");
  if (!artifact)
    throw new Error("No matching SOQL artifact found. Run query.sample/query.run first.");
  await copyArtifactSafely(cwd, artifact.path, target);
  const digest = buildDigest({
    action: "query.export",
    status: "pass",
    icon: "📤",
    title: "SOQL Export",
    org: { alias: params.target_org },
    api_calls: [{ method: "COPY", path: artifact.kind, detail: path.relative(cwd, target) }],
    sections: [
      section("📤", "Export", [
        row("📁", "Source", artifact.path),
        row("📝", "Format", params.format ?? "csv"),
        row("🎯", "Output", path.relative(cwd, target)),
      ]),
    ],
    artifacts: [{ path: target, kind: `export-${artifact.kind}` }],
  });
  return toolResultFromDigest(digest);
}

export function resolveExportTarget(cwd: string, outputFile: string): string {
  const requested = outputFile.trim();
  if (!requested) throw new Error("output_file is required for query.export.");
  if (path.isAbsolute(requested) || /^[a-zA-Z]:[\\/]/.test(requested)) {
    throw new Error("query.export output_file must be relative to the SOQL export directory.");
  }

  const rawSegments = requested.split(/[\\/]/);
  if (rawSegments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error("query.export output_file must not contain empty, '.', or '..' path segments.");
  }

  const safeSegments = rawSegments.map(safeExportSegment);
  return path.join(cwd, ".sf-pi", "exports", "soql", ...safeSegments);
}

async function copyArtifactSafely(cwd: string, source: string, target: string): Promise<void> {
  const exportRoot = path.join(cwd, ".sf-pi", "exports", "soql");
  const parent = path.dirname(target);
  await ensureSafeDirectory(exportRoot, cwd);
  await ensureSafeDirectory(parent, exportRoot);
  await assertPathInsideRealRoot(exportRoot, parent);
  await assertSafeExistingTarget(target);

  const temp = path.join(parent, `.tmp-${path.basename(target)}-${process.pid}-${randomUUID()}`);
  try {
    await copyFile(source, temp);
    await assertSafeExistingTarget(target);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function ensureSafeDirectory(dir: string, stopAt?: string): Promise<void> {
  const resolved = path.resolve(dir);
  const stop = stopAt ? path.resolve(stopAt) : path.parse(resolved).root;
  const relative = path.relative(stop, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("query.export output_file escaped the SOQL export directory.");
  }

  const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
  let current = stop;
  await ensureDirectorySegment(current);
  for (const segment of segments) {
    current = path.join(current, segment);
    await ensureDirectorySegment(current);
  }
}

async function ensureDirectorySegment(dir: string): Promise<void> {
  try {
    const stat = await lstat(dir);
    if (stat.isSymbolicLink()) {
      throw new Error("query.export output_file must not traverse symlinks.");
    }
    if (!stat.isDirectory()) {
      throw new Error("query.export output_file parent path is not a directory.");
    }
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) throw error;
    await mkdir(dir);
  }
}

async function assertPathInsideRealRoot(exportRoot: string, candidate: string): Promise<void> {
  const realRoot = await realpath(exportRoot);
  const realCandidate = await realpath(candidate);
  const relative = path.relative(realRoot, realCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("query.export output_file escaped the SOQL export directory.");
  }
}

async function assertSafeExistingTarget(target: string): Promise<void> {
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) {
      throw new Error("query.export output_file must not target a symlink.");
    }
    if (!stat.isFile()) {
      throw new Error("query.export output_file target must be a file.");
    }
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

function safeExportSegment(segment: string): string {
  const safe = segment.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe || safe === "." || safe === "..") {
    throw new Error("query.export output_file contains an invalid path segment.");
  }
  return safe;
}

function findArtifact(
  state: SfSoqlSessionState,
  format: NonNullable<SfSoqlParams["format"]>,
): SoqlArtifact | undefined {
  const artifacts = state.lastDigest?.artifacts ?? [];
  const preferredKind = kindFor(format);
  return (
    artifacts.find((artifact) => artifact.kind === preferredKind) ??
    artifacts.find((artifact) => artifact.kind.includes(format))
  );
}

function kindFor(format: NonNullable<SfSoqlParams["format"]>): string {
  switch (format) {
    case "csv":
      return "flattened-csv";
    case "json":
    case "flattened_json":
      return "flattened-json";
    case "raw_json":
      return "raw";
  }
}
