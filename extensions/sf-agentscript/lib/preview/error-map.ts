/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Compatibility shim — the real implementation lives at
 * `lib/errors/agent-api-error-map.ts`. The lifecycle and preview
 * surfaces share the map; the file was promoted out of `preview/` to
 * make that ownership obvious. See docs/POSTMORTEM_E2E_DEMO.md.
 *
 * Existing call sites (`lib/preview/client.ts`) keep working via the
 * `mapPreviewError` alias and the `PreviewErrorContext` re-export. New
 * code should import from `lib/errors/agent-api-error-map.ts` directly.
 */

export {
  mapAgentApiError as mapPreviewError,
  type AgentApiErrorContext as PreviewErrorContext,
  type MappedAgentApiError as MappedPreviewError,
} from "../errors/agent-api-error-map.ts";
