/* SPDX-License-Identifier: Apache-2.0 */
/** Explicit scoped priority preference command; never invokes the Gateway. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { emitHumanOnlyCommandOutput } from "../../../lib/common/human-only-command-output.ts";
import { readEffectivePrioritySettings, writeScopedPriority } from "./priority-settings.ts";
import { PROVIDER_NAME } from "./config.ts";

export async function handlePriorityCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: string[],
): Promise<void> {
  const action = (args[0] ?? "status").toLowerCase();
  const scope = (args[1] ?? "global").toLowerCase();
  if (
    !["on", "off", "reset", "status"].includes(action) ||
    !["global", "project"].includes(scope) ||
    args.length > 2 ||
    (action === "status" && args.length > 1)
  ) {
    await emitPriorityOutput(
      pi,
      ctx,
      "Invalid priority arguments.",
      "Usage: /sf-llm-gateway priority [status|on|off|reset] [global|project]",
      "warning",
    );
    return;
  }
  if (action !== "status") {
    if (scope === "project" && !ctx.isProjectTrusted()) {
      await emitPriorityOutput(
        pi,
        ctx,
        "Priority preference not saved.",
        "Trust this project before changing project preferences.",
        "warning",
      );
      return;
    }
    writeScopedPriority(
      ctx.cwd,
      scope as "global" | "project",
      action === "reset" ? undefined : action === "on",
    );
  }
  const effective = readEffectivePrioritySettings(ctx.cwd, undefined, ctx.isProjectTrusted());
  await emitPriorityOutput(
    pi,
    ctx,
    "SF LLM Gateway priority requests",
    [
      ...(action === "status"
        ? []
        : [
            `${action === "reset" ? "Removed override" : "Saved preference"} in ${scope} settings.`,
          ]),
      `Priority requests: ${effective.enabled ? "ON" : "OFF"} (${effective.source}).`,
      `Eligible Gateway Responses requests will request the ${effective.enabled ? "priority" : "default"} tier.`,
      "Applies to subsequent requests; no restart required. Priority may carry higher charges; the requested tier does not prove the effective tier or price.",
    ].join("\n"),
    "info",
  );
}

async function emitPriorityOutput(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  title: string,
  body: string,
  severity: "info" | "warning",
): Promise<void> {
  await emitHumanOnlyCommandOutput(pi, ctx, PROVIDER_NAME, { title, body, severity });
}
