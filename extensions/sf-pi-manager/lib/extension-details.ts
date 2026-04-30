/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { SfPiExtension } from "../../../catalog/registry.ts";

export type ExtensionStateLike = SfPiExtension & { enabled: boolean };

export type ExtensionStatus = "enabled" | "disabled" | "locked";

export interface ExtensionDetailSummary {
  status: ExtensionStatus;
  statusLabel: string;
  readmePath: string;
  readmeAvailable: boolean;
  testsPath: string;
  testsAvailable: boolean;
  commands: readonly string[];
  providers: readonly string[];
  tools: readonly string[];
  events: readonly string[];
}

export function getExtensionStatus(extension: ExtensionStateLike): ExtensionStatus {
  if (extension.alwaysActive) {
    return "locked";
  }
  return extension.enabled ? "enabled" : "disabled";
}

export function getExtensionStatusLabel(extension: ExtensionStateLike): string {
  const status = getExtensionStatus(extension);
  if (status === "locked") {
    return "Locked (always active)";
  }
  return status === "enabled" ? "Enabled" : "Disabled";
}

export function getExtensionReadmePath(extension: Pick<SfPiExtension, "file">): string {
  return toRepoPath(path.join(path.dirname(extension.file), "README.md"));
}

export function getExtensionTestsPath(extension: Pick<SfPiExtension, "file">): string {
  return toRepoPath(path.join(path.dirname(extension.file), "tests"));
}

export function buildExtensionDetailSummary(
  extension: ExtensionStateLike,
  packageRoot: string,
): ExtensionDetailSummary {
  const readmePath = getExtensionReadmePath(extension);
  const testsPath = getExtensionTestsPath(extension);

  return {
    status: getExtensionStatus(extension),
    statusLabel: getExtensionStatusLabel(extension),
    readmePath,
    readmeAvailable: existsSync(path.join(packageRoot, readmePath)),
    testsPath,
    testsAvailable: existsSync(path.join(packageRoot, testsPath)),
    commands: extension.commands ?? [],
    providers: extension.providers ?? [],
    tools: extension.tools ?? [],
    events: extension.events ?? [],
  };
}

function toRepoPath(filePath: string): string {
  return filePath.replaceAll(path.sep, "/");
}
