/* SPDX-License-Identifier: Apache-2.0 */
/** Status and doctor rendering for the current split Herdr runtime. */
import {
  collectHerdrPackageInstall,
  HERDR_PI_PACKAGE_SOURCE,
} from "../../../lib/common/herdr-package-sources.ts";
import { getHerdrSplitToolReadiness } from "../../../lib/common/herdr-runtime.ts";
import { globalSettingsPath } from "../../../lib/common/sf-pi-settings.ts";
import { readSfHerdrSettings } from "./settings.ts";

export function renderStatus(
  activeToolNames: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  const readiness = getHerdrSplitToolReadiness(activeToolNames, env);
  const settings = readSfHerdrSettings();
  return [
    "SF Herdr status",
    `Runtime: ${readiness.activeControlEnv ? "inside Herdr pane" : "not inside Herdr pane"}`,
    `Current tools: ${readiness.allToolsActive ? "all active" : `missing ${readiness.missingTools.join(", ")}`}`,
    `Planner: ${readiness.ready ? "ready" : "not registered for this runtime"}`,
    env.HERDR_PANE_ID ? `Current pane: ${env.HERDR_PANE_ID}` : undefined,
    `Global settings: ${globalSettingsPath()} → sfPi.herdr`,
    `Split direction: ${settings.splitDirection}`,
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

export function renderDoctor(
  activeToolNames: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const readiness = getHerdrSplitToolReadiness(activeToolNames, env);
  return [
    "SF Herdr doctor",
    "✓ sf-herdr command and settings surfaces loaded",
    `${readiness.activeControlEnv ? "✓" : "○"} HERDR_ENV=1 and HERDR_PANE_ID ${readiness.activeControlEnv ? "detected" : "not detected"}`,
    `${readiness.allToolsActive ? "✓" : "○"} Current split tools ${readiness.allToolsActive ? "all active" : `missing: ${readiness.missingTools.join(", ")}`}`,
    `${readiness.ready ? "✓" : "○"} sf_herdr_plan ${readiness.ready ? "eligible at session startup" : "not eligible in this runtime"}`,
    ...renderHerdrPackageChecks(cwd),
    "",
    "The planner never mutates panes or generates commands. Herdr actions remain explicit.",
    "SF Guardrail mediates herdr_pane action=run commands when configured safety rules match.",
  ].join("\n");
}

function renderHerdrPackageChecks(cwd: string): string[] {
  const install = collectHerdrPackageInstall(cwd);
  if (install.kind === "duplicate") {
    return [
      "✗ Duplicate Herdr packages (npm + git) — herdr_* tool names will conflict",
      `  Keep ${HERDR_PI_PACKAGE_SOURCE} and remove git:github.com/ogulcancelik/pi-extensions`,
    ];
  }
  if (install.kind === "official") {
    return [`✓ Official Herdr package ${HERDR_PI_PACKAGE_SOURCE}`];
  }
  if (install.kind === "git-only") {
    return [`○ Herdr tools via git monorepo; official source is ${HERDR_PI_PACKAGE_SOURCE}`];
  }
  return [`○ Official Herdr package ${HERDR_PI_PACKAGE_SOURCE} not installed`];
}
