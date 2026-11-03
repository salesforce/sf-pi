/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Cache-first SF Fin status.
 *
 * The status file stores only the last doctor outcome and non-secret workspace
 * identity so startup and `/sf-fin status` can render without a network call.
 */
import { createStateStore, type StateStore } from "../../../lib/common/state-store.ts";
import { detectRegion, detectTokenSource } from "./auth.ts";
import { ENV_TOKEN, PROVIDER_NAME, type FinStatusSnapshot } from "./types.ts";

export function createFinStatusStore(pathOverride?: string): StateStore<FinStatusSnapshot> {
  return createStateStore<FinStatusSnapshot>({
    namespace: "sf-fin",
    filename: "status.json",
    schemaVersion: 1,
    defaults: {},
    mode: 0o600,
    ...(pathOverride ? { pathOverride } : {}),
  });
}

export function buildStatusText(snapshot: FinStatusSnapshot): string {
  const source = detectTokenSource();
  const region = detectRegion();
  const lines = [
    "# SF Fin status",
    "",
    `- Credential: ${
      source === "pi-auth"
        ? `saved by /login ${PROVIDER_NAME}`
        : source === "env"
          ? `${ENV_TOKEN} environment variable`
          : "not connected"
    }`,
    `- Region: ${region.region.toUpperCase()} (${region.source === "default" ? "default" : region.source})`,
  ];

  if (snapshot.lastCheckedAt) {
    lines.push(`- Last doctor: ${snapshot.lastOutcome ?? "unknown"} at ${snapshot.lastCheckedAt}`);
  } else {
    lines.push("- Last doctor: never run");
  }
  if (snapshot.cliVersion) lines.push(`- Fin CLI: ${snapshot.cliVersion}`);
  const id = snapshot.identity;
  if (id?.workspaceName || id?.appId) {
    lines.push(
      `- Workspace: ${id.workspaceName ?? "(unnamed)"}${id.appId ? ` · app id ${id.appId}` : ""}`,
    );
  }
  if (id?.adminName || id?.adminEmail) {
    lines.push(`- Signed in as: ${[id.adminName, id.adminEmail].filter(Boolean).join(" · ")}`);
  }
  if (snapshot.lastMessage && snapshot.lastOutcome !== "ok") {
    lines.push(`- Last message: ${snapshot.lastMessage}`);
  }
  if (source === "none") {
    lines.push("", `Next: run /login ${PROVIDER_NAME}, then /sf-fin doctor.`);
  } else if (!snapshot.lastCheckedAt || snapshot.lastOutcome !== "ok") {
    lines.push("", "Next: run /sf-fin doctor to verify the credential against the workspace.");
  }
  return lines.join("\n");
}
