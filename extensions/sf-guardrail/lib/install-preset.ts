/* SPDX-License-Identifier: Apache-2.0 */
/**
 * `install-preset` flow — writes the bundled defaults to the user's override
 * file so they can edit it without re-deriving the schema from docs.
 *
 * Merge strategy:
 *   - If `<globalAgentDir>/sf-guardrail/rules.json` does not exist → write it
 *     verbatim from the bundled defaults.
 *   - If it exists → load it, and for every rule id present in the bundled
 *     set, ask the user whether to keep-user / replace-with-bundled / skip.
 *     Then write the merged result back.
 *
 * The command is a deliberate sidestep around the "silent overwrite" foot-gun
 * that @aliou's settings command avoids by editing in place. Because we ship
 * an opinionated default set, a blind overwrite would clobber any user tweaks.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import { readBundledConfig, userConfigPath } from "./config.ts";
import type { GuardrailConfig } from "./types.ts";

export async function installPreset(ctx: ExtensionContext): Promise<void> {
  const bundled = readBundledConfig();
  const targetPath = userConfigPath();

  if (!existsSync(targetPath)) {
    writeJson(targetPath, bundled);
    ctx.ui.notify(`Installed sf-guardrail preset to ${targetPath}.`, "info");
    return;
  }

  // File exists — parse it, reconcile by id.
  let existing: Partial<GuardrailConfig>;
  try {
    existing = JSON.parse(readFileSync(targetPath, "utf8"));
  } catch (err) {
    ctx.ui.notify(
      `Existing ${targetPath} is not valid JSON (${(err as Error).message}). Aborting install.`,
      "error",
    );
    return;
  }

  if (!ctx.hasUI) {
    ctx.ui.notify(
      `sf-guardrail install-preset requires interactive mode to reconcile existing rules.`,
      "warning",
    );
    return;
  }

  const merged = await reconcile(ctx, bundled, existing);
  if (!merged) {
    ctx.ui.notify("sf-guardrail install-preset cancelled.", "info");
    return;
  }

  writeJson(targetPath, merged);
  ctx.ui.notify(`Updated ${targetPath}.`, "info");
}

async function reconcile(
  ctx: ExtensionContext,
  bundled: GuardrailConfig,
  existing: Partial<GuardrailConfig>,
): Promise<GuardrailConfig | undefined> {
  const out: GuardrailConfig = JSON.parse(JSON.stringify(bundled));

  // Scalars: keep user's values if present.
  if (typeof existing.enabled === "boolean") out.enabled = existing.enabled;
  if (existing.features) out.features = { ...out.features, ...existing.features };
  if (Array.isArray(existing.productionAliases)) out.productionAliases = existing.productionAliases;
  if (typeof existing.confirmTimeoutMs === "number")
    out.confirmTimeoutMs = existing.confirmTimeoutMs;
  if (typeof existing.headlessEscapeHatchEnv === "string")
    out.headlessEscapeHatchEnv = existing.headlessEscapeHatchEnv;

  out.policies.rules = await reconcileList(
    ctx,
    "policy",
    bundled.policies.rules,
    existing.policies?.rules ?? [],
  );
  out.commandGate.patterns = await reconcileList(
    ctx,
    "command-gate",
    bundled.commandGate.patterns,
    existing.commandGate?.patterns ?? [],
  );
  out.orgAwareGate.rules = await reconcileList(
    ctx,
    "org-aware",
    bundled.orgAwareGate.rules,
    existing.orgAwareGate?.rules ?? [],
  );

  return out;
}

async function reconcileList<T extends { id: string }>(
  ctx: ExtensionContext,
  label: string,
  bundled: T[],
  existing: T[],
): Promise<T[]> {
  const byId = new Map<string, T>();
  for (const rule of existing) byId.set(rule.id, rule);

  for (const rule of bundled) {
    const user = byId.get(rule.id);
    if (!user) {
      byId.set(rule.id, rule);
      continue;
    }
    if (JSON.stringify(user) === JSON.stringify(rule)) continue;
    const choice = await ctx.ui.select(`Reconcile ${label} rule "${rule.id}"`, [
      "Keep my version",
      "Replace with bundled",
      "Skip (leave as-is)",
    ]);
    if (choice === "Replace with bundled") byId.set(rule.id, rule);
    // Keep / Skip / Esc → leave user's version
  }

  return [...byId.values()];
}

function writeJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}
