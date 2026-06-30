/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Curated Salesforce Setup destinations for SF Browser.
 *
 * This is intentionally small and public-safe. It is not a generated Setup
 * sitemap and should only contain paths we are comfortable treating as stable
 * shortcuts for first-shot navigation.
 */

export type SetupDestinationExpectedSurface =
  "Lightning Setup page" | "Classic Setup Surface" | "Builder surface" | "Unknown Salesforce page";

export type SetupDestinationSuggestedWait = {
  lightning: "navigation-ready" | "app-ready";
};

export type SetupDestinationRecord = {
  id: string;
  path: string;
  label: string;
  useFor: string;
  expectedSurface: SetupDestinationExpectedSurface;
  suggestedWait: SetupDestinationSuggestedWait;
  defaultFocus: string[];
  runbookRefs: string[];
};

const SETUP_DESTINATION_RECORDS = [
  {
    id: "setup-home",
    path: "/lightning/setup/SetupOneHome/home",
    label: "Setup Home",
    useFor: "Setup landing page and general navigation starting point.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Setup", "Quick Find", "Object Manager"],
    runbookRefs: ["setup-destinations.md"],
  },
  {
    id: "agentforce-agents",
    path: "/lightning/setup/EinsteinCopilot/home",
    label: "Agentforce Agents",
    useFor: "Agentforce Agents setup, Agentforce enablement evidence, New Agent entry point.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Agentforce", "Agents", "New Agent"],
    runbookRefs: ["setup-runbooks.md#verify-agentforce-enablement"],
  },
  {
    id: "app-manager",
    path: "/lightning/setup/NavigationMenus/home",
    label: "App Manager",
    useFor: "App Manager / Lightning app list evidence and fallback navigation.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["App Manager", "New Lightning App", "Edit"],
    runbookRefs: ["setup-runbooks.md#app-manager-and-lightning-apps"],
  },
  {
    id: "certificate-key-management",
    path: "/lightning/setup/CertificatesAndKeysManagement/home",
    label: "Certificate and Key Management",
    useFor: "Certificates, keys, and API client certificate evidence.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Certificate", "Key", "Create"],
    runbookRefs: ["setup-runbooks.md#certificate-and-key-management"],
  },
  {
    id: "connected-apps",
    path: "/lightning/setup/ConnectedApplication/home",
    label: "Connected Apps",
    useFor: "Manage Connected Apps, OAuth usage and policy evidence.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Connected Apps", "Manage Connected Apps", "View"],
    runbookRefs: ["setup-runbooks.md#external-client-apps-and-connected-apps-and-connected-apps"],
  },
  {
    id: "data-cloud-setup",
    path: "/lightning/setup/CDPSetupHome/home",
    label: "Data Cloud Setup",
    useFor: "Data Cloud Setup Home evidence after Data 360 API readiness checks.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Data Cloud", "Setup", "Get Started"],
    runbookRefs: ["setup-runbooks.md#data-cloud-setup-and-readiness"],
  },
  {
    id: "external-client-apps",
    path: "/lightning/setup/ManageExternalClientApplication/home",
    label: "External Client Apps",
    useFor: "External Client Apps setup evidence and UI fallback navigation.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["External Client Apps", "New", "View"],
    runbookRefs: ["setup-runbooks.md#external-client-apps-and-connected-apps"],
  },
  {
    id: "flows",
    path: "/lightning/setup/Flows/home",
    label: "Flows",
    useFor: "Flow list, Flow Builder entry, flow activation evidence.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Flows", "New Flow", "Open"],
    runbookRefs: ["setup-runbooks.md#flow-setup-and-activation-evidence"],
  },
  {
    id: "identity-provider",
    path: "/lightning/setup/IdpPage/home",
    label: "Identity Provider",
    useFor: "Identity Provider setup evidence and fallback navigation.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Identity Provider", "Enable", "Download Certificate"],
    runbookRefs: ["setup-runbooks.md#identity-provider-and-single-sign-on-settings"],
  },
  {
    id: "login-history",
    path: "/lightning/setup/OrgLoginHistory/home",
    label: "Login History",
    useFor: "Login History evidence and identity/security investigation support.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Login History", "Download", "Status"],
    runbookRefs: ["setup-runbooks.md#login-history-evidence"],
  },
  {
    id: "my-domain",
    path: "/lightning/setup/OrgDomain/home",
    label: "My Domain",
    useFor: "My Domain rename, provisioning, deployment evidence, and UI-only fallback.",
    expectedSurface: "Classic Setup Surface",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["My Domain", "Check Availability", "Save", "Deploy"],
    runbookRefs: ["setup-runbooks.md#change-my-domain-name"],
  },
  {
    id: "named-credentials",
    path: "/lightning/setup/NamedCredential/home",
    label: "Named Credentials",
    useFor: "Named Credentials setup evidence.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Named Credentials", "External Credentials", "New"],
    runbookRefs: ["setup-runbooks.md#named-credentials-and-external-credentials"],
  },
  {
    id: "object-manager",
    path: "/lightning/setup/ObjectManager/home",
    label: "Object Manager",
    useFor: "Object and field setup navigation.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Object Manager", "Quick Find", "Fields & Relationships"],
    runbookRefs: ["setup-destinations.md"],
  },
  {
    id: "permission-set-groups",
    path: "/lightning/setup/PermSetGroups/home",
    label: "Permission Set Groups",
    useFor: "Permission Set Group list and assignment fallback support.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Permission Set Groups", "New Permission Set Group", "View Summary"],
    runbookRefs: ["setup-runbooks.md#assign-or-remove-a-permission-set-group"],
  },
  {
    id: "permission-sets",
    path: "/lightning/setup/PermSets/home",
    label: "Permission Sets",
    useFor: "Permission Set list and assignment fallback support.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Permission Sets", "Manage Assignments", "View Summary"],
    runbookRefs: ["setup-runbooks.md#assign-or-remove-a-permission-set"],
  },
  {
    id: "profiles",
    path: "/lightning/setup/EnhancedProfiles/home",
    label: "Profiles",
    useFor: "Profile list/evidence and profile setup navigation.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Profiles", "Profile Name", "View"],
    runbookRefs: ["setup-runbooks.md#profiles-evidence-and-fallback"],
  },
  {
    id: "remote-site-settings",
    path: "/lightning/setup/SecurityRemoteProxy/home",
    label: "Remote Site Settings",
    useFor: "Remote Site Settings evidence and metadata fallback support.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Remote Site Settings", "New Remote Site", "Remote Site URL"],
    runbookRefs: ["setup-runbooks.md#trusted-urls-and-remote-site-settings"],
  },
  {
    id: "session-settings",
    path: "/lightning/setup/SecuritySession/home",
    label: "Session Settings",
    useFor: "Session timeout, clickjack, CSP, and related security setting evidence.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Session Settings", "Timeout", "Clickjack"],
    runbookRefs: ["setup-runbooks.md#sharing-settings-and-security-settings"],
  },
  {
    id: "sharing-settings",
    path: "/lightning/setup/SecuritySharing/home",
    label: "Sharing Settings",
    useFor: "Organization-Wide Defaults and sharing-rule evidence.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Sharing Settings", "Organization-Wide Defaults", "Sharing Rules"],
    runbookRefs: ["setup-runbooks.md#sharing-settings-and-security-settings"],
  },
  {
    id: "single-sign-on-settings",
    path: "/lightning/setup/SingleSignOn/home",
    label: "Single Sign-On Settings",
    useFor: "SAML / SSO setup evidence and fallback navigation.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Single Sign-On Settings", "SAML", "New"],
    runbookRefs: ["setup-runbooks.md#identity-provider-and-single-sign-on-settings"],
  },
  {
    id: "trusted-urls",
    path: "/lightning/setup/SecurityCspTrustedSite/home",
    label: "Trusted URLs",
    useFor: "Trusted URLs / CSP Trusted Sites setup evidence.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Trusted URLs", "CSP", "New Trusted URL"],
    runbookRefs: ["setup-runbooks.md#trusted-urls-and-remote-site-settings"],
  },
  {
    id: "users",
    path: "/lightning/setup/ManageUsers/home",
    label: "Users",
    useFor: "User records, user access evidence, permission-assignment fallback navigation.",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Users", "User Name", "Permission Set Assignments"],
    runbookRefs: ["setup-runbooks.md#open-user-record-and-verify-user-access"],
  },
] as const satisfies readonly SetupDestinationRecord[];

export const SETUP_DESTINATIONS = Object.fromEntries(
  SETUP_DESTINATION_RECORDS.map((destination) => [destination.id, destination.path]),
) as Record<(typeof SETUP_DESTINATION_RECORDS)[number]["id"], string>;

export type SetupDestination = keyof typeof SETUP_DESTINATIONS;

export function getSetupDestination(value: string | undefined): SetupDestinationRecord | undefined {
  if (!value) return undefined;
  const key = normalizeSetupDestination(value);
  return SETUP_DESTINATION_RECORDS.find((destination) => destination.id === key);
}

export function getSetupDestinationByPath(
  path: string | undefined,
): SetupDestinationRecord | undefined {
  if (!path) return undefined;
  return SETUP_DESTINATION_RECORDS.find((destination) => destination.path === path);
}

export function resolveSetupDestination(value: string | undefined): string | undefined {
  return getSetupDestination(value)?.path;
}

export function knownSetupDestinations(): string[] {
  return SETUP_DESTINATION_RECORDS.map((destination) => destination.id).sort();
}

export function knownSetupDestinationRecords(): SetupDestinationRecord[] {
  return [...SETUP_DESTINATION_RECORDS].sort((a, b) => a.id.localeCompare(b.id));
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
