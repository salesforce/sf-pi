# SF Browser Data Cloud Destination Pack

A **Destination Pack** is a separate, live-verified navigation registry for one
product area. It is not part of the intentionally small curated
[Setup Destinations](./setup-destinations.md) list, and it is not a runtime live
menu scraper. The runtime agent navigates only to **verified** entries; the
dev-time Navigation Hardening Harness discovers, verifies, screenshots, and
proposes the rest. See ADR 0030.

The runtime registry in `lib/data-cloud-pack.ts` is the source of truth; this
table is drift-tested against it.

Navigate with the structured route:

```json
{
  "target_org": "my-org",
  "route": { "type": "data-cloud", "destination": "data-spaces" }
}
```

## Verified destinations (Data Cloud Settings menu)

These carry portable `/lightning/setup/.../home` paths confirmed reachable by
the Navigation Hardening Harness.

| Destination                     | Path                                               | Use for                                                      |
| ------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| `setup-home`                    | `/lightning/setup/CDPSetupHome/home`               | Data Cloud Setup landing page and settings navigation start. |
| `data-spaces`                   | `/lightning/setup/CdpDataSpaces/home`              | Create and manage Data Cloud data spaces.                    |
| `feature-manager`               | `/lightning/setup/BetaFeaturesSetup/home`          | Admin tools, developer tools, and clean rooms.               |
| `data-cloud-one`                | `/lightning/setup/RemoteConnectionsSetup/home`     | Data Cloud One remote connections.                           |
| `salesforce-crm`                | `/lightning/setup/SfdcSetup/home`                  | Salesforce CRM connector setup.                              |
| `hierarchy-ingestion`           | `/lightning/setup/HierarchyIngestion/home`         | Hierarchy ingestion settings.                                |
| `data-360-org-allowlist`        | `/lightning/setup/DcToDcAllowlist/home`            | Data 360 org-to-org allowlist.                               |
| `external-activation-platforms` | `/lightning/setup/ExternalActivationPlatform/home` | External activation platform connections.                    |
| `snowflake`                     | `/lightning/setup/SnowflakeSetup/home`             | Snowflake connector setup.                                   |
| `websites-and-mobile-apps`      | `/lightning/setup/StreamingAppSetup/home`          | Websites & Mobile Apps streaming ingestion.                  |
| `ingestion-api`                 | `/lightning/setup/IngestionApiSetup/home`          | Ingestion API setup.                                         |
| `other-connectors`              | `/lightning/setup/ConnectorsFrameworkSetup/home`   | Other source connectors.                                     |

## The Data Cloud app and its tabs

The `app` entry is the Data Cloud Lightning app. Its container URL uses an
org-specific id (`/lightning/app/06m...`), so it is not a portable static path
and is not runtime-navigable. Open the app through the App Launcher, then reach
its tabs (Data Streams, Data Lake Objects, Data Model, Data Governance, Data
Explorer, AI Models, Semantic Layer, and more) by snapshot + click.

Turning individual app tabs into portable verified entries needs a
click-to-resolve discovery pass (open the app, click a tab, read the real
per-tab URL). That is a tracked follow-up; the pack never ships guessed app-tab
paths.

## Hardening

Re-verify and extend this pack against a live org. The harness covers every
navigation surface via `--surface` (default `all`): `data-cloud`,
`setup-destinations`, and `routes`.

```bash
npm run e2e:sf-browser-harden -- --org <alias>                    # all surfaces
npm run e2e:sf-browser-harden -- --org <alias> --surface data-cloud
npm run e2e:sf-browser-harden -- --org <alias> --mutate
```

The harness writes one Browser Evidence screenshot per entry plus a
group-tagged contact-sheet `report.html`, and prints confirmed/proposed paths
to review before promoting entries to `status: "verified"`.
