/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared types for the Skill Funnel view overlay.
 *
 * Pulled out of the component so the apply-side code in index.ts can import
 * the staged-action shapes without dragging pi-tui along.
 */
import type { SkillCatalog } from "../catalog.ts";
import type { SkillSourceScope } from "../../../../lib/common/skill-sources/skill-sources.ts";

export type FunnelTab = "catalog" | "sources" | "global" | "project" | "conflicts";

/**
 * A staged decision the user made in the funnel. The component only stages
 * intent; index.ts compiles each action through the Resolution Policy into
 * native settings.skills[] ops, so the component stays free of compile logic.
 */
export type FunnelAction =
  | {
      kind: "skill-gate";
      name: string;
      skillPath: string;
      scope: SkillSourceScope;
      enable: boolean;
    }
  | {
      kind: "source-gate";
      sourceId: string;
      value: string;
      scope: SkillSourceScope;
      seen: boolean;
    }
  | { kind: "conflict-winner"; name: string; winnerPath: string }
  | { kind: "add-source"; value: string; scope: SkillSourceScope };

export type FunnelResult =
  | { kind: "cancel" }
  | { kind: "apply"; actions: FunnelAction[] }
  // Resolve a conflict by file action (disable/move/delete). Handled
  // interactively in index.ts because it needs confirm dialogs the overlay
  // component can't open itself.
  | { kind: "resolve"; name: string; winnerPath: string }
  // Bulk de-duplicate skills wired in both global and project scope. Handled
  // interactively in index.ts (it prompts which scope to keep).
  | { kind: "consolidate" };

export interface FunnelViewProps {
  catalog: SkillCatalog;
  cwd: string;
}
