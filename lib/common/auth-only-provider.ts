/* SPDX-License-Identifier: Apache-2.0 */
/** Build a Pi Provider that owns authentication but exposes no models. */
import type { Provider, ProviderAuth } from "@earendil-works/pi-ai";

export function createAuthOnlyProvider(input: {
  id: string;
  name: string;
  auth: ProviderAuth;
}): Provider {
  const unavailable = (): never => {
    throw new Error(`Authentication-only provider ${input.id} cannot stream model requests.`);
  };

  return {
    id: input.id,
    name: input.name,
    auth: input.auth,
    getModels: () => [],
    stream: unavailable,
    streamSimple: unavailable,
  };
}
