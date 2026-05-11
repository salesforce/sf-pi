/* SPDX-License-Identifier: Apache-2.0 */
/**
 * URI parsing for action targets. Extracted so resolvers and tests can
 * share one parser.
 */

import type { ComponentSummary } from "../inspect.ts";
import type { ActionTarget } from "./types.ts";

const URI_RE = /^([a-zA-Z][a-zA-Z0-9_-]*):\/\/(.+)$/;

/**
 * Parse `target:` strings into ActionTarget records. Skips entries whose
 * target is missing, malformed, or doesn't match the `<scheme>://<name>`
 * shape. Designed to never throw.
 */
export function extractActionTargets(actions: readonly ComponentSummary[]): ActionTarget[] {
  const out: ActionTarget[] = [];
  for (const a of actions) {
    if (!a?.target) continue;
    const m = URI_RE.exec(a.target);
    if (!m) continue;
    out.push({ name: a.name, target: a.target, scheme: m[1], ref_name: m[2] });
  }
  return out;
}
