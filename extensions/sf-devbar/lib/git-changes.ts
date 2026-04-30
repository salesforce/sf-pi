/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Async git change counts — added, modified, deleted.
 *
 * Runs `git status --porcelain` and counts file states.
 * Non-blocking: returns null if git isn't available or the cwd isn't a repo.
 */

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

export type GitChanges = {
  added: number;
  modified: number;
  deleted: number;
};

export type ExecFn = (
  command: string,
  args: string[],
  options?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string; code: number }>;

// -------------------------------------------------------------------------------------------------
// Detection
// -------------------------------------------------------------------------------------------------

/**
 * Parse `git status --porcelain` output into change counts.
 *
 * Porcelain format: two-character status code followed by the filename.
 * First char = index status, second char = working tree status.
 *
 *   "??" = untracked (added)
 *   "A " = staged add
 *   " M" or "M " or "MM" = modified
 *   " D" or "D " = deleted
 */
export function parseGitStatus(porcelain: string): GitChanges {
  const lines = porcelain.split("\n").filter((l) => l.length >= 3);
  let added = 0;
  let modified = 0;
  let deleted = 0;

  for (const line of lines) {
    const x = line[0]; // index status
    const y = line[1]; // working tree status

    if (x === "?" && y === "?") {
      added++;
    } else if (x === "A" || y === "A") {
      added++;
    } else if (x === "D" || y === "D") {
      deleted++;
    } else if (x === "M" || y === "M" || x === "R" || y === "R") {
      modified++;
    } else if (x === "U" || y === "U") {
      // Unmerged — count as modified
      modified++;
    } else if (x !== " " || y !== " ") {
      // Any other non-blank status — count as modified
      modified++;
    }
  }

  return { added, modified, deleted };
}

/**
 * Run `git status --porcelain` and return change counts.
 * Returns null if git isn't available or the repo isn't present.
 *
 * `cwd` is accepted for API symmetry with callers but unused: the `exec`
 * adapter passed in already carries the working directory it should run
 * against. Leading underscore marks the arg as intentionally unused.
 */
export async function getGitChanges(exec: ExecFn, _cwd: string): Promise<GitChanges | null> {
  try {
    const result = await exec("git", ["status", "--porcelain"], { timeout: 5000 });
    if (result.code !== 0) return null;
    return parseGitStatus(result.stdout);
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------------------------------
// Formatting
// -------------------------------------------------------------------------------------------------

/**
 * Format git changes as a compact string: "+3 ~1 -2".
 * Omits categories with zero count for cleaner display.
 * Returns empty string if no changes.
 */
export function formatGitChanges(changes: GitChanges): string {
  const parts: string[] = [];
  if (changes.added > 0) parts.push(`+${changes.added}`);
  if (changes.modified > 0) parts.push(`~${changes.modified}`);
  if (changes.deleted > 0) parts.push(`-${changes.deleted}`);
  return parts.join(" ");
}
