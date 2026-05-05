/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Standard no-args `/sf-llm-gateway-internal` status & controls panel.
 *
 * Uses the shared SF Pi grouped command panel so long descriptions do not clip
 * and actions are scanable by section.
 */
import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { type CommandPanelAction, openCommandPanel } from "../../../lib/common/command-panel.ts";
import {
  describeApiKey,
  describeConfigValue,
  getGatewayConfig,
  getSavedExclusiveScopeStatus,
  PROVIDER_NAME,
} from "./config.ts";
import type { GatewayRuntimeStatusState } from "./status.ts";
import { formatTokens, formatUsd } from "./models.ts";
import { GATEWAY_COMMAND_SURFACE, type GatewayPanelAction } from "./command-surface.ts";

export interface GatewayPanelOptions {
  providerRegistered: boolean;
  runtimeState: GatewayRuntimeStatusState;
  scope: "global" | "project";
}

export async function openGatewayPanel(
  ctx: ExtensionCommandContext,
  options: GatewayPanelOptions,
): Promise<GatewayPanelAction | null> {
  return openCommandPanel(ctx, {
    title: "⚡ SF LLM Gateway Internal — status & controls",
    statusLines: buildGatewayPanelStatusLines(ctx, options, ctx.ui.theme),
    actions: buildGatewayGroupedActionItems(options.scope),
    closeValue: "close",
  });
}

export function buildGatewayPanelStatusLines(
  ctx: ExtensionCommandContext,
  options: GatewayPanelOptions,
  theme: Theme,
): string[] {
  const config = getGatewayConfig(ctx.cwd);
  const savedScope = getSavedExclusiveScopeStatus(ctx.cwd);
  const activeModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none";
  const contextUsage = ctx.getContextUsage();

  return [
    renderStatusLine(
      theme,
      config.enabled && options.providerRegistered ? "ok" : config.enabled ? "warn" : "bad",
      "Provider",
      `${config.enabled ? "enabled" : "disabled"} · ${options.providerRegistered ? "registered" : "not registered"}`,
    ),
    renderStatusLine(
      theme,
      config.baseUrl ? "ok" : "warn",
      "Base URL",
      describeConfigValue(config.baseUrl, config.baseUrlSource),
    ),
    renderStatusLine(
      theme,
      config.apiKey ? "ok" : "warn",
      "API key",
      describeApiKey(config.apiKey, config.apiKeySource),
    ),
    renderStatusLine(
      theme,
      activeModel.startsWith(`${PROVIDER_NAME}/`) ? "ok" : "warn",
      "Active model",
      activeModel,
    ),
    renderStatusLine(
      theme,
      "info",
      "Context",
      contextUsage
        ? `${formatTokens(contextUsage.tokens)} / ${formatTokens(contextUsage.contextWindow)}`
        : "unknown",
    ),
    renderStatusLine(
      theme,
      options.runtimeState.monthlyUsage
        ? "ok"
        : options.runtimeState.monthlyUsageError
          ? "warn"
          : "info",
      "Usage",
      options.runtimeState.monthlyUsage
        ? `${formatUsd(options.runtimeState.monthlyUsage.spend)} monthly spend`
        : (options.runtimeState.monthlyUsageError ?? "not loaded yet"),
    ),
    renderStatusLine(
      theme,
      options.runtimeState.health ? "ok" : options.runtimeState.healthError ? "warn" : "info",
      "Health",
      options.runtimeState.health?.status ?? options.runtimeState.healthError ?? "not checked yet",
    ),
    renderStatusLine(
      theme,
      "info",
      "Panel scope",
      `${options.scope} · scoped model mode ${config.exclusiveScope ? "exclusive" : "additive"} · saved fallback effective=${savedScope.effective}`,
    ),
  ];
}

// Exported for unit tests.
export function buildGatewayGroupedActionItems(
  scope: "global" | "project",
): CommandPanelAction<GatewayPanelAction>[] {
  const items: CommandPanelAction<GatewayPanelAction>[] = [
    {
      value: "switch-scope",
      label: `Switch to ${scope === "global" ? "project" : "global"} scope`,
      description: `Current action scope is ${scope}; setup/on/off/set-default use this scope, then return here.`,
      group: "Scope",
    },
  ];

  for (const item of GATEWAY_COMMAND_SURFACE) {
    items.push({
      value: item.id,
      label: item.acceptsScope ? `${item.label} [${scope}]` : item.label,
      description: item.description,
      group: item.section,
    });
  }

  items.push({
    value: "close",
    label: "Close",
    description: "Dismiss this panel.",
    group: "Reference",
  });

  return items;
}

export function renderStatusLine(
  theme: Theme,
  state: "ok" | "warn" | "bad" | "info",
  label: string,
  detail: string,
): string {
  const marker =
    state === "ok"
      ? theme.fg("success", "✓")
      : state === "warn"
        ? theme.fg("warning", "◐")
        : state === "bad"
          ? theme.fg("error", "✗")
          : theme.fg("dim", "•");
  const paddedLabel = label.padEnd(14, " ");
  return `${marker} ${theme.fg("text", paddedLabel)} ${theme.fg(state === "bad" ? "warning" : "dim", detail)}`;
}
