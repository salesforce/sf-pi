/* SPDX-License-Identifier: Apache-2.0 */
/** Shared Manager Surface action discovery for extension-owned detail actions. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export const SF_PI_MANAGER_ACTIONS_EVENT = "sf-pi-manager:actions";

export interface ManagerDetailAction {
  id: string;
  label: string;
  description: string;
  run(ctx: ExtensionCommandContext): Promise<void> | void;
}

export interface ManagerDetailActionsRequest {
  extensionId: string;
  actions: ManagerDetailAction[];
}

export function registerManagerDetailActions(
  pi: Pick<ExtensionAPI, "events">,
  extensionId: string,
  actions: ManagerDetailAction[],
): void {
  pi.events.on(SF_PI_MANAGER_ACTIONS_EVENT, (request: ManagerDetailActionsRequest) => {
    if (request.extensionId !== extensionId) return;
    request.actions.push(...actions);
  });
}

export function collectManagerDetailActions(
  pi: Pick<ExtensionAPI, "events">,
  extensionId: string,
): ManagerDetailAction[] {
  const request: ManagerDetailActionsRequest = { extensionId, actions: [] };
  pi.events.emit(SF_PI_MANAGER_ACTIONS_EVENT, request);
  return request.actions;
}

export async function runCollectedManagerDetailAction(
  pi: Pick<ExtensionAPI, "events">,
  extensionId: string,
  actionId: string,
  ctx: ExtensionCommandContext,
): Promise<boolean> {
  const action = collectManagerDetailActions(pi, extensionId).find(
    (candidate) => candidate.id === actionId,
  );
  if (!action) return false;
  await action.run(ctx);
  return true;
}
