---
layout: home
title: SF Pi documentation
hero:
  name: SF Pi
  text: Salesforce extensions for pi, ready when you are
  tagline: Install one bundle and get safer Salesforce workflows, helpful agent tools, and friendly setup surfaces inside the pi coding agent.
  actions:
    - theme: brand
      text: Start in 5 minutes
      link: /quickstart
    - theme: alt
      text: Browse extensions
      link: /extensions
    - theme: alt
      text: Install
      link: /install
features:
  - title: One bundle, many focused tools
    details: Pick the extension that matches your task — Agent Script, Browser, Data 360, Slack, Guardrail, and more.
  - title: Built for Salesforce work
    details: Org context, production-aware guardrails, Data 360 helpers, Agentforce authoring, and Salesforce UI fallback paths.
  - title: Friendly by default
    details: Start with slash commands and guided panels; exact tool and source references stay available when you need them.
---

# Welcome to SF Pi

SF Pi is a bundle of Salesforce-focused extensions for the
[pi coding agent](https://pi.dev). It gives developers and agents a safer,
more discoverable way to work with Salesforce projects from one terminal UI.

<div class="sfpi-callout"><strong>TL;DR</strong> Install pi, run <code>pi install git:github.com/salesforce/sf-pi</code>, reload pi, then open <code>/sf-pi</code>.</div>

## Your first five minutes

<div class="sfpi-card-grid">
<a class="sfpi-extension-card" href="./install.html">
  <span class="sfpi-card-kicker">Step 1</span>
  <strong>Install the bundle</strong>
  <span>Add SF Pi as a pi package and reload your session.</span>
  <span class="sfpi-card-meta"><code class="sfpi-code-chip">pi install git:github.com/salesforce/sf-pi</code></span>
</a>
<a class="sfpi-extension-card" href="./quickstart.html">
  <span class="sfpi-card-kicker">Step 2</span>
  <strong>Open the home base</strong>
  <span>Use the manager to see what is enabled and where to go next.</span>
  <span class="sfpi-card-meta"><code class="sfpi-code-chip">/sf-pi</code></span>
</a>
<a class="sfpi-extension-card" href="./extensions.html">
  <span class="sfpi-card-kicker">Step 3</span>
  <strong>Pick your first extension</strong>
  <span>Browse by what you want to do: build agents, work with orgs, use Data 360, research Slack, or personalize pi.</span>
  <span class="sfpi-card-meta">Open catalog →</span>
</a>
</div>

## Popular starting points

- **Building Agentforce agents?** Start with [Agent Script](./extensions/sf-agentscript.md).
- **Need Salesforce UI fallback or screenshots?** Start with [Browser](./extensions/sf-browser.md).
- **Working with Data Cloud / Data 360?** Start with [Data 360](./extensions/sf-data360.md).
- **Want safer org operations?** Start with [Guardrail](./extensions/sf-guardrail.md) and [`/sf-org`](./commands.md#ui).
- **Need to research team context?** Start with [Slack](./extensions/sf-slack.md).

## What SF Pi adds to pi

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card"><strong>Slash commands</strong><br />Human-friendly panels like <code>/sf-pi</code>, <code>/sf-data360</code>, <code>/sf-browser</code>, and <code>/sf-agentscript</code>.</div>
<div class="sfpi-benefit-card"><strong>Agent tools</strong><br />Typed tools for Agent Script, Salesforce Browser, Data 360, and Slack workflows.</div>
<div class="sfpi-benefit-card"><strong>Safety guidance</strong><br />Guardrails for risky files, dangerous shell commands, and production Salesforce operations.</div>
<div class="sfpi-benefit-card"><strong>Status surfaces</strong><br />Welcome splash, DevBar, LSP status, Skills HUD, and Salesforce org awareness.</div>
</div>

## Keep going

- [Quickstart](./quickstart.md) — verify SF Pi and try your first commands.
- [Browse extensions](./extensions.md) — choose a workflow by intent.
- [Troubleshooting](./troubleshooting.md) — recover from install, org, font, or auth issues.
- [Security model](./security-model.md) — understand Guardrail mediation, high-value mutations, and headless behavior.
- [Prompt-injection controls](./prompt-injection-controls.md) — map prompt-injection risk to SF Pi's mediation and audit controls.
- [Public sanitization](./public-sanitization.md) — keep public docs, examples, tests, and diagnostics source-agnostic.
