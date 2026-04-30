/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Command handlers for `/sf-pi announcements`.
 *
 * sf-pi-manager is the single entry point for anything "announcements"-
 * related on the command line. The splash panel (rendered by sf-welcome)
 * is the visual surface; this module is the CLI surface plus the footer
 * nudge computation.
 *
 * Accepted forms:
 *   /sf-pi announcements                    -> list active items + usage
 *   /sf-pi announcements list               -> same as above
 *   /sf-pi announcements dismiss <id>       -> hide one item forever
 *   /sf-pi announcements reset              -> clear all dismissals + revision
 *
 * Intentionally NOT provided:
 *   - No "open link" action. The list prints URLs; the user can click/copy.
 *   - No interactive overlay. Announcements are read-mostly and the panel
 *     already shows them.
 */
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { AnnouncementItem, AnnouncementsManifest } from "../../../catalog/types.ts";
import { loadAnnouncementsManifest } from "../../sf-welcome/lib/announcements-manifest.ts";
import {
  buildAnnouncementsSync,
  refreshAnnouncements,
  type AnnouncementsPayload,
} from "../../sf-welcome/lib/announcements.ts";
import {
  acknowledgeAnnouncementsRevision,
  dismissAnnouncement,
  readAnnouncementsState,
  resetAnnouncementsState,
  type AnnouncementsState,
} from "../../sf-welcome/lib/announcements-state.ts";

export type AnnouncementsSubcommand = "list" | "dismiss" | "reset";

export interface AnnouncementsArgs {
  subcommand: AnnouncementsSubcommand;
  /** Target id for the dismiss subcommand. */
  target?: string;
}

const PREFIX = "/sf-pi announcements";

// -------------------------------------------------------------------------------------------------
// Argument parsing
// -------------------------------------------------------------------------------------------------

export function parseAnnouncementsArgs(raw: string): AnnouncementsArgs {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const sub = (tokens[0] ?? "").toLowerCase();

  if (!sub || sub === "list" || sub === "ls") return { subcommand: "list" };
  if (sub === "reset" || sub === "clear") return { subcommand: "reset" };
  if (sub === "dismiss" || sub === "hide") {
    return { subcommand: "dismiss", target: tokens[1] };
  }
  return { subcommand: "list" };
}

// -------------------------------------------------------------------------------------------------
// Dispatcher
// -------------------------------------------------------------------------------------------------

export async function handleAnnouncements(
  ctx: ExtensionCommandContext,
  packageRoot: string,
  args: AnnouncementsArgs,
): Promise<void> {
  switch (args.subcommand) {
    case "list":
      await handleList(ctx, packageRoot);
      break;
    case "dismiss":
      handleDismiss(ctx, packageRoot, args.target);
      break;
    case "reset":
      handleReset(ctx);
      break;
  }
}

// -------------------------------------------------------------------------------------------------
// Handlers
// -------------------------------------------------------------------------------------------------

async function handleList(ctx: ExtensionCommandContext, packageRoot: string): Promise<void> {
  // Kick a best-effort refresh first so the list matches what the splash
  // will show on the next startup. Network failure is silent.
  let payload: AnnouncementsPayload;
  try {
    payload = await refreshAnnouncements({ packageRoot, cwd: ctx.cwd });
  } catch {
    payload = buildAnnouncementsSync({ packageRoot, cwd: ctx.cwd });
  }

  const manifest = loadAnnouncementsManifest(packageRoot);
  if (manifest.revision) {
    acknowledgeAnnouncementsRevision(manifest.revision);
  }

  if (payload.visible.length === 0) {
    ctx.ui.notify(
      [
        "No active announcements.",
        "",
        `Manifest revision: ${manifest.revision || "unset"}`,
        manifest.feedUrl ? `Feed: ${manifest.feedUrl}` : "Feed: not configured",
      ].join("\n"),
      "info",
    );
    return;
  }

  // Re-derive bodies/links from the manifest so we can show full context.
  // The AnnouncementView the splash uses only carries the one-line title.
  const byId = new Map<string, AnnouncementItem>();
  for (const item of manifest.announcements) byId.set(item.id, item);

  const lines: string[] = [
    `sf-pi announcements — ${payload.visible.length} active`,
    `Revision: ${payload.revision || "unset"}`,
    "",
  ];

  for (const view of payload.visible) {
    const full = byId.get(view.id);
    const marker = kindMarker(view.kind);
    lines.push(`  ${marker} [${view.severity}] ${view.title}`);
    lines.push(`      id: ${view.id}`);
    const body = view.body ?? full?.body;
    const link = view.link ?? full?.link;
    if (body) {
      for (const bodyLine of body.split(/\r?\n/)) {
        lines.push(`      ${bodyLine}`);
      }
    }
    if (link) {
      lines.push(`      link: ${link}`);
    }
    lines.push("");
  }

  lines.push(`Dismiss one: ${PREFIX} dismiss <id>`);
  lines.push(`Reset all:   ${PREFIX} reset`);
  lines.push(`Disable:     SF_PI_ANNOUNCEMENTS=off (env)`);

  ctx.ui.notify(lines.join("\n"), "info");
}

function handleDismiss(
  ctx: ExtensionCommandContext,
  packageRoot: string,
  target: string | undefined,
): void {
  if (!target) {
    ctx.ui.notify(`Usage: ${PREFIX} dismiss <id>`, "warning");
    return;
  }
  // Validate against the current manifest so we can tell the user when
  // they mistyped an id — but still allow dismissing ids that only exist
  // in the cached remote payload (e.g. maintainer just published a note
  // that hasn't been baked into the bundled file yet).
  const manifest = loadAnnouncementsManifest(packageRoot);
  const knownIds = new Set(manifest.announcements.map((a) => a.id));
  const sync = buildAnnouncementsSync({ packageRoot, cwd: ctx.cwd });
  for (const view of sync.visible) knownIds.add(view.id);

  if (!knownIds.has(target)) {
    ctx.ui.notify(
      `No announcement with id "${target}". Run ${PREFIX} to see active items.`,
      "warning",
    );
    return;
  }

  dismissAnnouncement(target);
  ctx.ui.notify(`Dismissed announcement "${target}".`, "info");
}

function handleReset(ctx: ExtensionCommandContext): void {
  resetAnnouncementsState();
  ctx.ui.notify(
    "Announcement dismissals cleared. Active items will reappear on next splash.",
    "info",
  );
}

// -------------------------------------------------------------------------------------------------
// Footer nudge helper
// -------------------------------------------------------------------------------------------------

/**
 * Decide whether to show the footer nudge for new announcements.
 *
 * Mirrors computeRecommendationsNudge() in shape so the manager's
 * session_start handler stays symmetric. The rule is simpler here — we
 * surface a nudge whenever the manifest revision is newer than the one
 * the user has acknowledged AND there is at least one currently visible
 * item after filtering.
 */
export interface AnnouncementsNudgeInfo {
  show: boolean;
  visibleCount: number;
  revision: string;
}

export function computeAnnouncementsNudge(
  manifest: AnnouncementsManifest,
  state: AnnouncementsState,
  payload: AnnouncementsPayload,
  env: NodeJS.ProcessEnv = process.env,
): AnnouncementsNudgeInfo {
  const disabled = (env.SF_PI_ANNOUNCEMENTS ?? "").toLowerCase() === "off";
  if (disabled) return { show: false, visibleCount: 0, revision: manifest.revision };
  if (!manifest.revision) return { show: false, visibleCount: 0, revision: "" };
  if (state.acknowledgedRevision === manifest.revision) {
    return { show: false, visibleCount: 0, revision: manifest.revision };
  }
  return {
    show: payload.visible.length > 0,
    visibleCount: payload.visible.length,
    revision: manifest.revision,
  };
}

// -------------------------------------------------------------------------------------------------
// Shared helpers
// -------------------------------------------------------------------------------------------------

function kindMarker(kind: "note" | "update" | "breaking" | "deprecation"): string {
  switch (kind) {
    case "update":
      return "↑";
    case "breaking":
      return "!";
    case "deprecation":
      return "×";
    case "note":
    default:
      return "•";
  }
}

/** Test-only re-export so state can be inspected without importing through
 * the sf-welcome extension path. */
export function readAnnouncementsStateForTests(filePath?: string): AnnouncementsState {
  return readAnnouncementsState(filePath);
}
