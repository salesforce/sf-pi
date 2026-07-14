/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Canonical runtime floors for sf-pi.
 *
 * Keep package metadata, install checks, doctor diagnostics, and startup
 * status surfaces on the same Node.js floor. The package.json `engines.node`
 * field is the public contract; this helper reads that value with a small
 * fallback so runtime status never crashes if package metadata is unavailable.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_NODE_RUNTIME_FLOOR = "22.19.0";

export interface SemanticVersionParts {
  major: number;
  minor: number;
  patch: number;
}

export const NODE_RUNTIME_FLOOR = readPackageNodeRuntimeFloor() ?? FALLBACK_NODE_RUNTIME_FLOOR;

export function parseSemanticVersion(value: string | undefined): SemanticVersionParts | null {
  if (!value) return null;
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value.trim());
  if (!match) return null;
  return {
    major: Number.parseInt(match[1] ?? "0", 10),
    minor: Number.parseInt(match[2] ?? "0", 10),
    patch: Number.parseInt(match[3] ?? "0", 10),
  };
}

export function compareSemanticVersions(a: string, b: string): number {
  const left = parseSemanticVersion(a) ?? { major: 0, minor: 0, patch: 0 };
  const right = parseSemanticVersion(b) ?? { major: 0, minor: 0, patch: 0 };
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] > right[key]) return 1;
    if (left[key] < right[key]) return -1;
  }
  return 0;
}

export function isNodeRuntimeSupported(
  nodeVersion: string = process.version,
  floor: string = NODE_RUNTIME_FLOOR,
): boolean {
  return compareSemanticVersions(nodeVersion, floor) >= 0;
}

export function extractNodeRuntimeFloor(range: string | undefined): string | null {
  if (!range) return null;
  const match = />=\s*v?(\d+(?:\.\d+){0,2})/.exec(range.trim());
  if (!match) return null;
  const parsed = parseSemanticVersion(match[1]);
  return parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : null;
}

function readPackageNodeRuntimeFloor(): string | null {
  const packagePath = resolvePackageJsonPath();
  if (!packagePath) return null;
  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as {
      engines?: { node?: unknown };
    };
    return extractNodeRuntimeFloor(
      typeof parsed.engines?.node === "string" ? parsed.engines.node : undefined,
    );
  } catch {
    return null;
  }
}

function resolvePackageJsonPath(): string | null {
  try {
    let current = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i += 1) {
      const candidate = path.join(current, "package.json");
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {
    // Fall through to null.
  }
  return null;
}
