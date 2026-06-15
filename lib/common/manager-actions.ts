/* SPDX-License-Identifier: Apache-2.0 */
/** Shared Manager Surface action registry for extension-owned detail actions. */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export interface ManagerDetailAction {
  id: string;
  label: string;
  description: string;
  run(ctx: ExtensionCommandContext): Promise<void> | void;
}

const actionsByExtension = new Map<string, ManagerDetailAction[]>();

export function registerManagerDetailActions(
  extensionId: string,
  actions: ManagerDetailAction[],
): void {
  actionsByExtension.set(extensionId, [...actions]);
}

export function getManagerDetailActions(extensionId: string): ManagerDetailAction[] {
  return [...(actionsByExtension.get(extensionId) ?? [])];
}

export async function runManagerDetailAction(
  extensionId: string,
  actionId: string,
  ctx: ExtensionCommandContext,
): Promise<boolean> {
  const action = actionsByExtension
    .get(extensionId)
    ?.find((candidate) => candidate.id === actionId);
  if (!action) return false;
  await action.run(ctx);
  return true;
}
