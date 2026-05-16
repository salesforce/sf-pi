/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared types for the /sf-skills datatable overlay.
 *
 * Pulled out of the component so the apply-side code in
 * extensions/sf-skills/index.ts can import them without dragging the
 * pi-tui types along with it.
 */
import type { ActiveRow, DiscoverRow } from "../table-data.ts";

export type TabId = "active" | "discover" | "stats";

export interface ToggleAction {
  /** Skill name. */
  name: string;
  /** Resolved path we'll write into settings.skills[]. */
  skillPath: string;
  /** Which scope's settings file to write. */
  scope: "global" | "project";
  /** True = add the path; false = remove it. */
  enable: boolean;
}

export interface InstallCandidateAction {
  settingsValue: string;
  scope: "global" | "project";
}

export type TableResult =
  | { kind: "cancel" }
  | {
      kind: "apply";
      toggles: ToggleAction[];
      addCandidates: InstallCandidateAction[];
    };

export interface TableOverlayProps {
  active: ActiveRow[];
  discover: DiscoverRow[];
  cwd: string;
  /** Optional helper for the Stats tab. */
  statsTotalCount?: number;
}
