/* SPDX-License-Identifier: Apache-2.0 */
/** SF Brain Manager diagnostics for display, instruction, and visual-response evidence. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ManagerDetailAction } from "../../../lib/common/manager-actions.ts";
import { buildDisplayCapabilitiesReport } from "./display-capabilities.ts";
import { DisplayCapabilitiesPanel } from "./display-capabilities-panel.ts";
import {
  compareInstructionSurfaceToBaseline,
  loadInstructionSurfaceBaseline,
} from "./instruction-surface-baseline.ts";
import { InstructionSurfacePanel } from "./instruction-surface-panel.ts";
import {
  captureInstructionSurfaceReport,
  type CaptureInstructionSurfaceOptions,
  type InstructionSurfaceRuntimeContext,
  type InstructionSurfaceRuntimePi,
} from "./instruction-surface-runtime.ts";
import { captureVisualResponseAudit } from "./visual-response-audit.ts";
import { VisualResponseAuditPanel } from "./visual-response-panel.ts";

export function buildSfBrainManagerActions(
  pi: Pick<ExtensionAPI, "getAllTools">,
  options: CaptureInstructionSurfaceOptions,
): ManagerDetailAction[] {
  return [
    {
      id: "display-capabilities",
      label: "Display capabilities",
      description: "Inspect effective Mermaid, icon, terminal, and width behavior.",
      group: "Diagnostics",
      acceptsScope: false,
      run: () => undefined,
      createPanel: (theme, cwd, _scope, done) =>
        new DisplayCapabilitiesPanel(theme, buildDisplayCapabilitiesReport(cwd), done),
    },
    {
      id: "instruction-surface",
      label: "Instruction surface",
      description: "Inspect model-visible Salesforce context size and contributors.",
      group: "Diagnostics",
      acceptsScope: false,
      run: () => undefined,
      createPanel: (theme, _cwd, _scope, done, ctx) => {
        const report = captureInstructionSurfaceReport(
          pi as InstructionSurfaceRuntimePi,
          ctx as unknown as InstructionSurfaceRuntimeContext,
          options,
        );
        const comparison = compareInstructionSurfaceToBaseline(
          report,
          loadInstructionSurfaceBaseline(options.sfPiPackageRoot),
        );
        return new InstructionSurfacePanel(theme, report, done, comparison);
      },
    },
    {
      id: "visual-response-audit",
      label: "Visual response audit",
      description: "Inspect aggregate-only Mermaid family, width, warning, and icon facts.",
      group: "Diagnostics",
      acceptsScope: false,
      run: () => undefined,
      createPanel: (theme, cwd, _scope, done, ctx) =>
        new VisualResponseAuditPanel(
          theme,
          captureVisualResponseAudit({
            cwd,
            sessionDir: ctx.sessionManager.getSessionDir(),
            maxSessions: 50,
            terminalWidth: process.stdout.columns ?? 80,
          }),
          done,
        ),
    },
  ];
}
