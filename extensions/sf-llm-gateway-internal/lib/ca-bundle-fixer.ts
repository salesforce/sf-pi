/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Corporate CA bundle fixer for `/sf-llm-gateway fix-ca-bundle`.
 *
 * On macOS, Node ignores the system keychain. When the gateway sits behind
 * a corporate proxy whose chain isn't in Node's bundle, every fetch fails
 * with a generic `fetch failed` even though `curl` (which uses the
 * keychain) works. The fix is `NODE_EXTRA_CA_CERTS=<bundle>.pem`, but
 * that env var has to be set in two places:
 *   1. `launchctl setenv` via a LaunchAgent \u2014 covers Dock/Spotlight launches
 *   2. `~/.zshenv` export                       \u2014 covers Terminal launches
 *
 * This module exposes the pure helpers that build, write, and parse those
 * two surfaces, plus the strategy logic that picks an existing bundle or
 * downloads a new one. The orchestration in `index.ts` drives them with
 * UI confirmations (HITL on every disk-mutating step).
 *
 * Everything here is pure or filesystem-only. Network access is contained
 * inside `downloadBundle`, which the orchestrator only invokes after
 * explicit user consent.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fetchWithTimeout } from "./models.ts";

/**
 * Default well-known macOS paths the probe scans before any user-supplied
 * extras. Order matters \u2014 first hit wins. None of these are baked into
 * the public-facing UX as a recommendation; we only adopt them when they
 * already exist on disk and parse as PEM.
 */
const DEFAULT_CANDIDATE_RELATIVE_PATHS = [
  ".aisuite/conf/npm-sfdc-certs.pem",
  ".aisuite/conf/internal.pem",
  ".aisuite/conf/ca-bundle.pem",
  ".claude/npm-sfdc-certs.pem",
  ".claude/internal.pem",
  ".claude/ca-bundle.pem",
  ".claude/conf/npm-sfdc-certs.pem",
  ".claude/conf/internal.pem",
  ".claude/conf/ca-bundle.pem",
  ".claude/certs/internal.pem",
  ".claude/certs/ca-bundle.pem",
  ".devbar/npm-sfdc-certs.pem",
  ".devbar/internal.pem",
  ".devbar/ca-bundle.pem",
  ".devbar/conf/npm-sfdc-certs.pem",
  ".devbar/conf/internal.pem",
  ".devbar/conf/ca-bundle.pem",
  ".devbar/certs/internal.pem",
  ".devbar/certs/ca-bundle.pem",
] as const;

/**
 * Reverse-DNS id for the LaunchAgent we own. Distinct from anything an
 * AI-Suite installer might write so we never collide with another tool's
 * plist by accident.
 */
export const LAUNCH_AGENT_LABEL = "com.salesforce.sf-pi.node-extra-ca-certs";

export const SENTINEL_BEGIN = "# >>> sf-pi: NODE_EXTRA_CA_CERTS >>>";
export const SENTINEL_END = "# <<< sf-pi: NODE_EXTRA_CA_CERTS <<<";

const DOWNLOAD_TIMEOUT_MS = 12_000;
const PEM_HEADER = "-----BEGIN CERTIFICATE-----";

/**
 * Result of probing one candidate path. The orchestrator picks the first
 * `valid` candidate; the rest are returned for diagnostic display.
 */
export interface BundleProbeResult {
  /** Absolute path that was probed. */
  path: string;
  /** True only when the file exists, is non-empty, and parses as PEM. */
  valid: boolean;
  /** Short reason for invalid candidates (missing, wrong shape, etc.). */
  reason?: string;
  /** File size in bytes. Diagnostic only. */
  sizeBytes?: number;
}

export interface PemValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Build the ordered list of candidate paths the probe will scan.
 *
 * Extras come first so user-supplied paths take precedence over the
 * built-in well-known list. Duplicates are removed while preserving
 * order. We don't probe the file in this helper \u2014 that's `probeBundleCandidates`.
 */
export function buildCandidatePaths(extras: string[] = [], home: string = homedir()): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (entry: string | undefined) => {
    if (!entry) return;
    const trimmed = entry.trim();
    if (!trimmed) return;
    const absolute = path.isAbsolute(trimmed) ? trimmed : path.join(home, trimmed);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    ordered.push(absolute);
  };
  for (const extra of extras) add(extra);
  for (const rel of DEFAULT_CANDIDATE_RELATIVE_PATHS) add(rel);
  return ordered;
}

export function probeBundleCandidates(
  extras: string[] = [],
  home: string = homedir(),
): BundleProbeResult[] {
  return buildCandidatePaths(extras, home).map((candidate) => probeOne(candidate));
}

function probeOne(candidate: string): BundleProbeResult {
  if (!existsSync(candidate)) {
    return { path: candidate, valid: false, reason: "not present" };
  }
  let stats;
  try {
    stats = statSync(candidate);
  } catch (error) {
    return {
      path: candidate,
      valid: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (!stats.isFile()) {
    return { path: candidate, valid: false, reason: "not a regular file" };
  }
  const validation = validatePemBundle(candidate);
  if (!validation.ok) {
    return {
      path: candidate,
      valid: false,
      reason: validation.reason ?? "not a PEM bundle",
      sizeBytes: stats.size,
    };
  }
  return { path: candidate, valid: true, sizeBytes: stats.size };
}

/**
 * Confirm a file looks like a PEM bundle. Header sniff first (cheap),
 * then `openssl x509 -noout` when the binary is available (deeper check).
 * Returns ok=true on first cheap success even when openssl isn't on PATH
 * \u2014 we never hard-require it because the probe must work in CI without
 * extra dependencies.
 */
export function validatePemBundle(filePath: string): PemValidation {
  let bytes: Buffer;
  try {
    bytes = readFileSync(filePath);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (bytes.length === 0) {
    return { ok: false, reason: "empty file" };
  }
  const head = bytes.slice(0, 4096).toString("utf8");
  if (!head.includes(PEM_HEADER)) {
    return { ok: false, reason: "missing -----BEGIN CERTIFICATE----- header" };
  }
  // Optional deeper check via openssl. Best-effort: not failing on a
  // missing binary keeps this portable across CI runners.
  try {
    execFileSync("openssl", ["x509", "-in", filePath, "-noout"], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 4_000,
    });
  } catch (error) {
    // ENOENT means openssl isn't installed \u2014 not a hard failure.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("ENOENT") && !message.includes("not found")) {
      return { ok: false, reason: `openssl rejected the bundle: ${message}` };
    }
  }
  return { ok: true };
}

export interface DownloadResult {
  ok: boolean;
  /** Absolute path the bundle was written to (only when ok). */
  path?: string;
  /** Short reason for failures (HTTP status, error message). */
  reason?: string;
  /** Bytes written. Diagnostic only. */
  bytesWritten?: number;
}

/**
 * Download a CA bundle from `url` into `destPath`. Atomic write via a
 * `<dest>.tmp` file then rename so an interrupted download never leaves a
 * truncated bundle in place. PEM-validates after rename.
 */
export async function downloadBundle(
  url: string,
  destPath: string,
  timeoutMs: number = DOWNLOAD_TIMEOUT_MS,
): Promise<DownloadResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(url, { method: "GET", redirect: "follow" }, timeoutMs);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (!response.ok) {
    return { ok: false, reason: `HTTP ${response.status} when fetching ${url}` };
  }
  let body: ArrayBuffer;
  try {
    body = await response.arrayBuffer();
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const buf = Buffer.from(body);
  if (buf.length === 0) {
    return { ok: false, reason: "downloaded body was empty" };
  }
  const tmp = `${destPath}.${process.pid}.tmp`;
  try {
    mkdirSync(path.dirname(destPath), { recursive: true });
    writeFileSync(tmp, buf, { mode: 0o644 });
    // Rename is atomic on the same filesystem; safe vs interrupted writes.
    const fs = await import("node:fs/promises");
    await fs.rename(tmp, destPath);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const validation = validatePemBundle(destPath);
  if (!validation.ok) {
    return { ok: false, reason: `downloaded file is not a PEM bundle: ${validation.reason}` };
  }
  return { ok: true, path: destPath, bytesWritten: buf.length };
}

/**
 * Build the LaunchAgent plist XML that calls `launchctl setenv
 * NODE_EXTRA_CA_CERTS <bundlePath>` on login. Pure string construction.
 *
 * We use a lightweight RunAtLoad agent rather than `launchctl setenv`
 * itself because `setenv` only affects the current launchctl session;
 * the LaunchAgent re-applies it for every GUI login.
 */
export function buildLaunchAgentPlist(bundlePath: string): string {
  // Escape any XML-significant characters. Bundle paths really shouldn't
  // contain them but defense-in-depth never hurts.
  const escaped = bundlePath
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCH_AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/launchctl</string>
        <string>setenv</string>
        <string>NODE_EXTRA_CA_CERTS</string>
        <string>${escaped}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
`;
}

export function defaultLaunchAgentPath(home: string = homedir()): string {
  return path.join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
}

export function defaultZshenvPath(home: string = homedir()): string {
  return path.join(home, ".zshenv");
}

/**
 * Idempotently insert (or replace) the sf-pi sentinel block in `~/.zshenv`.
 *
 * Returns the new file contents and a `changed` flag. Pure: callers
 * write the result themselves. The block format is:
 *
 *   # >>> sf-pi: NODE_EXTRA_CA_CERTS >>>
 *   export NODE_EXTRA_CA_CERTS="<bundle>"
 *   # <<< sf-pi: NODE_EXTRA_CA_CERTS <<<
 */
export function buildZshenvBlock(bundlePath: string): string {
  // Quote inside double quotes so paths with spaces work; we already
  // require an absolute path so `~` expansion isn't a concern.
  const escaped = bundlePath.replace(/(["\\$`])/g, "\\$1");
  return [SENTINEL_BEGIN, `export NODE_EXTRA_CA_CERTS="${escaped}"`, SENTINEL_END].join("\n");
}

export function applyZshenvBlock(
  currentContents: string,
  bundlePath: string,
): { contents: string; changed: boolean } {
  const newBlock = buildZshenvBlock(bundlePath);
  const existing = extractZshenvBlock(currentContents);
  if (existing.found && existing.block === newBlock) {
    return { contents: currentContents, changed: false };
  }
  if (existing.found) {
    // Replace in place to avoid duplicating sentinels on repeat applies.
    const before = currentContents.slice(0, existing.startIndex);
    const after = currentContents.slice(existing.endIndex);
    const merged = `${before}${newBlock}${after}`;
    return { contents: ensureTrailingNewline(merged), changed: true };
  }
  // Append. Preserve the original ending behavior (newline preserved).
  const prefix =
    currentContents.length > 0 && !currentContents.endsWith("\n")
      ? `${currentContents}\n`
      : currentContents;
  return {
    contents: ensureTrailingNewline(`${prefix}\n${newBlock}\n`),
    changed: true,
  };
}

export function removeZshenvBlock(currentContents: string): {
  contents: string;
  changed: boolean;
} {
  const existing = extractZshenvBlock(currentContents);
  if (!existing.found) return { contents: currentContents, changed: false };
  const before = currentContents.slice(0, existing.startIndex);
  const after = currentContents.slice(existing.endIndex);
  // Trim a single leading newline from `after` so we don't leave a double
  // blank line behind. Preserve user content otherwise.
  const trimmedAfter = after.startsWith("\n") ? after.slice(1) : after;
  const trimmedBefore = before.endsWith("\n\n") ? before.slice(0, -1) : before;
  return { contents: trimmedBefore + trimmedAfter, changed: true };
}

export interface ZshenvWriteResult {
  changed: boolean;
  status: "updated" | "unchanged" | "skipped";
  message: string;
}

interface ExtractedBlock {
  found: boolean;
  startIndex: number;
  endIndex: number;
  block: string;
}

function extractZshenvBlock(contents: string): ExtractedBlock {
  const begin = contents.indexOf(SENTINEL_BEGIN);
  if (begin === -1) return { found: false, startIndex: 0, endIndex: 0, block: "" };
  const endMarker = contents.indexOf(SENTINEL_END, begin);
  if (endMarker === -1) {
    // Malformed: begin without end. Treat as not found so the orchestrator
    // can decide whether to surface a warning rather than silently strip
    // user content.
    return { found: false, startIndex: 0, endIndex: 0, block: "" };
  }
  const endIndex = endMarker + SENTINEL_END.length;
  return {
    found: true,
    startIndex: begin,
    endIndex,
    block: contents.slice(begin, endIndex),
  };
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

/**
 * Safely apply the sentinel-guarded NODE_EXTRA_CA_CERTS block to ~/.zshenv.
 *
 * This opens the file first and then reads/writes through the same file
 * descriptor. On platforms that expose O_NOFOLLOW, symlinked paths fail at
 * open time. If that flag is unavailable, fall back to an lstat preflight and
 * skip suspicious paths rather than writing through a symlink target.
 */
export function writeZshenvBlockSafely(zshenvPath: string, bundlePath: string): ZshenvWriteResult {
  const noFollowFlag = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  if (noFollowFlag === 0) {
    try {
      const linkStats = lstatSync(zshenvPath);
      if (linkStats.isSymbolicLink()) {
        return {
          changed: false,
          status: "skipped",
          message: `${zshenvPath} is a symlink; skipped automatic update. Add this block manually if you trust the target:\n${buildZshenvBlock(bundlePath)}`,
        };
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        return {
          changed: false,
          status: "skipped",
          message: `Skipped ${zshenvPath}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  }

  let fd: number | undefined;
  try {
    fd = openSync(zshenvPath, constants.O_RDWR | constants.O_CREAT | noFollowFlag, 0o600);
    const stats = fstatSync(fd);
    if (!stats.isFile()) {
      return {
        changed: false,
        status: "skipped",
        message: `${zshenvPath} is not a regular file; skipped automatic update.`,
      };
    }

    const current = readFileSync(fd, "utf8");
    const next = applyZshenvBlock(current, bundlePath);
    if (!next.changed) {
      return {
        changed: false,
        status: "unchanged",
        message: `${zshenvPath} already had the current block (no change).`,
      };
    }

    ftruncateSync(fd, 0);
    writeSync(fd, next.contents, 0, "utf8");
    fsyncSync(fd);
    return { changed: true, status: "updated", message: `Updated ${zshenvPath}` };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const reason = error instanceof Error ? error.message : String(error);
    if (code === "ELOOP") {
      return {
        changed: false,
        status: "skipped",
        message: `${zshenvPath} is a symlink; skipped automatic update. Add this block manually if you trust the target:\n${buildZshenvBlock(bundlePath)}`,
      };
    }
    return {
      changed: false,
      status: "skipped",
      message: `Failed to update ${zshenvPath}: ${reason}`,
    };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Best-effort close after a user-facing shell config update.
      }
    }
  }
}

/**
 * Write a LaunchAgent plist with mode 0644 and ensure the parent
 * directory exists. Atomic via tmp + rename so a partial write doesn't
 * confuse `launchctl bootstrap` on the next boot.
 */
export async function writeLaunchAgentPlist(plistPath: string, plistXml: string): Promise<void> {
  const dir = path.dirname(plistPath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${plistPath}.${process.pid}.tmp`;
  writeFileSync(tmp, plistXml, { encoding: "utf8", mode: 0o644 });
  try {
    chmodSync(tmp, 0o644);
  } catch {
    // ignore \u2014 best effort
  }
  const fs = await import("node:fs/promises");
  await fs.rename(tmp, plistPath);
}

/**
 * Best-effort load the LaunchAgent so the env var takes effect for new
 * GUI launches without requiring a logout/login. Returns the launchctl
 * command output for diagnostics. Soft-fails when launchctl isn't on
 * PATH (CI runners) so the rest of the apply still completes.
 */
export function loadLaunchAgent(plistPath: string): {
  ok: boolean;
  command: string;
  output: string;
} {
  const uid = process.getuid?.() ?? 0;
  const target = `gui/${uid}`;
  const command = `launchctl bootstrap ${target} ${plistPath}`;
  try {
    const out = execFileSync("launchctl", ["bootstrap", target, plistPath], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 4_000,
    });
    return { ok: true, command, output: out.toString().trim() };
  } catch (error) {
    // launchctl bootstrap returns non-zero when the agent is already
    // loaded. Fall back to a `kickstart -k` to refresh it; if that fails
    // too, return the original error message for the user to inspect.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already loaded") || message.includes("Bootstrap failed: 17")) {
      try {
        execFileSync("launchctl", ["kickstart", "-k", `${target}/${LAUNCH_AGENT_LABEL}`], {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 4_000,
        });
        return {
          ok: true,
          command,
          output: "Agent was already loaded; refreshed via launchctl kickstart.",
        };
      } catch {
        // fall through
      }
    }
    return { ok: false, command, output: message };
  }
}
