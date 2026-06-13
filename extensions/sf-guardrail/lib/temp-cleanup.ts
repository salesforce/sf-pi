/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Strict validator for auto-allowing OS temp-directory cleanup.
 *
 * This intentionally recognizes only a narrow, literal `rm -rf` shape. It is
 * not a general delete policy: any shell expansion, chain, multiple target,
 * symlink, non-temp path, or temp-root delete falls back to the normal
 * dangerous-command confirmation.
 */
import { lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasShellChain, tokenize } from "./bash-ast.ts";

export interface SafeTempCleanup {
  path: string;
  realPath: string;
}

const UNSAFE_SHELL_CHARS = /[*?[$`{}()!]/;
const RUN_OWNED_BASENAME = /^(tmp[.-]|pi-|sf-pi-|pi-subagents-|sf-code-analyzer-)/;

export function detectSafeTempCleanup(command: string): SafeTempCleanup | undefined {
  if (hasShellChain(command)) return undefined;
  const tokens = tokenize(command);
  if (!tokens || tokens.head !== "rm") return undefined;

  const flags: string[] = [];
  const operands: string[] = [];
  for (const arg of tokens.args) {
    if (arg.startsWith("-")) flags.push(arg);
    else operands.push(arg);
  }

  if (operands.length !== 1) return undefined;
  if (!hasRecursiveForceFlags(flags)) return undefined;

  const target = operands[0];
  if (!path.isAbsolute(target)) return undefined;
  if (target.includes("..") || UNSAFE_SHELL_CHARS.test(target)) return undefined;

  const basename = path.basename(target);
  if (!RUN_OWNED_BASENAME.test(basename)) return undefined;

  try {
    const stat = lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;

    const realTarget = realpathSync(target);
    const realTmp = realpathSync(os.tmpdir());
    if (realTarget === realTmp) return undefined;
    if (!isPathInside(realTarget, realTmp)) return undefined;

    return { path: target, realPath: realTarget };
  } catch {
    return undefined;
  }
}

function hasRecursiveForceFlags(flags: string[]): boolean {
  if (flags.length === 0) return false;
  let hasRecursive = false;
  let hasForce = false;
  for (const flag of flags) {
    if (!flag.startsWith("-") || flag.startsWith("--")) return false;
    const chars = flag.slice(1);
    if (!chars || /[^rRfF]/.test(chars)) return false;
    if (/[rR]/.test(chars)) hasRecursive = true;
    if (/[fF]/.test(chars)) hasForce = true;
  }
  return hasRecursive && hasForce;
}

function isPathInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}
