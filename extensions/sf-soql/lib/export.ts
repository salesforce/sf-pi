/* SPDX-License-Identifier: Apache-2.0 */
/** Export latest SOQL artifact to a workspace file. */

import { copyFile, mkdir } from "node:fs/promises";
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
  const artifact = findArtifact(state, params.format ?? "csv");
  if (!artifact)
    throw new Error("No matching SOQL artifact found. Run query.sample/query.run first.");
  const target = path.resolve(cwd, outputFile);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(artifact.path, target);
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
