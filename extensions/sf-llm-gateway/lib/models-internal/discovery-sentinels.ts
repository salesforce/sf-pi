/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Non-callable model IDs that can appear in LiteLLM discovery responses.
 *
 * These values describe access/listing state, not models that Pi can call.
 * Keep them out of the registered provider catalog and discovery cache. A
 * sentinel-only result is handled separately as an authoritative empty-access
 * state; mixed results retain their callable peers.
 */
export const NO_DEFAULT_MODELS_SENTINEL = "no-default-models";

const NON_CALLABLE_DISCOVERY_MODEL_IDS = new Set([NO_DEFAULT_MODELS_SENTINEL]);

export function isCallableDiscoveredModelId(id: string): boolean {
  return !NON_CALLABLE_DISCOVERY_MODEL_IDS.has(id);
}

/**
 * Sentinel-only discovery is an explicit access-empty result, not a transport
 * failure. Publishing an empty catalog prevents last-known models that may no
 * longer be authorized from remaining selectable. An ordinary empty response
 * without this sentinel stays ambiguous and must retain the previous catalog.
 */
export function isNoDefaultModelsAccessState(
  callableIds: readonly string[],
  filteredIds: readonly string[],
): boolean {
  return callableIds.length === 0 && filteredIds.includes(NO_DEFAULT_MODELS_SENTINEL);
}

/** Parse a model-discovery response without treating mixed sentinel/peer results as access-empty. */
export function isNoDefaultModelsOnlyDiscoveryPayload(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(parsed.data)) return false;
    const ids = parsed.data
      .map((entry) => (typeof entry?.id === "string" ? entry.id.trim() : ""))
      .filter(Boolean);
    return (
      ids.includes(NO_DEFAULT_MODELS_SENTINEL) &&
      ids.filter(isCallableDiscoveredModelId).length === 0
    );
  } catch {
    return false;
  }
}

export function hasNonCallableDiscoveredModelIds(ids: readonly string[]): boolean {
  return ids.some((id) => !isCallableDiscoveredModelId(id));
}

export function filterCallableDiscoveredModelIds(ids: readonly string[]): string[] {
  return ids.filter(isCallableDiscoveredModelId);
}
