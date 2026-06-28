/* SPDX-License-Identifier: Apache-2.0 */
/** Status and org preflight actions for sf-soql. */

import type { Connection } from "@salesforce/core";
import { apiCall, apiVersion, currentUserId, listSObjects, orgAlias, orgLimits } from "./api.ts";
import { buildDigest, row, section, toolResultFromDigest } from "./digest.ts";
import type { SfSoqlParams, ToolResult } from "./types.ts";

export async function status(conn: Connection, params: SfSoqlParams): Promise<ToolResult> {
  const userId = await currentUserId(conn);
  const digest = buildDigest({
    action: "status",
    status: "pass",
    icon: "🔎",
    title: "SF SOQL status",
    org: {
      alias: orgAlias(conn, params.target_org),
      api_version: apiVersion(conn),
      user_id: userId,
    },
    api_calls: [apiCall("GET", "/oauth2/userinfo", userId ? `user=${userId}` : undefined)],
    sections: [
      section("🧭", "Extension", [
        row("🔧", "Tool", "sf_soql"),
        row("⚡", "Hot path", "API-native REST/Tooling"),
        row("📦", "Evidence", "SOQL Artifacts"),
      ]),
    ],
  });
  return toolResultFromDigest(digest);
}

export async function orgPreflight(conn: Connection, params: SfSoqlParams): Promise<ToolResult> {
  const [userId, objects, limits] = await Promise.all([
    currentUserId(conn),
    listSObjects(conn),
    orgLimits(conn).catch(() => ({})),
  ]);
  const queryable = (objects.sobjects ?? []).filter((obj) => obj.queryable).length;
  const digest = buildDigest({
    action: "org.preflight",
    status: "pass",
    icon: "🧭",
    title: "SOQL Org Preflight · ready",
    org: {
      alias: orgAlias(conn, params.target_org),
      api_version: apiVersion(conn),
      user_id: userId,
    },
    meta: [`queryable=${queryable}`],
    api_calls: [
      apiCall("GET", `/services/data/v${apiVersion(conn)}/sobjects`, `queryable=${queryable}`),
      apiCall(
        "GET",
        `/services/data/v${apiVersion(conn)}/limits`,
        Object.keys(limits).length ? "limits=ok" : "limits=unknown",
      ),
    ],
    sections: [
      section("🧭", "Org Readiness", [
        row("🔌", "API", `v${apiVersion(conn)}`),
        row("👤", "User", userId),
        row("🔎", "Queryable", queryable),
        row("📈", "Query Plan", "available via /query?explain"),
      ]),
    ],
  });
  return toolResultFromDigest(digest);
}
