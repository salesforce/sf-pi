/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Central Slack capability helpers.
 *
 * Keep this small and scope-driven: endpoint probes can still fail at runtime
 * on Enterprise Grid boundaries, but these helpers answer what the current
 * token grant should make available and keep status/tool-gating copy aligned.
 */
import type { SlackTokenType } from "./api.ts";

export const SEARCH_SCOPES = [
  "search:read",
  "search:read.public",
  "search:read.private",
  "search:read.im",
  "search:read.mpim",
  "search:read.files",
  "search:read.users",
] as const;

export const HISTORY_SCOPES = [
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
] as const;

export const DIRECTORY_SCOPES = ["channels:read", "groups:read", "im:read", "mpim:read"] as const;

export const ALL_SLACK_TOOL_NAMES = [
  "slack",
  "slack_time_range",
  "slack_resolve",
  "slack_research",
  "slack_channel",
  "slack_user",
  "slack_file",
  "slack_canvas",
  "slack_send",
  "slack_schedule",
] as const;

export type SlackToolName = (typeof ALL_SLACK_TOOL_NAMES)[number];

export interface SlackCapabilities {
  search: boolean;
  history: boolean;
  directory: boolean;
  dmDirectory: boolean;
  users: boolean;
  userEmail: boolean;
  files: boolean;
  fileSearch: boolean;
  canvasRead: boolean;
  canvasWrite: boolean;
  postMessage: boolean;
  openDm: boolean;
  openMpim: boolean;
}

export function hasAnyScope(granted: Set<string>, scopes: readonly string[]): boolean {
  return scopes.some((scope) => granted.has(scope));
}

export function buildSlackCapabilities(
  granted: Set<string> | null,
  tokenType: SlackTokenType = "unknown",
): SlackCapabilities | null {
  if (!granted) return null;
  const has = (scope: string) => granted.has(scope);
  const userToken = tokenType === "user";
  const postMessage = userToken && has("chat:write");

  return {
    search: hasAnyScope(granted, SEARCH_SCOPES),
    history: hasAnyScope(granted, HISTORY_SCOPES),
    directory: hasAnyScope(granted, DIRECTORY_SCOPES),
    dmDirectory: has("im:read"),
    users: has("users:read"),
    userEmail: has("users:read.email"),
    files: has("files:read"),
    fileSearch: has("search:read") || has("search:read.files"),
    canvasRead: has("canvases:read") || has("files:read"),
    canvasWrite: userToken && has("canvases:write"),
    postMessage,
    openDm: postMessage && has("im:write"),
    openMpim: postMessage && has("mpim:write"),
  };
}
