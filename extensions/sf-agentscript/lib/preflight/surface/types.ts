/* SPDX-License-Identifier: Apache-2.0 */
/** Shared contract for Surface Readiness Preflight adapters. */

export type SurfaceReadinessStatus = "ok" | "warning" | "blocker" | "unverifiable";

export interface SurfaceReadinessCheck {
  code: string;
  surface: "voice" | "messaging";
  status: SurfaceReadinessStatus;
  message: string;
  evidence?: string[];
}
