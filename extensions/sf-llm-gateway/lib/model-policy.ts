/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Non-configurable model-family policy for the SF LLM Gateway provider.
 *
 * xAI Grok models must never be listed or callable through this provider. The
 * rule is intentionally not a setting: there is no preference, environment
 * variable, or command that re-enables it. It applies only to the
 * sf-llm-gateway provider; other Pi providers are outside this extension's
 * authority.
 *
 * Enforcement points (all in lib/provider.ts):
 * - fresh discovery never publishes or caches a refused ID;
 * - restored offline catalogs are filtered by getModels();
 * - every stream entry point refuses a refused ID before any network call.
 */
import { getModelFamily } from "./models.ts";

// Checked directly, not only through getModelFamily(), so an ID that also
// matches an earlier family rule (for example a "grok-codex" alias) is still
// refused.
export function isGatewayModelIdAllowed(id: string): boolean {
  const lower = id.toLowerCase();
  if (lower.includes("grok") || lower.startsWith("xai/")) return false;
  return getModelFamily(id) !== "xai";
}

export function gatewayModelPolicyRefusal(id: string): string {
  return `Model ${id} is not available through the SF LLM Gateway. xAI Grok models are not permitted on this provider; choose a different model.`;
}
