/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver for `placeholder://X` — author-time stub.
 *
 * The agentscript compiler already emits a warning when a `target:` URI
 * uses the `placeholder://` scheme, telling the author to replace it
 * before committing. We mirror that by returning an empty Set so every
 * placeholder counts as `missing` — pre-flight blocks publish until the
 * stub is replaced with a real implementation.
 */

import type { TargetResolver } from "../types.ts";

export const placeholderResolver: TargetResolver = {
  schemes: ["placeholder"],
  metadataLabel: "Placeholder (compiler stub)",
  async resolve() {
    // Always missing — blocks publish on stub URIs.
    return new Set<string>();
  },
  fixHint(name) {
    return `Replace placeholder://${name} with a real target (flow:// / apex:// / etc.) before publishing.`;
  },
};
