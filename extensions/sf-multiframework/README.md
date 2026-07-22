# SF Multi-Framework — Code Walkthrough

## What It Does

SF Multi-Framework is a skill-first sf-pi extension for building React apps that run on Salesforce as `UIBundle` metadata.

It owns guidance for:

- React UI Bundle project structure
- current Salesforce CLI template command selection
- `@salesforce/platform-sdk` Data SDK calls
- build artifact hygiene
- internal `CustomApplication` companion metadata and app access
- external `Experience` app-container metadata, site publish, login, guest access, and Contact-linked reviewer users
- security choices between platform sharing and curated Apex API façades

V1 intentionally registers **no native LLM tool**. Source edits remain normal Pi `read`, `write`, and `edit` operations. Org verification and lifecycle work should use existing sf-pi tools: `sf_apex`, `sf_soql`, `sf_browser`, and `code_analyzer`.

## Runtime Flow

```text
Extension loads
  └─ register /sf-multiframework command

LLM task mentions React UI Bundles / Multi-Framework / Experience UIBundle
  └─ bundled sf-multiframework skill provides workflow guidance
       ├─ edit source with normal Pi tools
       ├─ verify Apex with sf_apex
       ├─ verify schema/access with sf_soql
       ├─ verify Salesforce UI / Experience last mile with sf_browser
       └─ scan static quality with code_analyzer
```

## Commands

```text
/sf-multiframework             Show extension status and boundaries
/sf-multiframework checklist   Show implementation checklist
/sf-multiframework experience  Show Experience Cloud route checklist
/sf-multiframework help        Show help
```

## Why Skill-First in V1

The Community Resilience Grants demo showed that the hard parts of Multi-Framework are mostly orchestration and Salesforce access design:

- picking the correct current template command,
- trusting generated metadata shape over stale examples,
- avoiding TypeScript build artifacts in deployable bundle roots,
- configuring Experience guest/auth Apex access,
- provisioning external users linked to Contacts,
- deciding whether reviewer security is platform-sharing-based or API-façade-based.

Those are best represented as a runbook first. A future native tool could inspect a local SFDX project for UI Bundle shape, stale build artifacts, Experience metadata wiring, and package/import drift.

## Behavior Matrix

| Event/Trigger                   | Result                                                              |
| ------------------------------- | ------------------------------------------------------------------- |
| extension load                  | Register `/sf-multiframework` command                               |
| `/sf-multiframework`            | Print status and handoff guidance                                   |
| `/sf-multiframework checklist`  | Print core build/deploy checklist                                   |
| `/sf-multiframework experience` | Print Experience public/auth checklist                              |
| LLM task matches bundled skill  | Load `skills/sf-multiframework/SKILL.md` through pi skill discovery |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-multiframework/
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Run before opening a PR:

```bash
npm run generate-catalog
npm run format:check
npm run check -- --pretty false
npm test -- extensions/sf-brain/tests/extension-context.test.ts
```

If V1 remains command/skill-only, no live Salesforce org is required for extension tests. Validate the runbook against a real app separately.
