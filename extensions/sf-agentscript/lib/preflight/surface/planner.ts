/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Planner Readiness Preflight.
 *
 * Read-only checks for published Agentforce planner metadata that local Agent
 * Script compilation cannot prove. The adapter is deliberately quiet for
 * brand-new local agents: if no BotDefinition exists in the target org, it
 * returns no findings.
 */

import type { Connection } from "@salesforce/core";
import { boundedPromise } from "../../bounded-salesforce-transport.ts";
import type { AgentFeatureProfile } from "../../feature-profile.ts";
import { safeQueryRecords } from "../soql.ts";
import type { SurfaceReadinessCheck } from "./types.ts";

export interface PlannerReadinessContext {
  agentApiName?: string;
}

interface BotDefinitionRow {
  Id?: string;
  DeveloperName?: string;
}

interface FlowDefinitionViewRow {
  ApiName?: string;
  ProcessType?: string;
}

interface PlannerSurface {
  surface?: unknown;
  surfaceType?: unknown;
  outboundRouteConfigs?: unknown;
}

interface OutboundRouteConfig {
  outboundRouteName?: unknown;
  outboundRouteType?: unknown;
}

interface PlannerMetadata {
  plannerType?: unknown;
  plannerSurfaces?: unknown;
  localTopics?: unknown;
  localTopicLinks?: unknown;
}

export async function checkPlannerReadiness(
  conn: Connection,
  profile: AgentFeatureProfile,
  context: PlannerReadinessContext = {},
): Promise<SurfaceReadinessCheck[]> {
  if (!needsVoiceReadiness(profile)) return [];
  const agentApiName = context.agentApiName;
  if (!agentApiName) return [];

  const bot = await findBotDefinition(conn, agentApiName);
  if (bot === null) {
    return [
      {
        code: "voice-planner-bot-unverifiable",
        surface: "voice",
        status: "unverifiable",
        message:
          "Could not verify whether the target org has a published agent record, so planner readiness was not checked.",
      },
    ];
  }
  if (!bot) return [];

  const planner = await readPlannerMetadata(conn, agentApiName);
  if (planner === null) {
    return [
      {
        code: "voice-planner-metadata-unverifiable",
        surface: "voice",
        status: "unverifiable",
        message:
          "Published agent exists, but planner metadata could not be read. Voice planner readiness is unverifiable.",
        evidence: [`agent: ${agentApiName}`],
      },
    ];
  }
  if (!planner) {
    return [
      {
        code: "voice-planner-metadata-missing",
        surface: "voice",
        status: "warning",
        message:
          "Published voice agent exists, but no planner metadata was found. Voice calls may not start or route correctly.",
        evidence: [`agent: ${agentApiName}`],
      },
    ];
  }

  const checks: SurfaceReadinessCheck[] = [];
  const plannerType = scalar(planner.plannerType);
  if (plannerType && plannerType !== "Atlas__VoiceAgent") {
    checks.push({
      code: "voice-planner-type-review",
      surface: "voice",
      status: "warning",
      message:
        "Published voice agent planner is not marked as a voice planner. Confirm the planner type supports telephony before end-to-end voice testing.",
      evidence: [`plannerType: ${plannerType}`],
    });
  }

  const surfaces = toArray<PlannerSurface>(planner.plannerSurfaces);
  const telephonySurfaces = surfaces.filter(isTelephonySurface);
  if (telephonySurfaces.length === 0) {
    checks.push({
      code: "voice-planner-telephony-surface-missing",
      surface: "voice",
      status: "warning",
      message:
        "Published voice agent planner has no Telephony surface. Voice-specific escalation or routing may not fire.",
    });
  }

  const outboundRoutes = telephonySurfaces.flatMap((surface) =>
    toArray<OutboundRouteConfig>(surface.outboundRouteConfigs),
  );
  if (telephonySurfaces.length > 0 && outboundRoutes.length === 0) {
    checks.push({
      code: "voice-planner-outbound-route-missing",
      surface: "voice",
      status: "warning",
      message:
        "Published voice agent planner has a Telephony surface but no outbound route configuration. Escalation may not route to Omni-Channel.",
    });
  }

  for (const route of outboundRoutes) {
    const routeName = scalar(route.outboundRouteName);
    const routeType = scalar(route.outboundRouteType);
    if (routeType && routeType !== "OmniChannelFlow") {
      checks.push({
        code: "voice-planner-outbound-route-type-review",
        surface: "voice",
        status: "warning",
        message:
          "Published voice agent planner outbound route is not configured as an Omni-Channel flow. Confirm the route type matches the intended voice escalation pattern.",
        evidence: [`${routeName ?? "(unnamed route)"}: ${routeType}`],
      });
    }
    if (!routeName) {
      checks.push({
        code: "voice-planner-outbound-route-name-missing",
        surface: "voice",
        status: "warning",
        message:
          "Published voice agent planner has an outbound route configuration without a route name.",
      });
      continue;
    }
    const flow = await findActiveRoutingFlow(conn, routeName);
    if (flow === null) {
      checks.push({
        code: "voice-planner-outbound-route-unverifiable",
        surface: "voice",
        status: "unverifiable",
        message: "Could not verify the planner outbound route flow in the target org.",
        evidence: [`outboundRouteName: ${routeName}`],
      });
    } else if (!flow) {
      checks.push({
        code: "voice-planner-outbound-route-flow-missing",
        surface: "voice",
        status: "blocker",
        message:
          "Published voice agent planner references an outbound route flow that does not resolve to an active RoutingFlow in the target org.",
        evidence: [`outboundRouteName: ${routeName}`],
      });
    } else if (flow.ProcessType && flow.ProcessType !== "RoutingFlow") {
      checks.push({
        code: "voice-planner-outbound-route-flow-type-review",
        surface: "voice",
        status: "warning",
        message:
          "Planner outbound route resolves to an active flow, but the flow is not reported as a RoutingFlow. Confirm it is valid for Omni-Channel routing.",
        evidence: [`${routeName}: ${flow.ProcessType}`],
      });
    }
  }

  const localTopicCount =
    toArray(planner.localTopics).length + toArray(planner.localTopicLinks).length;
  if (localTopicCount === 0) {
    checks.push({
      code: "voice-planner-topics-missing",
      surface: "voice",
      status: "warning",
      message:
        "Published voice agent planner has no local topics or topic links. Voice runtime may accept a call and then end early without a useful response.",
    });
  }

  return checks;
}

function needsVoiceReadiness(profile: AgentFeatureProfile): boolean {
  return (
    profile.modalities.includes("voice") ||
    profile.linked_variables.some((variable) => variable.source_namespace === "VoiceCall")
  );
}

async function findBotDefinition(
  conn: Connection,
  agentApiName: string,
): Promise<BotDefinitionRow | undefined | null> {
  const rows = await queryOptional<BotDefinitionRow>(
    conn,
    `SELECT Id, DeveloperName FROM BotDefinition WHERE DeveloperName='${soqlEscape(agentApiName)}' LIMIT 1`,
  );
  if (rows === null) return null;
  return rows[0];
}

async function findActiveRoutingFlow(
  conn: Connection,
  apiName: string,
): Promise<FlowDefinitionViewRow | undefined | null> {
  const rows = await queryOptional<FlowDefinitionViewRow>(
    conn,
    `SELECT ApiName, ProcessType FROM FlowDefinitionView WHERE ApiName='${soqlEscape(apiName)}' AND IsActive = true LIMIT 1`,
  );
  if (rows === null) return null;
  return rows[0];
}

async function queryOptional<T extends object>(
  conn: Connection,
  soql: string,
): Promise<T[] | null> {
  return safeQueryRecords<T>(conn, "/query", soql);
}

async function readPlannerMetadata(
  conn: Connection,
  agentApiName: string,
): Promise<PlannerMetadata | undefined | null> {
  const metadata = (
    conn as { metadata?: { read?: (type: string, fullNames: string[]) => unknown } }
  ).metadata;
  if (!metadata?.read) return null;
  try {
    const raw = await boundedPromise(
      Promise.resolve(metadata.read("GenAiPlannerBundle", [agentApiName])),
      "GenAiPlannerBundle metadata read",
    );
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || typeof value !== "object") return undefined;
    return value as PlannerMetadata;
  } catch {
    return null;
  }
}

function isTelephonySurface(surface: PlannerSurface): boolean {
  return (
    scalar(surface.surfaceType) === "Telephony" ||
    scalar(surface.surface) === "SurfaceAction__Telephony"
  );
}

function scalar(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function toArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return value && typeof value === "object" ? [value as T] : [];
}

function soqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}
