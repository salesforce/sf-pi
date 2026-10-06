/* SPDX-License-Identifier: Apache-2.0 */
/** Command orchestration for focused dedicated-compaction setup. */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  GatewayCompactionSetupComponent,
  type GatewayCompactionSetupResult,
} from "./compaction-setup-panel.ts";
import { buildGatewayCompactionModelOptions } from "./compaction-settings.ts";
import {
  publishGatewayCompactionStatus,
  resolveGatewayCompactionStatus,
} from "./compaction-status.ts";
import { FRIENDLY_COMMAND_NAME, PROVIDER_NAME } from "./config.ts";

export interface GatewayCompactionSetupCommandOutput {
  summary: string;
  details: string;
  level: "info" | "warning";
}

export async function runGatewayCompactionSetup(
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
): Promise<GatewayCompactionSetupCommandOutput | undefined> {
  if (scope === "project" && !ctx.isProjectTrusted()) {
    return {
      summary: "Project compaction settings require a trusted project.",
      details: "Trust this project or run /sf-llm-gateway compaction global.",
      level: "warning",
    };
  }

  const availableModels = ctx.modelRegistry.getAvailable();
  const options = buildGatewayCompactionModelOptions(availableModels);
  if (!ctx.hasUI) {
    const status = resolveGatewayCompactionStatus(ctx.cwd, availableModels, ctx.isProjectTrusted());
    return {
      summary: "Dedicated compaction setup needs Pi UI.",
      details: [
        `Current status: ${status.kind}`,
        `Run /${FRIENDLY_COMMAND_NAME} compaction ${scope} in interactive Pi.`,
      ].join("\n"),
      level: "warning",
    };
  }
  if (options.length === 0) {
    return {
      summary: "No cached Gateway models are available for dedicated compaction.",
      details: `Authenticate with /login ${PROVIDER_NAME}, then run /${FRIENDLY_COMMAND_NAME} refresh before retrying.`,
      level: "warning",
    };
  }

  const result = await ctx.ui.custom<GatewayCompactionSetupResult | undefined>(
    (_tui, theme, _keybindings, done) =>
      new GatewayCompactionSetupComponent(theme, scope, ctx.cwd, done, options),
    {
      overlay: true,
      overlayOptions: () => ({ anchor: "center" as const, width: "70%", minWidth: 72 }),
    },
  );
  if (!result) return undefined;

  publishGatewayCompactionStatus(ctx.cwd, availableModels, ctx.isProjectTrusted());
  const selected = options.find((option) => option.value === result.configuredModel);
  return {
    summary: "Dedicated compaction configured.",
    details: [
      `- Scope: ${scope}`,
      `- Model: ${selected?.label ?? result.configuredModel}`,
      "- Automatic compaction: enabled",
      "- Active chat model: unchanged",
    ].join("\n"),
    level: "info",
  };
}
