/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Curated Salesforce Setup destinations for SF Browser.
 *
 * This is intentionally small and public-safe. It is not a generated Setup
 * sitemap and should only contain paths we are comfortable treating as stable
 * shortcuts for first-shot navigation.
 */

export const SETUP_DESTINATIONS = {
  "setup-home": "/lightning/setup/SetupOneHome/home",
  "agentforce-agents": "/lightning/setup/EinsteinCopilot/home",
  "connected-apps": "/lightning/setup/ConnectedApplication/home",
  "data-cloud-setup": "/lightning/setup/CDPSetupHome/home",
  "external-client-apps": "/lightning/setup/ManageExternalClientApplication/home",
  flows: "/lightning/setup/Flows/home",
  "app-manager": "/lightning/setup/NavigationMenus/home",
  "certificate-key-management": "/lightning/setup/CertificatesAndKeysManagement/home",
  "identity-provider": "/lightning/setup/IdpPage/home",
  "login-history": "/lightning/setup/OrgLoginHistory/home",
  "named-credentials": "/lightning/setup/NamedCredential/home",
  "object-manager": "/lightning/setup/ObjectManager/home",
  "permission-set-groups": "/lightning/setup/PermSetGroups/home",
  "permission-sets": "/lightning/setup/PermSets/home",
  profiles: "/lightning/setup/EnhancedProfiles/home",
  "remote-site-settings": "/lightning/setup/SecurityRemoteProxy/home",
  "session-settings": "/lightning/setup/SecuritySession/home",
  "sharing-settings": "/lightning/setup/SecuritySharing/home",
  "single-sign-on-settings": "/lightning/setup/SingleSignOn/home",
  "trusted-urls": "/lightning/setup/SecurityCspTrustedSite/home",
  users: "/lightning/setup/ManageUsers/home",
} as const;

export type SetupDestination = keyof typeof SETUP_DESTINATIONS;

export function resolveSetupDestination(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const key = normalizeSetupDestination(value);
  return SETUP_DESTINATIONS[key as SetupDestination];
}

export function knownSetupDestinations(): string[] {
  return Object.keys(SETUP_DESTINATIONS).sort();
}

export function normalizeSetupDestination(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

export function formatKnownSetupDestinations(): string {
  return knownSetupDestinations().join(", ");
}
