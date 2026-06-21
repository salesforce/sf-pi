/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only SFAP route probes for Agent Script doctor output. */

import type { Connection } from "@salesforce/core";
import { connForAgentApi } from "./agent-api-auth.ts";
import { boundedSoqlQuery } from "./bounded-salesforce-transport.ts";
import { connFromAlias, resolveOrgIdentity } from "../../../lib/common/sf-conn/connection.ts";
import { callEval, type EvalApiHeaders } from "./eval/eval-client.ts";
import { isSfapRoutingFailure, sfapRequest } from "./eval/sfap.ts";

const AUTHORING_SCRIPTS_URL = "https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/scripts";
const PROD_AGENT_SESSION_URL = (botId: string): string =>
  `https://api.salesforce.com/einstein/ai-agent/v1/agents/${botId}/sessions`;

export type SfapProbeStatus = "ok" | "reachable" | "unavailable" | "auth_failed" | "skipped";

export interface SfapProbeResult {
  status: SfapProbeStatus;
  detail: string;
  http_status?: number;
}

export interface SfapReadinessReport {
  target_org: string;
  named_user_jwt: SfapProbeResult;
  eval_api: SfapProbeResult;
  authoring_api: SfapProbeResult;
  preview_api: SfapProbeResult;
}

function summarizeBody(body: unknown): string {
  return JSON.stringify(body ?? {}).slice(0, 240);
}

function classifyRoute(status: number, body: unknown): SfapProbeResult {
  if (status >= 200 && status < 300) {
    return { status: "ok", http_status: status, detail: "reachable" };
  }
  if (isSfapRoutingFailure({ status, body, endpoint: "" })) {
    return {
      status: "unavailable",
      http_status: status,
      detail: "route returned 404 across SFAP host fallback",
    };
  }
  if (status === 401 || /Invalid token|Bad_Id|OAuthException/i.test(summarizeBody(body))) {
    return {
      status: "auth_failed",
      http_status: status,
      detail: summarizeBody(body),
    };
  }
  return {
    status: "reachable",
    http_status: status,
    detail: summarizeBody(body),
  };
}

async function firstActiveBotId(conn: Connection): Promise<string | undefined> {
  const r = await boundedSoqlQuery<{ BotDefinitionId: string }>(
    conn,
    "SELECT BotDefinitionId FROM BotVersion WHERE Status='Active' LIMIT 1",
  );
  if (r.ok === false) return undefined;
  return r.records[0]?.BotDefinitionId;
}

export async function probeSfapReadiness(targetOrg?: string): Promise<SfapReadinessReport> {
  const normalConn = await connFromAlias(targetOrg);
  const target = targetOrg ?? normalConn.getUsername() ?? "<default>";

  let agentApiConn: Connection | undefined;
  let namedUserJwt: SfapProbeResult;
  try {
    ({ conn: agentApiConn } = await connForAgentApi(targetOrg));
    namedUserJwt = { status: "ok", detail: "named-user JWT bootstrap succeeded" };
  } catch (err) {
    namedUserJwt = {
      status: "auth_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  let evalApi: SfapProbeResult;
  try {
    const identity = await resolveOrgIdentity(normalConn);
    const headers: EvalApiHeaders = {
      orgId: identity.org_id,
      instanceUrl: identity.instance_url,
      userId: identity.user_id,
    };
    const res = await callEval(normalConn, [], headers, { timeoutMs: 30_000 });
    evalApi = classifyRoute(res.status, res.body);
  } catch (err) {
    evalApi = {
      status: "auth_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  let authoringApi: SfapProbeResult;
  if (!agentApiConn) {
    authoringApi = { status: "skipped", detail: "named-user JWT bootstrap failed" };
  } else {
    const res = await sfapRequest(agentApiConn, {
      url: AUTHORING_SCRIPTS_URL,
      method: "POST",
      headers: { "x-client-name": "sf-pi", "content-type": "application/json" },
      body: { assets: [], afScriptVersion: "2.0.0" },
      timeoutMs: 30_000,
      maxRetries: 0,
    });
    authoringApi = classifyRoute(res.status, res.body);
  }

  let previewApi: SfapProbeResult;
  if (!agentApiConn) {
    previewApi = { status: "skipped", detail: "named-user JWT bootstrap failed" };
  } else {
    const botId = await firstActiveBotId(normalConn);
    if (!botId) {
      previewApi = { status: "skipped", detail: "no active BotVersion found to probe" };
    } else {
      // Invalid/minimal body: proves route/auth without creating a session.
      const res = await sfapRequest(agentApiConn, {
        url: PROD_AGENT_SESSION_URL(botId),
        method: "POST",
        headers: { "x-client-name": "sf-pi", "content-type": "application/json" },
        body: {},
        timeoutMs: 30_000,
        maxRetries: 0,
      });
      previewApi = classifyRoute(res.status, res.body);
    }
  }

  return {
    target_org: target,
    named_user_jwt: namedUserJwt,
    eval_api: evalApi,
    authoring_api: authoringApi,
    preview_api: previewApi,
  };
}
