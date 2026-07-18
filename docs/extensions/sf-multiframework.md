---
title: "SF Multi-Framework"
description: "Build React UI Bundle apps for Salesforce CustomApplication and Experience surfaces with current template, data, build, and security runbooks."
---

# SF Multi-Framework

<p class="sfpi-page-lead">Build React UI Bundle apps for Salesforce CustomApplication and Experience surfaces with current template, data, build, and security runbooks.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>React UI Bundle / Multi-Framework apps</strong><p>Build React UI Bundle apps for Salesforce CustomApplication and Experience surfaces with current template, data, build, and security runbooks.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Routes React UI Bundle work away from generic LWC guidance and toward Multi-Framework-specific metadata patterns.</div>
<div class="sfpi-benefit-card">Captures current template command differences, @salesforce/platform-sdk usage, and build artifact hygiene.</div>
<div class="sfpi-benefit-card">Documents Experience Cloud guest/auth access, external user provisioning, and sharing-vs-Apex-façade security choices.</div>
</div>

## Try it first

Open Multi-Framework help

```text
/sf-multiframework
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-multiframework
/sf-pi enable sf-multiframework
/sf-pi disable sf-multiframework
```

## Common use cases

- Create or edit a React app under force-app/**/uiBundles.
- Choose between sf template generate ui-bundle and sf template generate project for React app scaffolds.
- Configure CustomApplication companion metadata and app access.
- Configure Experience Cloud app-container metadata, publish, login, guest Apex access, and Contact-linked external users.
- Troubleshoot public pages, reviewer portals, and Apex REST calls from React UI Bundles.

## What you get

- A bundled sf-multiframework skill with implementation checklist and Experience Cloud runbook.
- A small /sf-multiframework command for status, checklist, and Experience route reminders.
- Clear handoffs to sf_apex, sf_soql, sf_browser, and code_analyzer for verification.

## Safety notes

- V1 is guidance-only and does not mutate orgs or run builds/deploys automatically.
- The skill directs agents to use existing sf-pi tools for Salesforce mutations and verification, preserving guardrail behavior.
- External public/reviewer routes are documented as explicit security design choices: platform sharing or a curated Apex façade, never accidental broad guest access.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-multiframework`
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-multiframework`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** _none_

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-multiframework/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-multiframework)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-multiframework/README.md#troubleshooting) for extension-specific recovery steps.
