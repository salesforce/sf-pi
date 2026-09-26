/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-brain behavior contract
 *
 * - Injects the bundled Salesforce Engineering Constitution as a persistent,
 *   hidden custom message while it remains live on the active branch.
 * - Keeps the constitution present when sf CLI is unavailable and adds only a
 *   compact CLI-status note.
 * - Appends optional user guidance from SF_CONSTITUTION_APPEND.md without
 *   allowing replacement of the bundled baseline.
 * - Re-injects after compaction removes the live constitution entry.
 *
 * Detection reuses the shared sf-environment cache populated by sf-devbar /
 * sf-welcome during startup. The constitution bytes remain stable across turns
 * so provider prompt caches can reuse them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { SF_PI_REGISTRY } from "../../catalog/registry.ts";
import { buildExecFn } from "../../lib/common/exec-adapter.ts";
import { registerManagerDetailActions } from "../../lib/common/manager-actions.ts";
import { registerLatestContextProjection } from "../../lib/common/session/active-branch-context.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../lib/common/sf-environment/shared-runtime.ts";
import {
  CONSTITUTION_ENTRY_TYPE,
  loadConstitution,
  resolveDisplayCapabilities,
  shouldInjectConstitution,
} from "./lib/constitution.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import {
  formatSfPiRoutingSummary,
  SF_PI_ROUTING_ENTRY_TYPE,
  shouldInjectSfPiRoutingSummary,
} from "./lib/routing-summary.ts";
import { buildSfBrainManagerActions } from "./lib/instruction-surface-manager.ts";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SF_PI_VERSION = readPackageVersion();
const SF_PI_TOOL_NAMES = SF_PI_REGISTRY.flatMap((extension) => extension.tools ?? []);

export default function (pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-brain")) return;

  registerManagerDetailActions(
    pi,
    "sf-brain",
    buildSfBrainManagerActions(pi, {
      sfPiPackageRoot: PACKAGE_ROOT,
      sfPiToolNames: SF_PI_TOOL_NAMES,
      piRuntimeVersion: VERSION,
      sfPiVersion: SF_PI_VERSION,
    }),
  );
  registerLatestContextProjection(pi, [CONSTITUTION_ENTRY_TYPE, SF_PI_ROUTING_ENTRY_TYPE]);
  const exec = buildExecFn(pi);

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!shouldInjectConstitution(ctx.sessionManager)) return;

    // Prefer the already-populated shared cache. If nothing has run detection
    // yet in this process, fall through to a live detection. Either way the
    // result is shared with sf-devbar / sf-welcome.
    let env = getCachedSfEnvironment(ctx.cwd);
    if (!env) {
      env = await getSharedSfEnvironment(exec, ctx.cwd);
    }

    const constitution = loadConstitution({
      cliInstalled: env.cli.installed,
      ...resolveDisplayCapabilities(ctx.cwd),
    });

    return {
      message: {
        customType: CONSTITUTION_ENTRY_TYPE,
        content: constitution,
        display: false,
      },
    };
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const summary = formatSfPiRoutingSummary(ctx.cwd);
    if (!shouldInjectSfPiRoutingSummary(ctx.sessionManager, summary)) return;

    return {
      message: {
        customType: SF_PI_ROUTING_ENTRY_TYPE,
        content: summary,
        display: false,
      },
    };
  });
}

function readPackageVersion(): string {
  try {
    const value = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof value.version === "string" ? value.version : "unknown";
  } catch {
    return "unknown";
  }
}
