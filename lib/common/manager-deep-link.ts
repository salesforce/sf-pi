/* SPDX-License-Identifier: Apache-2.0 */
/** Shared event contract for opening the SF Pi Manager from extension commands. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export const SF_PI_MANAGER_OPEN_EVENT = "sf-pi-manager:open";

export type SfPiManagerOpenRoute = {
  extensionId?: string;
  view?: "detail" | "settings";
};

export type SfPiManagerOpenRequest = {
  ctx: ExtensionCommandContext;
  route?: SfPiManagerOpenRoute;
  accept?: () => void;
  resolve?: () => void;
  reject?: (error: unknown) => void;
};

export async function openExtensionInManager(
  pi: Pick<ExtensionAPI, "events">,
  ctx: ExtensionCommandContext,
  route: SfPiManagerOpenRoute,
): Promise<boolean> {
  let accepted = false;
  const result = new Promise<void>((resolve, reject) => {
    const request: SfPiManagerOpenRequest = {
      ctx,
      route,
      accept: () => {
        accepted = true;
      },
      resolve,
      reject,
    };
    pi.events.emit(SF_PI_MANAGER_OPEN_EVENT, request);
  });

  if (!accepted) return false;
  await result;
  return true;
}
