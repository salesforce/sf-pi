/* SPDX-License-Identifier: Apache-2.0 */
/** Active-branch projection for mutable extension-owned context messages. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface CustomMessageLike {
  role?: unknown;
  customType?: unknown;
}

/**
 * Keep only the latest message for each tracked custom type.
 *
 * Pi has already projected the active branch and compaction window before the
 * `context` event. This function only removes superseded model-visible custom
 * messages; unrelated messages and state/audit data remain untouched.
 */
export function registerLatestContextProjection(
  pi: Pick<ExtensionAPI, "on">,
  customTypes: readonly string[],
  includeLatest: (customType: string) => boolean = () => true,
): void {
  pi.on("context", (event) => {
    const messages = projectLatestCustomMessages(event.messages, customTypes, includeLatest);
    if (messages.length === event.messages.length) return undefined;
    return { messages };
  });
}

export function projectLatestCustomMessages<T>(
  messages: readonly T[],
  customTypes: readonly string[],
  includeLatest: (customType: string) => boolean = () => true,
): T[] {
  const tracked = new Set(customTypes);
  const latestIndex = new Map<string, number>();

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i] as CustomMessageLike;
    if (
      message?.role === "custom" &&
      typeof message.customType === "string" &&
      tracked.has(message.customType)
    ) {
      latestIndex.set(message.customType, i);
    }
  }

  return messages.filter((message, index) => {
    const candidate = message as CustomMessageLike;
    if (
      candidate?.role !== "custom" ||
      typeof candidate.customType !== "string" ||
      !tracked.has(candidate.customType)
    ) {
      return true;
    }
    if (latestIndex.get(candidate.customType) !== index) return false;
    return includeLatest(candidate.customType);
  });
}
