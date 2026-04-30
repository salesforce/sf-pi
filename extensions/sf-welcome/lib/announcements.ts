/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Announcements orchestrator.
 *
 * Pulls together the bundled manifest, optional remote feed, update-nudge
 * synthesis, and user state into a single render-ready payload for the
 * splash panel.
 *
 * Split responsibilities:
 *   - announcements-manifest.ts  \u2014 load bundled JSON
 *   - announcements-remote.ts    \u2014 optional network fetch
 *   - announcements-update.ts    \u2014 synthesize the update nudge
 *   - announcements-filter.ts    \u2014 pure merge/filter/sort rules
 *   - announcements-state.ts     \u2014 dismissals + ack bookkeeping
 *
 * Everything in this file is a thin composition over those pieces so the
 * pipeline is easy to reason about in isolation.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globalSettingsPath, projectSettingsPath } from "../../../lib/common/pi-paths.ts";
import type {
  AnnouncementItem,
  AnnouncementKind,
  AnnouncementSeverity,
  AnnouncementsManifest,
} from "../../../catalog/types.ts";
import { loadAnnouncementsManifest, resolveDefaultPackageRoot } from "./announcements-manifest.ts";
import { fetchRemoteAnnouncements, type RemoteFetchOptions } from "./announcements-remote.ts";
import { buildUpdateAnnouncement } from "./announcements-update.ts";
import { filterAnnouncements, mergeAnnouncements } from "./announcements-filter.ts";
import {
  readAnnouncementsState,
  updateRemoteCache,
  type AnnouncementsState,
} from "./announcements-state.ts";

export { MAX_VISIBLE_ANNOUNCEMENTS } from "./announcements-filter.ts";

/** Render-ready shape consumed by the splash component. */
export interface AnnouncementView {
  id: string;
  kind: AnnouncementKind;
  severity: AnnouncementSeverity;
  title: string;
  body?: string;
  link?: string;
}

/** Splash-facing payload. */
export interface AnnouncementsPayload {
  /** Current manifest revision. Used by the orchestrator to decide when to
   * re-arm the footer nudge. */
  revision: string;
  /** Total active (post-filter) count across bundled + remote + update nudge. */
  totalActive: number;
  /** Items to render in the splash panel (already capped). */
  visible: AnnouncementView[];
  /** True when at least one visible item has not yet been acknowledged via a
   * splash dismiss. Drives the footer nudge color. */
  hasUnacknowledged: boolean;
}

export interface AnnouncementFeatureSettings {
  /** Master toggle. False hides the panel and disables the footer nudge. */
  enabled: boolean;
  /** Remote feed toggle. False keeps bundled/update entries but skips fetch. */
  feedEnabled: boolean;
}

export interface BuildAnnouncementsOptions {
  /** sf-pi repo root. Defaults to an auto-resolved location. */
  packageRoot?: string;
  /** Current project cwd. When supplied, reads global + project settings. */
  cwd?: string;
  /** Installed sf-pi version. Pulled from package.json when omitted. */
  installedVersion?: string;
  /** Env override (tests). */
  env?: NodeJS.ProcessEnv;
  /** Current time. Injectable for tests. */
  now?: Date;
  /** Optional injected state (tests). */
  state?: AnnouncementsState;
  /** Optional injected feature settings (tests). */
  settings?: AnnouncementFeatureSettings;
  /** Override manifest loader (tests). */
  manifest?: AnnouncementsManifest;
  /** Override remote fetch (tests). */
  remote?: RemoteFetchOptions["fetchImpl"];
}

/**
 * Synchronous, bundled-only path. Used by the splash's initial render so
 * the panel appears immediately without waiting on a network round-trip.
 * The async `refreshAnnouncements` can augment this later if a feed is
 * configured.
 */
export function buildAnnouncementsSync(
  options: BuildAnnouncementsOptions = {},
): AnnouncementsPayload {
  const env = options.env ?? process.env;
  const feature = resolveAnnouncementFeatureSettings(options.cwd, env, options.settings);
  if (!feature.enabled) return emptyPayload();

  const packageRoot = options.packageRoot ?? resolveDefaultPackageRoot();
  const manifest = options.manifest ?? loadAnnouncementsManifestOrEmpty(packageRoot);
  const state = options.state ?? readAnnouncementsState();
  const installedVersion = options.installedVersion ?? readInstalledVersion(packageRoot);

  const updateItem = buildUpdateAnnouncement({
    installedVersion,
    latestVersion: manifest.latestVersion,
    packageRoot,
  });

  const merged: AnnouncementItem[] = [
    ...manifest.announcements,
    ...(updateItem ? [updateItem] : []),
  ];
  // If the user has a cached remote payload from a previous run, include
  // it on the sync path so the splash looks the same offline as online
  // until the next refresh completes.
  const cachedRemote = parseCachedRemote(state);
  if (cachedRemote.length > 0) {
    const withRemote = mergeAnnouncements(merged, cachedRemote);
    return toPayload(withRemote, state, installedVersion, manifest.revision, options.now);
  }

  return toPayload(merged, state, installedVersion, manifest.revision, options.now);
}

/**
 * Async refresh path. Fetches the remote feed (if configured and allowed),
 * persists the ETag/cache, and returns the updated payload.
 *
 * Callers can run this after the splash has already painted with the
 * sync-only payload and request a repaint when the promise resolves.
 */
export async function refreshAnnouncements(
  options: BuildAnnouncementsOptions = {},
): Promise<AnnouncementsPayload> {
  const env = options.env ?? process.env;
  const feature = resolveAnnouncementFeatureSettings(options.cwd, env, options.settings);
  if (!feature.enabled) return emptyPayload();

  const packageRoot = options.packageRoot ?? resolveDefaultPackageRoot();
  const manifest = options.manifest ?? loadAnnouncementsManifestOrEmpty(packageRoot);
  const state = options.state ?? readAnnouncementsState();
  const installedVersion = options.installedVersion ?? readInstalledVersion(packageRoot);

  const remote = await fetchRemoteAnnouncements({
    feedUrl: feature.feedEnabled ? manifest.feedUrl : undefined,
    state,
    env,
    now: options.now,
    fetchImpl: options.remote,
  });

  // Persist the remote cache only in production paths. Tests inject state
  // explicitly; writing the cache in that mode would mutate the user's real
  // ~/.pi state while running unit tests.
  if (remote?.statePatch && !options.state) {
    updateRemoteCache(remote.statePatch);
  }

  const updateItem = buildUpdateAnnouncement({
    installedVersion,
    latestVersion: manifest.latestVersion,
    packageRoot,
  });

  const combined = mergeAnnouncements(manifest.announcements, remote ? remote.announcements : []);
  const merged = updateItem ? [...combined, updateItem] : combined;

  const latestState = options.state ?? readAnnouncementsState();
  return toPayload(merged, latestState, installedVersion, manifest.revision, options.now);
}

// -------------------------------------------------------------------------------------------------
// Internals
// -------------------------------------------------------------------------------------------------

function toPayload(
  items: readonly AnnouncementItem[],
  state: AnnouncementsState,
  installedVersion: string | undefined,
  revision: string,
  now: Date | undefined,
): AnnouncementsPayload {
  const filtered = filterAnnouncements(items, {
    installedVersion,
    dismissed: state.dismissed,
    now,
  });

  const visible: AnnouncementView[] = filtered.map((item) => ({
    id: item.id,
    kind: item.kind,
    severity: item.severity ?? "info",
    title: item.title,
    body: item.body,
    link: item.link,
  }));

  const hasUnacknowledged =
    !!revision && state.acknowledgedRevision !== revision && visible.length > 0;

  return {
    revision,
    totalActive: filtered.length,
    visible,
    hasUnacknowledged,
  };
}

export function resolveAnnouncementFeatureSettings(
  cwd: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  injected?: AnnouncementFeatureSettings,
): AnnouncementFeatureSettings {
  if (injected) return injected;

  let settings: AnnouncementFeatureSettings = { enabled: true, feedEnabled: true };

  // Settings are optional and best-effort. Project settings override global
  // when cwd is available; without cwd we keep deterministic defaults so
  // tests and non-UI callers don't depend on the machine's settings.json.
  if (cwd) {
    settings = applySettingsFile(settings, globalSettingsPath());
    settings = applySettingsFile(settings, projectSettingsPath(cwd));
  }

  if ((env.SF_PI_ANNOUNCEMENTS ?? "").toLowerCase() === "off") {
    settings = { enabled: false, feedEnabled: false };
  }
  if ((env.SF_PI_ANNOUNCEMENTS_FEED ?? "").toLowerCase() === "off") {
    settings = { ...settings, feedEnabled: false };
  }
  if (!settings.enabled) return { enabled: false, feedEnabled: false };
  return settings;
}

function applySettingsFile(
  current: AnnouncementFeatureSettings,
  filePath: string,
): AnnouncementFeatureSettings {
  if (!existsSync(filePath)) return current;
  let root: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return current;
    root = parsed as Record<string, unknown>;
  } catch {
    return current;
  }

  const sfPi = getRecord(root, "sfPi");
  const raw = sfPi.announcements;
  if (raw === false) return { enabled: false, feedEnabled: false };
  if (raw === true) return { enabled: true, feedEnabled: true };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return current;

  const ann = raw as Record<string, unknown>;
  const next = { ...current };
  if (typeof ann.enabled === "boolean") next.enabled = ann.enabled;
  if (typeof ann.feedEnabled === "boolean") next.feedEnabled = ann.feedEnabled;
  if (!next.enabled) next.feedEnabled = false;
  return next;
}

function getRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function emptyPayload(): AnnouncementsPayload {
  return {
    revision: "",
    totalActive: 0,
    visible: [],
    hasUnacknowledged: false,
  };
}

function loadAnnouncementsManifestOrEmpty(packageRoot: string | undefined): AnnouncementsManifest {
  if (!packageRoot) {
    return { schemaVersion: 1, revision: "", announcements: [] };
  }
  return loadAnnouncementsManifest(packageRoot);
}

function readInstalledVersion(packageRoot: string | undefined): string | undefined {
  if (!packageRoot) return undefined;
  const pkgPath = join(packageRoot, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return typeof pkg.version === "string" && pkg.version.trim() ? pkg.version.trim() : undefined;
  } catch {
    return undefined;
  }
}

function parseCachedRemote(state: AnnouncementsState): AnnouncementItem[] {
  if (!state.cachedRemote) return [];
  try {
    const parsed = JSON.parse(state.cachedRemote) as Partial<AnnouncementsManifest> & {
      announcements?: unknown;
    };
    if (!parsed || parsed.schemaVersion !== 1) return [];
    if (!Array.isArray(parsed.announcements)) return [];
    return parsed.announcements.filter((value): value is AnnouncementItem => {
      return (
        !!value &&
        typeof value === "object" &&
        typeof (value as AnnouncementItem).id === "string" &&
        typeof (value as AnnouncementItem).title === "string" &&
        typeof (value as AnnouncementItem).kind === "string"
      );
    });
  } catch {
    return [];
  }
}
