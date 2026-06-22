---
title: "SF Brain"
description: "Give the agent a compact Salesforce operating guide so it chooses safer APIs and verification loops."
---

# SF Brain

<p class="sfpi-page-lead">Give the agent a compact Salesforce operating guide so it chooses safer APIs and verification loops.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Salesforce agent guidance</strong><p>Give the agent a compact Salesforce operating guide so it chooses safer APIs and verification loops.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Keeps Salesforce safety rules available without flooding every prompt.</div>
<div class="sfpi-benefit-card">Routes agents to the right SF Pi surface when deeper help is needed.</div>
<div class="sfpi-benefit-card">Encourages retrieve-before-edit and describe-before-query behavior.</div>
</div>

## Try it first

No command needed

```text
Install SF Pi and start a pi session.
```

You can manage this extension from the SF Pi home base:

```text
/sf-pi status sf-brain
/sf-pi enable sf-brain
/sf-pi disable sf-brain
```

## Common use cases

- Help an agent decide between Metadata API, Tooling API, REST, SOQL, or anonymous Apex.
- Keep org-safety conventions present across Salesforce work.
- Point agents to repo-local references without loading everything upfront.

## What you get

- A once-per-session Salesforce operator kernel.
- A compact reference map for deeper SF Pi and Salesforce workflows.
- No user-facing command surface because the extension works in the background.

## Safety notes

- Never registers tools; the kernel is delivered through the session entry log only.
- Honors a user override at &lt;globalAgentDir&gt;/sf-brain/SF_KERNEL.md.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-brain`
- **Category:** Assistive
- **Maturity:** stable
- **Default state:** on
- **Commands:** _none_
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `before_agent_start`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-brain/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-brain)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-brain/README.md#troubleshooting) for extension-specific recovery steps.
