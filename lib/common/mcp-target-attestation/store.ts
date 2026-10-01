/* SPDX-License-Identifier: Apache-2.0 */
/** One-use, session-local exact-org evidence shared by SF MCP and SF Guardrail. */
import { createHash } from "node:crypto";

export interface McpTargetAttestation {
  sessionId: string;
  serverName: string;
  nextTool: string;
  configFingerprint: string;
  orgId: string;
  isSandbox: boolean;
  expiresAt: number;
}

export interface McpTargetAttestationKey {
  sessionId: string;
  serverName: string;
  nextTool: string;
  configFingerprint: string;
}

const attestations = new Map<string, McpTargetAttestation>();

export function canonicalMcpServerName(serverName: string): string {
  return serverName.replace(/-/g, "_");
}

export function fingerprintMcpServerConfig(config: unknown): string {
  return createHash("sha256").update(stableJson(config)).digest("hex").slice(0, 16);
}

export function recordMcpTargetAttestation(attestation: McpTargetAttestation): void {
  attestations.set(attestationKey(attestation), {
    ...attestation,
    serverName: canonicalMcpServerName(attestation.serverName),
  });
}

export function takeMcpTargetAttestation(
  input: McpTargetAttestationKey,
  now = Date.now(),
): McpTargetAttestation | undefined {
  const key = attestationKey(input);
  const attestation = attestations.get(key);
  if (!attestation) return undefined;
  if (attestation.expiresAt <= now) {
    attestations.delete(key);
    return undefined;
  }
  attestations.delete(key);
  return { ...attestation };
}

export function clearMcpTargetAttestations(sessionId?: string): void {
  if (!sessionId) {
    attestations.clear();
    return;
  }
  for (const [key, attestation] of attestations) {
    if (attestation.sessionId === sessionId) attestations.delete(key);
  }
}

function attestationKey(input: McpTargetAttestationKey): string {
  return [
    input.sessionId,
    canonicalMcpServerName(input.serverName),
    input.nextTool,
    input.configFingerprint,
  ].join("|");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
