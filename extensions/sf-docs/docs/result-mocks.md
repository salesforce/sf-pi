# SF Docs Result Mocks

These examples show the split between human-facing **Docs Result Cards** and model-facing **Docs Evidence Packets**. The cards are compact and citation-rich; the evidence packets carry bounded official source text for the LLM.

## Search

### Human sees

```text
📚 SF Docs search · admin/current/en-us
  🔎 Query        Apex Release Notes API 67
  ✅ Results      5 of 42
  👁 Density      balanced

  1. Apex: New and Changed Items · Salesforce Release Notes
     🔗 https://help.salesforce.com/s/articleView?id=release-notes.rn_apex_nc.htm&release=262.0.0&type=5
     🆔 d0d35266…

💡 Next: fetch result ids for source text; use answer for quick cited synthesis.
```

### LLM sees

```text
SF Docs search returned 5 of 42 result(s) for Apex Release Notes API 67.

Results:
1. Apex: New and Changed Items
   id: d0d352663fa337ea9057338c9cac7a04c13c8b4c5dcc0c64548d15b4b105ad87
   url: https://help.salesforce.com/s/articleView?id=release-notes.rn_apex_nc.htm&release=262.0.0&type=5
   snippet: These classes, enums, and interfaces are new or have changes...

Next: fetch promising ids or urls before implementation-sensitive answers.
```

## Fetch

### Human sees

```text
📚 SF Docs fetch · admin/current/en-us
  📄 Documents    3
  📦 LLM packet   36k chars bounded source · cap 48k chars
  👁 Density      balanced
  📚 Source       58k chars fetched
  ⚠ Truncation   3 docs clipped

─── 📄 1. Apex ───
🔗 https://help.salesforce.com/s/articleView?id=release-notes.rn_apex.htm&release=262.0.0&type=5
🆔 dfb7f07e…
Source: 18k chars fetched · 12k chars sent to LLM · clipped
Headings: Apex · Database Operations Run in User Mode by Default · Apex Classes Enforce Sharing Rules by Default
Preview:
Database operations now run in user mode by default, not system mode...

💡 LLM received the bounded Docs Evidence Packet. Expand for previews; open URLs for full source.
```

### LLM sees

```text
SF Docs fetch returned 3 document(s) for admin/current/en-us.
LLM source budget: 12000 chars per document; 48000 chars total.

<document index="1" id="dfb7f07e..." title="Apex" url="https://help.salesforce.com/s/articleView?id=release-notes.rn_apex.htm&release=262.0.0&type=5" contentChars="18420" returnedChars="12000" truncated="true" metadataOnly="false" status="ok">
# Apex

Database operations now run in user mode by default, not system mode...
</document>
```

## Answer or Explain

### Human sees

```text
📚 SF Docs answer · developer/current/en-us
  ✅ Sources      2 citations
  👁 Density      balanced

─── 🧾 Answer preview ───
Use `WITH USER_MODE` for user-mode SOQL in API 67.0 and later...

─── 📎 Citations ───
  1. Apex
     https://help.salesforce.com/s/articleView?id=release-notes.rn_apex.htm&release=262.0.0&type=5
```

### LLM sees

```text
Use `WITH USER_MODE` for user-mode SOQL in API 67.0 and later...

Citations:
1. Apex
   https://help.salesforce.com/s/articleView?id=release-notes.rn_apex.htm&release=262.0.0&type=5
```

## Collections

Collections stay table-oriented. Display density is recorded with the result but only changes output when variable-length fields need clipping.
