/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Small host-neutral equivalents of Pi SDK convenience helpers.
 *
 * Oh My Pi's legacy Pi module shim intentionally exposes a narrower runtime
 * surface than current Pi. Keep these stable, trivial helpers local so sf-pi
 * can run on either host without importing symbols that OMP does not export.
 */
import { realpath } from "node:fs/promises";
import path from "node:path";
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";

export function isEditToolResult(event: ToolResultEvent): boolean {
  return event.toolName === "edit";
}

export function isWriteToolResult(event: ToolResultEvent): boolean {
  return event.toolName === "write";
}

export interface ParsedSkillBlock {
  name: string;
  location: string;
  content: string;
  userMessage?: string;
}

export function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const match = text.match(
    /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/,
  );
  if (!match) return null;
  return {
    name: match[1]!,
    location: match[2]!,
    content: match[3]!,
    userMessage: match[4]?.trim() || undefined,
  };
}

export interface ResizedImageDimensions {
  wasResized: boolean;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
}

export function formatDimensionNote(result: ResizedImageDimensions): string | undefined {
  if (!result.wasResized) return undefined;
  const scale = result.originalWidth / result.width;
  return `[Image: original ${result.originalWidth}x${result.originalHeight}, displayed at ${result.width}x${result.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`;
}

const fileMutationQueues = new Map<string, Promise<void>>();
let registrationQueue: Promise<void> = Promise.resolve();

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

async function mutationQueueKey(filePath: string): Promise<string> {
  const resolvedPath = path.resolve(filePath);
  try {
    return await realpath(resolvedPath);
  } catch (error) {
    if (isMissingPathError(error)) return resolvedPath;
    throw error;
  }
}

/** Serialize mutations to the same file while allowing different files in parallel. */
export async function withFileMutationQueue<T>(
  filePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const registration = registrationQueue.then(async () => {
    const key = await mutationQueueKey(filePath);
    const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();
    let releaseNext!: () => void;
    const nextQueue = new Promise<void>((resolve) => {
      releaseNext = resolve;
    });
    const chainedQueue = currentQueue.then(() => nextQueue);
    fileMutationQueues.set(key, chainedQueue);
    return { key, currentQueue, chainedQueue, releaseNext };
  });
  registrationQueue = registration.then(
    () => undefined,
    () => undefined,
  );

  const { key, currentQueue, chainedQueue, releaseNext } = await registration;
  await currentQueue;
  try {
    return await operation();
  } finally {
    releaseNext();
    if (fileMutationQueues.get(key) === chainedQueue) fileMutationQueues.delete(key);
  }
}
