---
name: sf-multiframework
description: >
  Build, inspect, debug, and document Salesforce Multi-Framework React apps
  deployed as UIBundle metadata. Use whenever users create or edit
  force-app/**/uiBundles, configure ui-bundle.json or .uibundle-meta.xml,
  scaffold with sf template generate ui-bundle or sf template generate project,
  use @salesforce/platform-sdk Data SDK/GraphQL/fetch from React, build
  CustomApplication app-launcher React apps, build Experience Cloud React apps,
  configure app-container digitalExperience metadata, or troubleshoot public,
  login, guest, reviewer, or external-user access for React UI Bundles. Do not
  use for pure LWC components, generic Apex unrelated to a React UI Bundle, or
  Agent Script .agent files.
---

# SF Multi-Framework

Salesforce Multi-Framework lets developers build modern React apps that run on Salesforce as `UIBundle` metadata. This skill is the sf-pi routing and runbook surface for React UI Bundle work.

Use this skill before generic Salesforce or LWC skills when the task mentions:

- `uiBundles/`
- `UIBundle`
- `ui-bundle.json`
- `.uibundle-meta.xml`
- React apps on Salesforce
- `@salesforce/platform-sdk`
- `sf template generate ui-bundle`
- `sf template generate project --template reactinternalapp|reactexternalapp`
- `CustomApplication` React apps
- Experience Cloud React app containers

## First decisions

1. **Target:** internal `CustomApplication` or external `Experience`?
2. **Template command:** add a bundle to an existing SFDX project (`sf template generate ui-bundle`) or generate a full app/project scaffold (`sf template generate project`) ?
3. **Data path:** GraphQL UI API, UI API REST, or Apex REST behind `@salesforce/platform-sdk`?
4. **Security model:** platform sharing/user-mode reads or a curated Apex façade?
5. **Experience auth:** public only, authenticated external users, or both?

## Non-negotiables

- Prefer current generated template output over stale examples.
- Use `@salesforce/platform-sdk` for Salesforce API calls from React. Do not raw `fetch()` or `axios` Salesforce endpoints.
- Keep SPA fallback in `ui-bundle.json`.
- Build before deploy; `dist/` is what Salesforce serves.
- Prefer `tsc --noEmit && vite build` unless project references are intentional and emitted artifacts are ignored.
- For internal apps, deploy the companion `applications/*.app-meta.xml` and grant app access.
- For external apps, deploy and publish the full Experience metadata stack.

## Current template command split

Check the installed CLI:

```bash
sf template generate ui-bundle --help
sf template generate project --help
```

Observed current shape:

| Command                          | Templates                                          | Use when                                                    |
| -------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `sf template generate ui-bundle` | `default`, `reactbasic`                            | Add one UI Bundle to an existing SFDX project.              |
| `sf template generate project`   | `reactinternalapp`, `reactexternalapp` when listed | Generate a fuller internal/external React project scaffold. |

## Internal CustomApplication checklist

- `<App>.uibundle-meta.xml` uses `<target>CustomApplication</target>`.
- `applications/<App>.app-meta.xml` exists.
- Current generated metadata may use namespace-qualified `<uiBundle>c__AppName</uiBundle>`.
- Deploy bundle and app metadata together.
- Grant app access. A new `CustomApplication` can be invisible even to admins until the profile or permission set is linked.
- Launch from App Launcher or the `.salesforce.app` URL, not stale beta `/lwr/application/...` paths.

## External Experience checklist

Read [references/experience-cloud-runbook.md](references/experience-cloud-runbook.md) when the app targets `Experience`.

At minimum:

- Deploy `digitalExperienceConfigs/`, `digitalExperiences/`, `networks/`, `sites/`, and the UI Bundle.
- Current generated `content.json` lives under `digitalExperiences/site/<SiteName>/sfdc_cms__site/<SiteName>/content.json`.
- Verify `contentBody.appContainer: true` and `contentBody.appSpace: "c__<DeveloperName>"`.
- Publish the site.
- Verify the React app-container URL, not only the underlying `...vforcesite` URL.
- For public Apex REST routes, grant guest Apex class access only to curated endpoints.
- For login/forgot password routes, grant guest Apex access to the generated auth classes.
- For authenticated external users, clone a standard external profile into an app-specific profile, add the cloned profile to the Experience site, then provision Users linked to Contacts.

## Sharing vs Apex façade

For Experience reviewers/customers, decide deliberately:

**Platform sharing:** grant object/FLS and record access, then use `WITH USER_MODE`/UI API. This is admin-auditable but requires correct sharing design.

**Curated Apex façade:** keep direct object access narrow/absent, run system-mode Apex, derive the current user's Contact/User server-side, and filter every read/mutation explicitly. This is good for demos and controlled APIs but the Apex code becomes the enforcement boundary.

If using a façade:

- never accept ContactId/UserId from the client;
- derive it from `UserInfo.getUserId()`;
- filter assignments/records by that derived identity;
- validate scope again before DML;
- use separate payload builders for public, reviewer, and internal data.

## Tool handoffs inside sf-pi

- Use `sf_apex` for Apex diagnostics, anonymous Apex probes, logs, and tests.
- Use `sf_soql` to describe objects before queries and verify access/data shape.
- Use `sf_browser` for Salesforce Setup, Experience UI, screenshots, and last-mile browser evidence.
- Use `code_analyzer` for explicit static scans.
- Use `sf_lwc` only for adjacent LWC work or React-vs-LWC comparison; it does not own React UI Bundles.

## Common failure map

| Symptom                                                      | Likely cause                                   | Fix                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------- |
| Public page loads but data falls back with Apex `403`        | Guest lacks Apex access                        | Grant guest access to curated public endpoint only.                 |
| Public board shows too many records                          | Publication filter too broad                   | Filter on final approved/awarded semantics.                         |
| Login POST returns Apex `403`                                | Guest lacks auth Apex access                   | Grant access to login/forgot-password classes used by the template. |
| External user creation fails: account owner role             | Contact Account owner has no role              | Assign a role to the account owner.                                 |
| Reviewer logs in but sees no records                         | Record sharing/user-mode query returns no rows | Add platform sharing or use a scoped Apex façade.                   |
| Deploy picks up `vite.config.js` / `.d.ts` / `*.tsbuildinfo` | `tsc -b` emitted artifacts into bundle root    | Use `tsc --noEmit && vite build`, delete artifacts, redeploy.       |

## When to update docs

When a live build exposes template drift, update the project handoff/training docs and note whether the issue belongs upstream in a skill PR. Multi-Framework template shape is evolving quickly; exact imports and Experience metadata should be validated against generated source every time.
