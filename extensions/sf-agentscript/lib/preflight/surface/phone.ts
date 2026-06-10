/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only phone-number readiness checks for voice surfaces. */

import type { Connection } from "@salesforce/core";
import type { AgentFeatureProfile } from "../../feature-profile.ts";
import { needsVoiceReadiness, queryOptional, soqlEscape } from "./common.ts";
import type { SurfaceReadinessCheck } from "./types.ts";

interface PhoneNumberRow {
  Id?: string;
  Code?: string;
  CodeStatus?: string;
}

export async function checkPhoneReadiness(
  conn: Connection,
  profile: AgentFeatureProfile,
  opts: { phoneNumber?: string } = {},
): Promise<SurfaceReadinessCheck[]> {
  if (!needsVoiceReadiness(profile)) return [];
  const digits = opts.phoneNumber?.replace(/\D/g, "");
  const suffix = digits && digits.length >= 4 ? digits.slice(-7) : undefined;
  const where = suffix ? ` WHERE Code LIKE '%${soqlEscape(suffix)}%'` : "";
  const rows = await queryOptional<PhoneNumberRow>(
    conn,
    `SELECT Id, Code, CodeStatus FROM PhoneNumber${where} LIMIT 10`,
  );
  if (rows === null) {
    return [
      {
        code: "voice-phone-number-unverifiable",
        surface: "voice",
        status: "unverifiable",
        message: "Could not verify voice phone-number readiness in the target org.",
      },
    ];
  }
  if (rows.length === 0) {
    return [
      {
        code: suffix ? "voice-phone-number-not-found" : "voice-phone-number-missing",
        surface: "voice",
        status: "warning",
        message: suffix
          ? "No phone number matching the requested suffix was found in the target org. Voice calls may not reach this org."
          : "No phone numbers were found in the target org. Voice calls may not reach this org.",
        ...(opts.phoneNumber ? { evidence: [`phone_number: ${opts.phoneNumber}`] } : {}),
      },
    ];
  }
  const live = rows.filter((row) => row.CodeStatus === "Live");
  if (live.length === 0) {
    return [
      {
        code: "voice-phone-number-not-live",
        surface: "voice",
        status: "warning",
        message:
          "Phone numbers exist, but none are Live. Voice calls may not reach the Agentforce channel yet.",
        evidence: rows.map(formatPhoneEvidence),
      },
    ];
  }
  return [
    {
      code: "voice-phone-number-live",
      surface: "voice",
      status: "ok",
      message: "A Live phone number is present in the target org.",
      evidence: live.map(formatPhoneEvidence),
    },
  ];
}

function formatPhoneEvidence(row: PhoneNumberRow): string {
  return `${row.Code ?? row.Id ?? "PhoneNumber"}${row.CodeStatus ? ` (${row.CodeStatus})` : ""}`;
}
