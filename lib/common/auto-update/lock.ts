/* SPDX-License-Identifier: Apache-2.0 */
/** Atomic machine-scoped lock preventing overlapping Auto Update runs. */
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { AUTO_UPDATE_STALE_RUNNING_MS, autoUpdateStatusPath } from "./store.ts";

export interface AutoUpdateLock {
  release(): void;
}

export function autoUpdateLockPath(): string {
  return path.join(path.dirname(autoUpdateStatusPath()), "run.lock");
}

export function tryAcquireAutoUpdateLock(now: number = Date.now()): AutoUpdateLock | undefined {
  const lockPath = autoUpdateLockPath();
  mkdirSync(path.dirname(lockPath), { recursive: true });

  let fd = tryOpenLock(lockPath);
  if (fd === undefined && isStaleLock(lockPath, now)) {
    try {
      unlinkSync(lockPath);
    } catch {
      return undefined;
    }
    fd = tryOpenLock(lockPath);
  }
  if (fd === undefined) return undefined;

  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  } catch (error) {
    closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try {
        const owned = fstatSync(fd);
        const current = statSync(lockPath);
        if (owned.dev === current.dev && owned.ino === current.ino) unlinkSync(lockPath);
      } catch {
        // Another cleanup path already removed the lock.
      } finally {
        closeSync(fd);
      }
    },
  };
}

function tryOpenLock(lockPath: string): number | undefined {
  try {
    return openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (isAlreadyExists(error)) return undefined;
    throw error;
  }
}

function isStaleLock(lockPath: string, now: number): boolean {
  try {
    return now - statSync(lockPath).mtimeMs >= AUTO_UPDATE_STALE_RUNNING_MS;
  } catch {
    return false;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}
