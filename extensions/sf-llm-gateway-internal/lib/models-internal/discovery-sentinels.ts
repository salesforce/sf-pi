/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Non-callable model IDs that can appear in LiteLLM discovery responses.
 *
 * These values describe access/listing state, not models that Pi can call.
 * Keep them out of the registered provider catalog and discovery cache so a
 * transient proxy-side listing regression cannot replace the bootstrap catalog
 * with a dead selector entry.
 */
const NON_CALLABLE_DISCOVERY_MODEL_IDS = new Set(["no-default-models"]);

export function isCallableDiscoveredModelId(id: string): boolean {
  return !NON_CALLABLE_DISCOVERY_MODEL_IDS.has(id);
}

export function hasNonCallableDiscoveredModelIds(ids: readonly string[]): boolean {
  return ids.some((id) => !isCallableDiscoveredModelId(id));
}

export function filterCallableDiscoveredModelIds(ids: readonly string[]): string[] {
  return ids.filter(isCallableDiscoveredModelId);
}
