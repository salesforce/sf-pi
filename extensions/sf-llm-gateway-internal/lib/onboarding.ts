/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Onboarding deep-link builder for the gateway extension.
 *
 * The gateway sits behind SSO. Hitting `/oauth2/start` kicks off the SSO
 * dance and lands the user back on a post-login destination. Live-verified
 * against this gateway deployment, the only query param that overrides the
 * default post-login target is `rd=` (`next=` and `redirect=` are ignored).
 *
 * `<baseUrl>/oauth2/start?rd=/ui/?page=api-keys` → SSO → `/oauth2/callback`
 *   → LiteLLM session cookie → `/ui/?page=api-keys` (Virtual Keys tab).
 *
 * Users click `+ Create New Key`, copy the value, paste into pi's `/login`.
 * Single round trip, zero context switching between docs and the UI.
 *
 * Pure functions only: callers pass in the base URL, we return strings.
 * This module has no side effects so it is safe to exercise from unit tests
 * without mocking the browser or the identity provider.
 */
import { toGatewayRootBaseUrl } from "./gateway-url.ts";

/**
 * Named targets inside the LiteLLM admin UI. The SPA interprets these as
 * `?page=<key>` client-side, so they work even though the server returns
 * the same shell HTML regardless of the query. Add new targets here
 * sparingly \u2014 any drift from the upstream LiteLLM UI would send users to
 * an error page.
 */
export const OnboardingTarget = {
  ApiKeys: "api-keys",
} as const;

export type OnboardingTarget = (typeof OnboardingTarget)[keyof typeof OnboardingTarget];

/**
 * Build a one-click URL that takes the user through the gateway's SSO and
 * lands them on the requested LiteLLM admin UI tab. Returns an empty string
 * when `baseUrl` is missing so callers can treat "no configured base URL" as
 * "nothing to open" without throwing.
 */
export function buildOnboardingUrl(
  baseUrl: string | undefined,
  target: OnboardingTarget = OnboardingTarget.ApiKeys,
): string {
  if (!baseUrl) return "";
  const root = toGatewayRootBaseUrl(baseUrl);
  if (!root) return "";
  // `rd` is the only param honored by this LiteLLM build; the value is URL-
  // encoded inside the IdP's OAuth `state` so any path is fine here. Embed
  // `?page=<target>` directly so callers don't have to think about SPA
  // routing.
  return `${root}/oauth2/start?rd=/ui/?page=${encodeURIComponent(target)}`;
}
