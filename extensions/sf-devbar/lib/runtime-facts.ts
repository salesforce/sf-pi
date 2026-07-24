/* SPDX-License-Identifier: Apache-2.0 */
/** Public Pi runtime facts consumed by the DevBar renderer. */
import type { ContextUsage } from "@earendil-works/pi-coding-agent";

export interface DevbarRuntimeFacts {
  contextWindow?: number;
  contextPercent: number | null | undefined;
  sessionName?: string;
}

export function toDevbarRuntimeFacts(
  contextUsage: ContextUsage | undefined,
  sessionName: string | undefined,
): DevbarRuntimeFacts {
  return {
    contextWindow: contextUsage?.contextWindow,
    contextPercent: contextUsage?.percent,
    sessionName,
  };
}
