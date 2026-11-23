/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SF Fin Result Cards (human) and model packets (LLM).
 *
 * Every sf_fin result keeps two audiences apart, as ADR 0065 and ADR 0143 do
 * for SF Docs and Data 360:
 *
 * - `details.card` is a flat {@link FinCard} built from the operation's
 *   structured details (never by parsing its text). renderResult draws it.
 * - `content` is the model packet: the operation's compact text, bounded to
 *   MODEL_PACKET_MAX_CHARS and stripped of secrets and session-bearing URLs.
 *
 * A card answers first (one status headline and one sentence), shows only
 * what needs the person when collapsed, uses plain words and local times, and
 * names one next step. Full detail sits in `expandedOnly` blocks behind
 * ctrl+o. Every known result has its own presenter; an unknown one still gets
 * a card from its first text line, never numbered rows.
 */

import type { FinCard } from "./fin-card.ts";
import { observeCard, readinessCard } from "./cards/salesforce.ts";
import { executeCard, noopCard, planCard, refusedCard } from "./cards/changes.ts";
import {
  agentStatusCard,
  authTokensCard,
  connectorLogsCard,
  conversationCard,
  manifestCard,
  procedureCard,
  resourceUploadCard,
  simulationCard,
  simulationUploadCard,
} from "./cards/fin-as-code.ts";
import {
  accessCard,
  adminPagesCard,
  adminReadCard,
  doctorCard,
  downloadCard,
  errorLogsCard,
  installCard,
  setupCard,
  statusCard,
  surfacesCard,
  workspacesCard,
} from "./cards/workspace.ts";
import { genericCard } from "./cards/generic.ts";
import { str, isRecord } from "./cards/helpers.ts";
import type { CardInput } from "./cards/helpers.ts";

export type { CardInput } from "./cards/helpers.ts";

export const MODEL_PACKET_MAX_CHARS = 6_000;
export { localTime } from "./cards/helpers.ts";

// ─── Model packet ──────────────────────────────────────────────────────────

/**
 * Bound and sanitize the model-facing text. Session-bearing URLs (frontdoor,
 * OAuth authorize/callback with query strings) are replaced, and any known
 * secret is redacted, even though operations never put them in text.
 */
export function modelPacket(text: string, options: { secrets?: readonly string[] }): string {
  let out = text;
  for (const secret of options.secrets ?? []) {
    if (secret && secret.length >= 3) out = out.split(secret).join("[redacted]");
  }
  out = out.replace(
    /https?:\/\/[^\s)]*(?:frontdoor\.jsp|\/services\/oauth2\/|\/oauth\/|[?&](?:sid|code|token|access_token)=)[^\s)]*/gi,
    "[session URL omitted]",
  );
  if (out.length > MODEL_PACKET_MAX_CHARS) {
    const note = "\n… [truncated; full result in details]";
    out = `${out.slice(0, MODEL_PACKET_MAX_CHARS - note.length)}${note}`;
  }
  return out;
}

// ─── Card dispatch ─────────────────────────────────────────────────────────

export function buildFinCard(input: CardInput): FinCard {
  const d = input.details;
  const action = str(d.action) ?? "status";
  const operation = str(d.operation);
  const phase = str(d.phase);

  if (action === "status") return statusCard(input);
  if (action === "doctor") return doctorCard(input);
  if (action === "setup" && isRecord(d.ready)) return setupCard(input);
  if (action === "surfaces" && phase === "surfaces") return surfacesCard(input);
  if (action === "workspace" && operation === "list" && isRecord(d.workspaces)) {
    return workspacesCard(input);
  }
  if (action === "admin" && operation === "pages" && Array.isArray(d.pageGuide)) {
    return adminPagesCard(input);
  }
  if (action === "admin" && operation === "read" && Array.isArray(d.diagnoses)) {
    return errorLogsCard(input);
  }
  if (action === "admin" && operation === "read" && Array.isArray(d.lines)) {
    return adminReadCard(input);
  }
  if (action === "sdk" && operation === "download" && Array.isArray(d.files)) {
    return downloadCard(input);
  }
  if (action === "install" && isRecord(d.plan)) return installCard(input);
  if (action === "agent" && operation === "access") return accessCard(input);
  if (action === "salesforce" && Array.isArray(d.checks) && phase === "readiness") {
    return readinessCard(input);
  }
  if (action === "salesforce" && phase === "observe") return observeCard(input);
  if (phase === "plan") return planCard(input);
  if (phase === "refused") return refusedCard(input);
  if (phase === "noop") return noopCard(input);
  if (phase === "execute" || phase === "verify") return executeCard(input);
  if (action === "sdk" && operation === "simulate" && phase === "result") {
    return simulationCard(input);
  }
  if (action === "sdk" && operation === "upload_simulations") return simulationUploadCard(input);
  if (
    action === "sdk" &&
    operation === "upload" &&
    (d.kind === "guidance" || d.kind === "data_connector")
  ) {
    return resourceUploadCard(input);
  }
  if (action === "sdk" && (operation === "upload" || operation === "validate")) {
    return procedureCard(input);
  }
  if (action === "agent" && operation === "run" && phase === "run") return conversationCard(input);
  if (action === "sdk" && operation === "agent_status" && isRecord(d.procedure)) {
    return agentStatusCard(input);
  }
  if (action === "sdk" && operation === "auth_tokens" && Array.isArray(d.tokens)) {
    return authTokensCard(input);
  }
  if (action === "sdk" && operation === "connector_logs" && Array.isArray(d.runs)) {
    return connectorLogsCard(input);
  }
  if (action === "sdk" && operation === "manifest" && isRecord(d.summary)) {
    return manifestCard(input);
  }
  return genericCard(input);
}
