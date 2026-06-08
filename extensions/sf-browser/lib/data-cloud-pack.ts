/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Data Cloud Destination Pack for SF Browser.
 *
 * A Destination Pack is a separate, live-verified navigation registry for one
 * product area. It is intentionally NOT part of the small curated Setup
 * Destination list (`setup-destinations.ts`) and it is NOT a runtime live menu
 * scraper.
 *
 * Two rules keep this honest and non-brittle:
 *
 * 1. The runtime agent navigates ONLY to `verified` entries. `candidate` and
 *    `broken` entries are review state for the Navigation Hardening Harness,
 *    never runtime navigation state.
 * 2. Entries are not hand-guessed into `verified`. The seed only promotes paths
 *    we can ground (the Data Cloud Setup home). Everything else starts as a
 *    `candidate` for the dev-time harness (`scripts/e2e/sf-browser-pack-harden.ts`)
 *    to open, screenshot, verify, and promote — or mark `broken` on drift.
 *
 * See ADR 0030 and the CONTEXT.md terms Destination Pack, Navigation Surface,
 * and Navigation Hardening Harness.
 */

import type {
  SetupDestinationExpectedSurface,
  SetupDestinationSuggestedWait,
} from "./setup-destinations.ts";

/**
 * Which kind of Salesforce URL family an entry points at. One uniform
 * resolve -> open -> wait -> snapshot workflow carries these differences.
 */
export type NavigationSurface = "setup-node" | "app-tab" | "builder-page";

/**
 * Lifecycle status. Only `verified` entries are navigable at runtime.
 */
export type DataCloudEntryStatus = "verified" | "candidate" | "broken";

export type DataCloudDestinationRecord = {
  /** Stable, public-safe id used by `{ type: "data-cloud", destination: "<id>" }`. */
  id: string;
  /** Human label for reports and reference docs. */
  label: string;
  /** URL family discriminator. */
  surface: NavigationSurface;
  /** What an agent uses this destination for. */
  useFor: string;
  /**
   * Resolved Lightning/Setup path. Required and non-empty for `verified`
   * entries. May be empty for `candidate` entries the harness must discover.
   */
  path: string;
  /** Expected Salesforce surface the harness asserts after navigation. */
  expectedSurface: SetupDestinationExpectedSurface;
  /** Suggested Lightning-Aware Wait after opening. */
  suggestedWait: SetupDestinationSuggestedWait;
  /** Default snapshot focus terms. */
  defaultFocus: string[];
  /** Lifecycle status; runtime navigation requires `verified`. */
  status: DataCloudEntryStatus;
  /**
   * Optional discovery hint for the Navigation Hardening Harness when `path`
   * is not yet known — e.g. the owning app dev name and the in-app nav label
   * to match by snapshot+click. Never used by the runtime resolver.
   */
  discoveryHint?: {
    app?: string;
    navLabel?: string;
    fromSetupHome?: boolean;
  };
};

/**
 * Registry.
 *
 * Setup nodes (`setup-node`) carry portable `/lightning/setup/.../home` paths and
 * are the runtime-navigable core: they were discovered from the live Data Cloud
 * Setup Home left nav and confirmed reachable by the Navigation Hardening
 * Harness against a real org (see ADR 0030). This is the Data Cloud Settings
 * menu.
 *
 * The `app` entry is the Data Cloud Lightning app. Its container URL uses an
 * org-specific id (`/lightning/app/06m...`), so it is NOT a portable static
 * path and stays a non-navigable pointer: the agent opens the app via the App
 * Launcher, then reaches app tabs (Data Streams, Data Lake Objects, Data Model,
 * Segments, Activations, ...) by snapshot + click. Turning those tabs into
 * portable verified `builder-page`/`app-tab` entries needs a click-to-resolve
 * discovery pass (reads the real per-tab URL); that is a tracked follow-up, not
 * shipped here, so we never ship guessed app-tab paths.
 */
const DATA_CLOUD_DESTINATION_RECORDS = [
  {
    id: "setup-home",
    label: "Data Cloud Setup Home",
    surface: "setup-node",
    useFor: "Data Cloud Setup landing page and starting point for Data Cloud settings navigation.",
    path: "/lightning/setup/CDPSetupHome/home",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Data Cloud", "Setup", "Get Started"],
    status: "verified",
  },
  {
    id: "data-spaces",
    label: "Data Spaces",
    surface: "setup-node",
    useFor: "Data Spaces settings: create and manage Data Cloud data spaces.",
    path: "/lightning/setup/CdpDataSpaces/home",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Data Spaces", "New Data Space"],
    status: "verified",
  },
  {
    id: "feature-manager",
    label: "Feature Manager",
    surface: "setup-node",
    useFor: "Data Cloud Feature Manager: admin tools, developer tools, and clean rooms.",
    path: "/lightning/setup/BetaFeaturesSetup/home",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Feature Manager", "Admin Tools", "Developer Tools"],
    status: "verified",
  },
  {
    id: "data-cloud-one",
    label: "Data Cloud One",
    surface: "setup-node",
    useFor: "Data Cloud One remote connections setup.",
    path: "/lightning/setup/RemoteConnectionsSetup/home",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Data Cloud One", "Remote Connections"],
    status: "verified",
  },
  {
    id: "salesforce-crm",
    label: "Salesforce CRM",
    surface: "setup-node",
    useFor: "Salesforce CRM connector setup for Data Cloud.",
    path: "/lightning/setup/SfdcSetup/home",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Salesforce CRM", "Connector"],
    status: "verified",
  },
  {
    id: "hierarchy-ingestion",
    label: "Hierarchy Ingestion",
    surface: "setup-node",
    useFor: "Hierarchy Ingestion settings for Data Cloud.",
    path: "/lightning/setup/HierarchyIngestion/home",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Hierarchy Ingestion"],
    status: "verified",
  },
  {
    id: "data-360-org-allowlist",
    label: "Data 360 Org Allowlist",
    surface: "setup-node",
    useFor: "Data 360 org-to-org allowlist settings.",
    path: "/lightning/setup/DcToDcAllowlist/home",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Allowlist", "Org"],
    status: "verified",
  },
  {
    id: "external-activation-platforms",
    label: "External Activation Platforms",
    surface: "setup-node",
    useFor: "External activation platform connections for Data Cloud.",
    path: "/lightning/setup/ExternalActivationPlatform/home",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["External Activation Platforms"],
    status: "verified",
  },
  {
    id: "snowflake",
    label: "Snowflake",
    surface: "setup-node",
    useFor: "Snowflake connector setup for Data Cloud.",
    path: "/lightning/setup/SnowflakeSetup/home",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Snowflake"],
    status: "verified",
  },
  {
    id: "websites-and-mobile-apps",
    label: "Websites & Mobile Apps",
    surface: "setup-node",
    useFor: "Websites & Mobile Apps streaming ingestion setup for Data Cloud.",
    path: "/lightning/setup/StreamingAppSetup/home",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Websites", "Mobile Apps"],
    status: "verified",
  },
  {
    id: "ingestion-api",
    label: "Ingestion API",
    surface: "setup-node",
    useFor: "Ingestion API setup for Data Cloud.",
    path: "/lightning/setup/IngestionApiSetup/home",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Ingestion API"],
    status: "verified",
  },
  {
    id: "other-connectors",
    label: "Other Connectors",
    surface: "setup-node",
    useFor: "Other Data Cloud source connectors setup.",
    path: "/lightning/setup/ConnectorsFrameworkSetup/home",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "navigation-ready" },
    defaultFocus: ["Connectors"],
    status: "verified",
  },
  {
    id: "app",
    label: "Data Cloud App",
    surface: "app-tab",
    useFor:
      "Data Cloud Lightning app. The app container URL is org-specific, so open it via the App Launcher, then reach tabs (Data Streams, Data Lake Objects, Data Model, Segments, Activations, ...) by snapshot + click.",
    path: "",
    expectedSurface: "Lightning Setup page",
    suggestedWait: { lightning: "app-ready" },
    defaultFocus: ["Data Cloud", "Data Streams", "Data Model"],
    status: "candidate",
    discoveryHint: { app: "Audience360" },
  },
] as const satisfies readonly DataCloudDestinationRecord[];

export type DataCloudDestinationId = (typeof DATA_CLOUD_DESTINATION_RECORDS)[number]["id"];

/** All records (verified, candidate, broken). For the harness and reference generation. */
export function dataCloudDestinationRecords(): DataCloudDestinationRecord[] {
  return [...DATA_CLOUD_DESTINATION_RECORDS].sort((a, b) => a.id.localeCompare(b.id));
}

/** Look up any record by id, regardless of status. */
export function getDataCloudDestination(
  value: string | undefined,
): DataCloudDestinationRecord | undefined {
  if (!value) return undefined;
  const key = normalizeDataCloudDestination(value);
  return DATA_CLOUD_DESTINATION_RECORDS.find((record) => record.id === key);
}

/** Ids navigable at runtime: verified entries with a concrete path. */
export function navigableDataCloudDestinations(): string[] {
  return DATA_CLOUD_DESTINATION_RECORDS.filter(isNavigable)
    .map((record) => record.id)
    .sort();
}

/** All ids, including candidate/broken, for reference docs and the harness. */
export function knownDataCloudDestinations(): string[] {
  return DATA_CLOUD_DESTINATION_RECORDS.map((record) => record.id).sort();
}

export function isNavigable(record: DataCloudDestinationRecord): boolean {
  return record.status === "verified" && record.path.trim().length > 0;
}

export function normalizeDataCloudDestination(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

export function formatNavigableDataCloudDestinations(): string {
  const ids = navigableDataCloudDestinations();
  return ids.length ? ids.join(", ") : "(none verified yet — run the hardening harness)";
}
