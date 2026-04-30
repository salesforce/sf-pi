/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-brain behavior contract
 *
 * - Injects the Salesforce Operator Kernel into the session exactly once per
 *   session, on the first before_agent_start where the sf CLI state is known.
 * - If the sf CLI is not installed, injects the short install stub instead.
 * - Honors a user override at `<globalAgentDir>/sf-brain/SF_KERNEL.md`.
 *
 * The kernel is delivered as a persistent, hidden custom message (not a
 * per-turn system-prompt mutation). That means:
 *   - It participates in the session transcript and is replayed on /resume.
 *   - Providers see the same bytes at the top of history turn after turn, so
 *     it benefits from prompt caching.
 *   - /reload and /fork inherit the kernel via the session store rather than
 *     re-running any detection.
 *
 * Detection reuses the shared sf-environment cache populated by sf-devbar /
 * sf-welcome during startup. If neither has populated it yet (e.g. sf-brain
 * loaded first), we trigger a detection once and the result is cached for
 * other consumers.
 *
 * Behavior matrix:
 *
 *   Event               | Condition                             | Result
 *   --------------------|---------------------------------------|------------------------------------------
 *   before_agent_start  | kernel already in session entries     | Skip injection
 *   before_agent_start  | CLI installed, no kernel entry yet    | Inject full kernel as hidden message
 *   before_agent_start  | CLI not installed, no kernel entry    | Inject install stub as hidden message
 */
import type { CustomEntry, ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { buildExecFn } from "../../lib/common/exec-adapter.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../lib/common/sf-environment/shared-runtime.ts";
import { KERNEL_ENTRY_TYPE, loadKernel } from "./lib/kernel.ts";

/**
 * Type guard for our own persisted kernel entries. Prevents false matches
 * against other extensions' custom entries in the session log.
 */
function isKernelEntry(entry: unknown): entry is CustomEntry<unknown> {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as { type?: string; customType?: string };
  return candidate.type === "custom" && candidate.customType === KERNEL_ENTRY_TYPE;
}

export default function (pi: ExtensionAPI) {
  const exec = buildExecFn(pi);

  pi.on("before_agent_start", async (_event, ctx) => {
    const alreadyInjected = ctx.sessionManager.getEntries().some((entry) => isKernelEntry(entry));
    if (alreadyInjected) return;

    // Prefer the already-populated shared cache. If nothing has run detection
    // yet in this process, fall through to a live detection. Either way the
    // result is shared with sf-devbar / sf-welcome.
    let env = getCachedSfEnvironment(ctx.cwd);
    if (!env) {
      env = await getSharedSfEnvironment(exec, ctx.cwd);
    }

    const kernel = loadKernel({ cliInstalled: env.cli.installed });

    return {
      message: {
        customType: KERNEL_ENTRY_TYPE,
        content: kernel,
        display: false,
      },
    };
  });
}
