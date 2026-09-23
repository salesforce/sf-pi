/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded, read-only target-org choices for Omni-Channel Flow authoring. */

import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import type { SfFlowParams } from "./types.ts";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const QUERY_LIMIT = 100;

export interface GroundedOmniChoice {
  developer_name: string;
  label: string;
  detail?: string;
}

export interface OmniAuthorGroundingResult {
  target_org: string;
  api_version?: string;
  service_channels: GroundedOmniChoice[];
  queues: GroundedOmniChoice[];
  routing_configurations: GroundedOmniChoice[];
  skills: GroundedOmniChoice[];
  agents: GroundedOmniChoice[];
  coverage: {
    calls: string[];
    gaps: Array<{ area: string; reason: string }>;
  };
}

export interface OmniGroundingAdapter {
  listServiceChannels(): Promise<GroundedOmniChoice[]>;
  listQueues(): Promise<GroundedOmniChoice[]>;
  listRoutingConfigurations(): Promise<GroundedOmniChoice[]>;
  listSkills(): Promise<GroundedOmniChoice[]>;
  listAgents(): Promise<GroundedOmniChoice[]>;
}

export async function groundOmniAuthoringContext(
  session: SalesforceSession,
  params: SfFlowParams,
  dependencies: { adapter?: OmniGroundingAdapter } = {},
): Promise<OmniAuthorGroundingResult> {
  const adapter = dependencies.adapter ?? createDefaultAdapter(session);
  const limit = Math.max(1, Math.min(Math.floor(params.limit ?? DEFAULT_LIMIT), MAX_LIMIT));
  const terms = intentTerms(params.intent, params.object);
  const result: OmniAuthorGroundingResult = {
    target_org:
      params.target_org ?? session.target?.alias ?? session.target?.targetOrg ?? "configured org",
    api_version: session.target?.apiVersion,
    service_channels: [],
    queues: [],
    routing_configurations: [],
    skills: [],
    agents: [],
    coverage: { calls: [], gaps: [] },
  };

  const destination = params.omni_destination ?? "queue";
  await collect("service_channels", "ServiceChannel", () => adapter.listServiceChannels());
  if (destination === "queue" || destination === "agent") {
    await collect("queues", "Group:Queue", () => adapter.listQueues());
  }
  if (destination === "skills") {
    await collect("routing_configurations", "QueueRoutingConfig", () =>
      adapter.listRoutingConfigurations(),
    );
    await collect("skills", "Skill", () => adapter.listSkills());
  }
  if (destination === "agent") {
    await collect("agents", "User:Active", () => adapter.listAgents());
  }
  addReadinessGaps(result, params);
  return result;

  async function collect(
    key: "service_channels" | "queues" | "routing_configurations" | "skills" | "agents",
    call: string,
    load: () => Promise<GroundedOmniChoice[]>,
  ): Promise<void> {
    try {
      result[key] = selectChoices(await load(), terms, limit);
      result.coverage.calls.push(call);
    } catch (error) {
      result.coverage.gaps.push({ area: key, reason: errorMessage(error) });
    }
  }
}

function createDefaultAdapter(session: SalesforceSession): OmniGroundingAdapter {
  return {
    async listServiceChannels() {
      const query = await session.query<{
        DeveloperName?: string;
        MasterLabel?: string;
        RelatedEntity?: string;
      }>({
        soql: `SELECT DeveloperName, MasterLabel, RelatedEntity FROM ServiceChannel ORDER BY MasterLabel LIMIT ${QUERY_LIMIT}`,
        api: "rest",
        maxRows: QUERY_LIMIT,
      });
      return query.records.flatMap((record) =>
        record.DeveloperName
          ? [
              {
                developer_name: record.DeveloperName,
                label: record.MasterLabel ?? record.DeveloperName,
                detail: record.RelatedEntity,
              },
            ]
          : [],
      );
    },
    async listQueues() {
      const query = await session.query<{
        DeveloperName?: string;
        Name?: string;
        QueueRoutingConfigId?: string;
      }>({
        soql: `SELECT DeveloperName, Name, QueueRoutingConfigId FROM Group WHERE Type = 'Queue' ORDER BY Name LIMIT ${QUERY_LIMIT}`,
        api: "rest",
        maxRows: QUERY_LIMIT,
      });
      return query.records.flatMap((record) =>
        record.DeveloperName
          ? [
              {
                developer_name: record.DeveloperName,
                label: record.Name ?? record.DeveloperName,
                detail: record.QueueRoutingConfigId ? "routing configuration assigned" : undefined,
              },
            ]
          : [],
      );
    },
    async listRoutingConfigurations() {
      const query = await session.query<{
        DeveloperName?: string;
        MasterLabel?: string;
        RoutingModel?: string;
      }>({
        soql: `SELECT DeveloperName, MasterLabel, RoutingModel FROM QueueRoutingConfig ORDER BY MasterLabel LIMIT ${QUERY_LIMIT}`,
        api: "rest",
        maxRows: QUERY_LIMIT,
      });
      return query.records.flatMap((record) =>
        record.DeveloperName
          ? [
              {
                developer_name: record.DeveloperName,
                label: record.MasterLabel ?? record.DeveloperName,
                detail: record.RoutingModel,
              },
            ]
          : [],
      );
    },
    async listSkills() {
      const query = await session.query<{ DeveloperName?: string; MasterLabel?: string }>({
        soql: `SELECT DeveloperName, MasterLabel FROM Skill ORDER BY MasterLabel LIMIT ${QUERY_LIMIT}`,
        api: "rest",
        maxRows: QUERY_LIMIT,
      });
      return query.records.flatMap((record) =>
        record.DeveloperName
          ? [
              {
                developer_name: record.DeveloperName,
                label: record.MasterLabel ?? record.DeveloperName,
              },
            ]
          : [],
      );
    },
    async listAgents() {
      const query = await session.query<{ Username?: string; Name?: string }>({
        soql: `SELECT Username, Name FROM User WHERE IsActive = true ORDER BY Name LIMIT ${QUERY_LIMIT}`,
        api: "rest",
        maxRows: QUERY_LIMIT,
      });
      return query.records.flatMap((record) =>
        record.Username
          ? [{ developer_name: record.Username, label: record.Name ?? record.Username }]
          : [],
      );
    },
  };
}

function addReadinessGaps(result: OmniAuthorGroundingResult, params: SfFlowParams): void {
  const destination = params.omni_destination ?? "queue";
  const gap = (area: string, reason: string) => {
    if (!result.coverage.gaps.some((entry) => entry.area === area)) {
      result.coverage.gaps.push({ area, reason });
    }
  };
  if (!result.service_channels.length) {
    gap("service_channels", "No service channel is available for Omni-Channel routing.");
  }
  if ((destination === "queue" || destination === "agent") && !result.queues.length) {
    gap(
      "queues",
      destination === "agent"
        ? "Direct-agent routing requires a fallback queue."
        : "Queue routing requires a target queue.",
    );
  }
  if (destination === "agent" && !result.agents.length) {
    gap("agents", "Direct-agent routing requires an active target user.");
  }
  if (destination === "skills") {
    if (!result.skills.length) gap("skills", "Skills routing requires at least one skill.");
    if (!result.routing_configurations.length) {
      gap("routing_configurations", "Skills routing requires a queue routing configuration.");
    }
  }
}

function selectChoices(
  choices: GroundedOmniChoice[],
  terms: string[],
  limit: number,
): GroundedOmniChoice[] {
  const ranked = choices
    .map((choice) => ({ choice, score: matchScore(choice, terms) }))
    .sort(
      (left, right) =>
        right.score - left.score || left.choice.label.localeCompare(right.choice.label),
    );
  const matching = ranked.filter((candidate) => candidate.score > 0);
  return (matching.length ? matching : ranked).slice(0, limit).map(({ choice }) => choice);
}

function intentTerms(intent?: string, objectName?: string): string[] {
  const stop = new Set(["omni", "channel", "flow", "route", "routing", "work", "queue", "agent"]);
  return [
    ...new Set(
      `${intent ?? ""} ${objectName ?? ""}`
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((term) => term.length >= 3 && !stop.has(term)),
    ),
  ];
}

function matchScore(choice: GroundedOmniChoice, terms: string[]): number {
  const text = `${choice.developer_name} ${choice.label} ${choice.detail ?? ""}`.toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
