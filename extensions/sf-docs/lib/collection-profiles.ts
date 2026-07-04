/* SPDX-License-Identifier: Apache-2.0 */
/** Static collection coverage profiles for SF Docs routing and human explanation. */

export interface DocsCollectionProfile {
  collection: string;
  label: string;
  hosts: string[];
  urlTraits: string[];
  coverage: string;
  releaseNotes: string;
  references: string;
  routing: string;
  caveats: string[];
}

const COLLECTION_PROFILES: Record<string, DocsCollectionProfile> = {
  admin: {
    collection: "admin",
    label: "Salesforce Help and Admin docs",
    hosts: ["help.salesforce.com", "admin.salesforce.com"],
    urlTraits: ["Salesforce Help article pages", "admin.salesforce.com guides"],
    coverage: "Latest Salesforce product documentation plus a bounded release-note window.",
    releaseNotes:
      "Salesforce release notes are available for the latest three release-note releases.",
    references:
      "End-user and administrator help; developer reference material belongs in developer or legacydeveloper.",
    routing:
      "Use for Help articles, setup/admin questions, product docs, and Salesforce release-note lookups.",
    caveats: [
      "Use version=current for the collection slice; put seasonal releases in the query as +release:<n>.",
      "Current product docs can carry current-release metadata, so release-note answers still need release-note evidence.",
    ],
  },
  developer: {
    collection: "developer",
    label: "Current Salesforce Developer docs",
    hosts: ["developer.salesforce.com"],
    urlTraits: ["developer.salesforce.com/docs paths without atlas"],
    coverage:
      "Current Salesforce developer guides published through the modern developer-docs surface.",
    releaseNotes:
      "Use admin for Salesforce Help release notes unless a developer guide specifically owns the topic.",
    references:
      "Legacy Atlas/reference docs are not modeled as primary developer coverage here; use legacydeveloper for those lookups.",
    routing:
      "Use for current developer guides, SDK docs, LWC guides, API guides, and modern developer content without atlas URLs.",
    caveats: [
      "Do not treat collection version as a Salesforce seasonal release.",
      "Use legacydeveloper when Atlas/reference coverage is needed.",
    ],
  },
  legacydeveloper: {
    collection: "legacydeveloper",
    label: "Legacy Developer and Atlas reference docs",
    hosts: ["developer.salesforce.com"],
    urlTraits: ["developer.salesforce.com/docs/atlas", "atlas.en-us URLs"],
    coverage: "Current Atlas-backed developer reference and legacy developer documentation.",
    releaseNotes:
      "Use admin for Salesforce Help release notes; this collection is for developer/reference material.",
    references:
      "Primary collection for Atlas-style references such as Apex Reference, Metadata API, Tooling API, Object Reference, Visualforce, and Chatter REST.",
    routing:
      "Use for Atlas URLs and high-confidence developer reference queries until that content migrates to developer coverage.",
    caveats: [
      "URLs usually contain atlas or Atlas book paths.",
      "Prefer guide boosts such as guides:apexref, guides:api_meta, or guides:object_reference when known.",
    ],
  },
  architect: {
    collection: "architect",
    label: "Salesforce Architect docs",
    hosts: ["architect.salesforce.com"],
    urlTraits: ["architect.salesforce.com guidance and diagrams"],
    coverage:
      "Architecture guidance, decision guides, Well-Architected content, reference diagrams, and architecture resources.",
    releaseNotes: "Not a Salesforce release-note collection.",
    references: "Architecture guidance rather than API or metadata reference.",
    routing:
      "Use for Well-Architected, architecture decision, reference diagram, and cross-cloud architecture questions.",
    caveats: [
      "Guide boosts can scope architecture project or content type when the collection hints expose them.",
    ],
  },
  tableau: {
    collection: "tableau",
    label: "Tableau docs",
    hosts: ["help.tableau.com"],
    urlTraits: ["help.tableau.com pages"],
    coverage:
      "Tableau documentation across Desktop, Server, Cloud, Prep, Blueprint, Reader, Public, and developer APIs.",
    releaseNotes:
      "Use Tableau-specific guide or version hints rather than Salesforce seasonal release assumptions.",
    references: "Tableau product and API documentation, not Salesforce platform reference.",
    routing: "Use for Tableau product, admin, API, and Blueprint questions.",
    caveats: ["Collection locales and version slices differ from core Salesforce documentation."],
  },
  mulesoft: {
    collection: "mulesoft",
    label: "MuleSoft docs",
    hosts: ["docs.mulesoft.com"],
    urlTraits: ["docs.mulesoft.com pages"],
    coverage:
      "MuleSoft and Anypoint Platform documentation, including connector, runtime, DataWeave, API Manager, CloudHub, and related product docs.",
    releaseNotes:
      "Use MuleSoft collection hints and release metadata; do not apply Salesforce seasonal release assumptions.",
    references: "MuleSoft product, connector, runtime, and language reference material.",
    routing:
      "Use for MuleSoft, Anypoint, Mule runtime, DataWeave, connector, MUnit, and API Manager questions.",
    caveats: ["MuleSoft versioning semantics differ from Salesforce seasonal releases."],
  },
};

export function getDocsCollectionProfile(collection: string): DocsCollectionProfile | undefined {
  return COLLECTION_PROFILES[collection.trim().toLowerCase()];
}

export function docsCollectionProfilesFor(collections: string[]): DocsCollectionProfile[] {
  return collections
    .map((collection) => getDocsCollectionProfile(collection))
    .filter((profile): profile is DocsCollectionProfile => Boolean(profile));
}

export function summarizeDocsCollectionProfile(
  profile: DocsCollectionProfile,
): Record<string, string> {
  return {
    collection: profile.collection,
    label: profile.label,
    hosts: profile.hosts.join(", "),
    coverage: profile.coverage,
    releaseNotes: profile.releaseNotes,
    references: profile.references,
    routing: profile.routing,
    caveats: profile.caveats.join(" "),
  };
}
