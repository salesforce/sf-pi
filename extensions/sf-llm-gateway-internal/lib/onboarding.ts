/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Onboarding URL builder for the gateway extension.
 *
 * The gateway sits behind SSO, and deployment-specific auth routes can drift
 * or reject direct browser GETs. The only stable browser entry point is the
 * configured gateway root. This helper therefore canonicalizes any configured
 * route suffix (`/v1`, `/bedrock`, `/bedrock/v1`) back to the root and returns
 * that URL.
 *
 * Users sign in at the gateway root, open the key-management area in the UI,
 * create or rotate a key, then paste the value into pi's `/login` or setup
 * panel.
 *
 * Pure functions only: callers pass in the base URL, we return strings.
 * This module has no side effects so it is safe to exercise from unit tests
 * without mocking the browser or the identity provider.
 */
import { toGatewayRootBaseUrl } from "./gateway-url.ts";

/**
 * Historical target names retained for source compatibility. The current
 * onboarding URL intentionally ignores tab targets and returns only the stable
 * gateway root.
 */
export const OnboardingTarget = {
  ApiKeys: "api-keys",
} as const;

export type OnboardingTarget = (typeof OnboardingTarget)[keyof typeof OnboardingTarget];

/**
 * Build the stable browser URL for gateway onboarding. Returns an empty string
 * when `baseUrl` is missing so callers can treat "no configured base URL" as
 * "nothing to open" without throwing.
 *
 * `_target` is retained for source compatibility with earlier callers that
 * requested a UI tab-specific deep link. It is intentionally ignored because
 * root-only navigation is the stable behavior.
 */
export function buildOnboardingUrl(
  baseUrl: string | undefined,
  _target: OnboardingTarget = OnboardingTarget.ApiKeys,
): string {
  if (!baseUrl) return "";
  const root = toGatewayRootBaseUrl(baseUrl);
  return root ?? "";
}
