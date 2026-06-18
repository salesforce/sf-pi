/* SPDX-License-Identifier: Apache-2.0 */
/** Shared Manager Surface action discovery for extension-owned detail actions. */
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import type { ConfigPanelResult } from "../../catalog/registry.ts";

export const SF_PI_MANAGER_ACTIONS_EVENT = "sf-pi-manager:actions";

export type ManagerDetailActionPanel = Component &
  Focusable & {
    renderContent?: (width: number) => string[];
  };

export type ManagerDetailActionPanelFactory = (
  theme: Theme,
  cwd: string,
  scope: "global" | "project",
  done: (result: ConfigPanelResult | undefined) => void,
  ctx: ExtensionCommandContext,
  tui: TUI,
) => ManagerDetailActionPanel;

export interface ManagerDetailAction {
  id: string;
  label: string;
  description: string;
  run(ctx: ExtensionCommandContext): Promise<void> | void;
  /** Optional drill-down page for interactive actions that collect input. */
  createPanel?: ManagerDetailActionPanelFactory;
  /** Close the Manager before running this action. Use for actions that open their own full-screen UI. */
  closeBeforeRun?: boolean;
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
