/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Production alias editor for `/sf-guardrail aliases`.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GuardrailConfig } from "./types.ts";
import { productionAliasesText, updateProductionAliasesFromText } from "./preferences.ts";

export async function openProductionAliasesEditor(
  ctx: ExtensionContext,
  config: GuardrailConfig,
): Promise<void> {
  const current = productionAliasesText(config);

  if (!ctx.hasUI) {
    console.info(
      [
        "SF Guardrail production aliases require an interactive Pi UI or RPC UI client to edit.",
        `Current aliases: ${current || "(none)"}`,
        "Use /sf-guardrail settings in interactive mode to edit common preferences.",
      ].join("\n"),
    );
    return;
  }

  const value = await ctx.ui.input(
    "SF Guardrail production aliases (comma-separated). Leave blank to clear.",
    current,
  );
  if (value === undefined) return;

  const aliases = updateProductionAliasesFromText(value);
  ctx.ui.notify(
    aliases.length > 0
      ? `SF Guardrail production aliases: ${aliases.join(", ")}`
      : "SF Guardrail production aliases cleared.",
    "info",
  );
}
