# SF Docs Result Mocks

These examples show the split between human-facing **Docs Result Cards** and model-facing **Docs Evidence Packets**. Human cards use a consistent layered shape so developers can follow the retrieval lineage: header → lineage → evidence → next step. Evidence packets carry bounded official source text for the LLM.

## Search

### Human sees

```text
📚 SF Docs · search  legacydeveloper/current/en-us
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Lineage
  🔎 Original     Metadata API CustomObject reference
  🧭 Intent       developer_reference
  ↪ Override      developer → legacydeveloper (developer_reference_coverage)
  💬 Reason       Current Salesforce developer reference coverage is served from the legacydeveloper collection.
  ⚙ Compiled     guides:api_meta Metadata API CustomObject reference
  🗂 Slice        legacydeveloper/current/en-us
  🎚 Filters      guides:api_meta
  🧪 Evidence     not_checked

2. Results
  ✅ Matches      3 of 20163
  👁 Density      balanced
  1. CustomObject
     🔗 https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customobject.htm
     🆔 ad38890e…

→ Next
💡 Fetch promising result IDs before implementation-sensitive use; use answer only for quick cited synthesis.
```

### LLM sees

```text
SF Docs search returned 3 of 20163 result(s) for Metadata API CustomObject reference.

Results:
1. CustomObject
   id: ad38890ee51966417df19740105285b9021716d7da729add71e87d48fc54a25a
   url: https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customobject.htm

Next: fetch promising ids or urls before implementation-sensitive answers.
```

## Fetch

### Human sees

```text
📚 SF Docs · fetch  admin/current/en-us
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Lineage
  🔎 Original     1 id
  🗂 Slice        admin/current/en-us

2. Evidence packet
  📄 Documents    1
  📦 LLM packet   1.0k chars bounded source · cap 48k chars
  👁 Density      balanced
  📚 Source       1.0k chars fetched

3. Document evidence
  📄 1. Summer '26 Release Notes ok
     🔗 https://help.salesforce.com/s/articleView?id=xcloud.starter_prosuite_rn_2026_summer_release.htm&release=262.0.0&type=5
     🆔 978eb71b…
     🏷 release 262 · product Cross Cloud · guides cross_cloud · file xcloud/262-0-0/starter_prosuite_rn_2026_summer_release.html
     Source: 1.0k chars fetched · 1.0k chars sent to LLM
     Headings: Summer '26 Release Notes
     Preview:
     Explore what's new in Salesforce Suites for Summer '26...

→ Next
💡 LLM received the bounded Docs Evidence Packet. Expand for previews; open URLs for full source.
```

### LLM sees

```text
SF Docs fetch returned 1 document(s) for admin/current/en-us.
LLM source budget: 12000 chars per document; 48000 chars total.

<document index="1" id="978eb71b..." title="Summer '26 Release Notes" url="https://help.salesforce.com/s/articleView?id=xcloud.starter_prosuite_rn_2026_summer_release.htm&amp;release=262.0.0&amp;type=5" filename="xcloud/262-0-0/starter_prosuite_rn_2026_summer_release.html" locale="en-us" product="Cross Cloud" products="Cross Cloud" guides="cross_cloud" release="262" contentChars="1049" returnedChars="1049" truncated="false" metadataOnly="false" status="ok">
Source URL: https://help.salesforce.com/s/articleView?id=xcloud.starter_prosuite_rn_2026_summer_release.htm&release=262.0.0&type=5
Description: Explore what's new in Salesforce Suites for Summer '26...
# Summer '26 Release Notes
...
</document>
```

## Answer blocked by evidence gate

### Human sees

```text
⛔ SF Docs · answer blocked  admin/current/en-us
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Lineage
  🔎 Original     Sales Cloud Summer '26 release notes
  ⚙ Compiled     +release:262 guides:sales sales cloud release notes
  🗂 Slice        admin/current/en-us
  🎚 Filters      +release:262 guides:sales
  ⛔ Evidence     not_release_note_evidence — Only 1 of the first 5 citations were release-note evidence for release 262.

2. Evidence gate
  ✗ Status       not_release_note_evidence
  SF Docs answer citations did not satisfy the release-specific evidence gate.

→ Next
💡 Inspect the query plan, adjust the slice, or retry with a narrower query.
```

### LLM sees

```text
Docs Query Plan:
- original: Sales Cloud Summer '26 release notes
- compiled: +release:262 guides:sales sales cloud release notes
- slice: admin/current/en-us
- filters/boosts: +release:262 guides:sales
- evidence: not_release_note_evidence — Only 1 of the first 5 citations were release-note evidence for release 262.

SF Docs answer citations did not satisfy the release-specific evidence gate.
```

## Answer or Explain

### Human sees

```text
📚 SF Docs · answer  developer/current/en-us
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Lineage
  🔎 Original     How do I use Named Credentials in Apex callouts?
  🗂 Slice        developer/current/en-us

2. Answer preview
  ✅ Sources      2 citations
  👁 Density      balanced

Use `callout:<NamedCredential>` endpoints so Apex can make callouts without manually managing authentication details...

3. Citations
  1. Use the Named Credential in a Callout
     https://developer.salesforce.com/docs/platform/named-credentials/guide/nc-use-oauth-cred-in-callout.html

→ Next
💡 Open citations or fetch source IDs when implementation details matter.
```

### LLM sees

```text
Use `callout:<NamedCredential>` endpoints so Apex can make callouts without manually managing authentication details...

Citations:
1. Use the Named Credential in a Callout
   https://developer.salesforce.com/docs/platform/named-credentials/guide/nc-use-oauth-cred-in-callout.html
```

## Collections

### Human sees

```text
📚 SF Docs · collections  ?/current/en-us
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Catalog lineage
  📚 Collections  6
  🗄 Cache        refreshed
  👁 Density      balanced

2. Collection capabilities
admin current · en-us · text,html,markdown
  🧭 owns Latest Salesforce product documentation plus a bounded release-note window.
  🕘 release notes Salesforce release notes are available for the latest three release-note releases.
  📖 reference End-user and administrator help; developer reference material belongs in developer or legacydeveloper.
  🔍 filters +release:<n>, guides:<slug>, +taxonomyIds:<guid>

developer current · en-us · text,markdown
  🧭 owns Current Salesforce developer guides published through the modern developer-docs surface.
  📖 reference Legacy Atlas/reference docs are not modeled as primary developer coverage here; use legacydeveloper for those lookups.

→ Next
💡 Use the collection profile before choosing non-default slices or filters.
```

Collections keep the same layered grammar as other cards, but their evidence body is a capability inventory rather than source documents.
