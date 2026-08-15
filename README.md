# SF Pi

[![CI](https://github.com/salesforce/sf-pi/actions/workflows/ci.yml/badge.svg)](https://github.com/salesforce/sf-pi/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/salesforce/sf-pi?sort=semver)](https://github.com/salesforce/sf-pi/releases)
[![CodeQL](https://github.com/salesforce/sf-pi/actions/workflows/codeql.yml/badge.svg)](https://github.com/salesforce/sf-pi/actions/workflows/codeql.yml)
[![Coverage](https://codecov.io/gh/salesforce/sf-pi/branch/main/graph/badge.svg)](https://codecov.io/gh/salesforce/sf-pi)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE.txt)

Opinionated Salesforce extensions for the
[Pi coding agent](https://pi.dev): focused lifecycle tools, Salesforce-aware
status and safety surfaces, Agent Script authoring, and one Manager for package
settings and extension enablement.

📚 **Documentation:** [salesforce.github.io/sf-pi](https://salesforce.github.io/sf-pi/)

![SF Pi terminal interface showing Salesforce environment and extension status](https://github.com/user-attachments/assets/cbf2db6b-939c-4c66-8dab-fc505749fc77)

## Get started

Install Node.js 22.19 or newer, the latest supported Pi coding agent, and
Salesforce CLI. Then install SF Pi:

```bash
npm install --global @earendil-works/pi-coding-agent
pi install git:github.com/salesforce/sf-pi
pi
```

Inside Pi:

```text
/reload
/sf-pi doctor
/sf-skills defaults install global
```

The supported Pi range is currently
`>=0.82.0 <1.0.0`.

See [Installation](./docs/install.md) for updates, project-local setup, platform
notes, fonts, and recovery. Follow [Quickstart](./docs/quickstart.md) for a first
working session.

## What SF Pi adds

- **Build and test agents:** Agent Script authoring, preview, eval, publication,
  and eval-gated activation.
- **Develop Salesforce code:** API-native Apex and SOQL lifecycles plus local LWC
  inspection and Jest execution.
- **Work with org UI:** curated Salesforce navigation, compact snapshots, small
  last-mile interactions, and private Browser Evidence.
- **Use Data 360:** lifecycle-oriented connect, prepare, harmonize, segment,
  activate, query, semantic, observe, and orchestration families.
- **Find official guidance:** cited Salesforce documentation retrieval and
  deterministic Salesforce diagrams.
- **Collaborate deliberately:** Slack research and human-confirmed write
  surfaces when credentials and scopes are available.
- **Stay safe:** org-aware command and native-tool mediation with fail-closed
  headless behavior and auditable approvals.
- **Personalize Pi:** Salesforce status bars, startup readiness, LSP feedback,
  skills, and a configurable working indicator.

Browse the complete generated [extension catalog](./docs/extensions.md) and
[top-level command inventory](./docs/commands.md). Extension pages link to their
current README, safety notes, operating guide, and deeper references.

## Manage the bundle

Open `/sf-pi` for the interactive Manager. Common direct commands are:

```text
/sf-pi doctor
/sf-pi status
/sf-pi open <extension-id>
/sf-pi enable <extension-id> global
/sf-pi disable <extension-id> global
```

Optional companion packages are installed only after explicit user action with
`/sf-pi recommended`. Access-controlled integrations such as SF LLM Gateway,
SF Docs, and SF Slack require separately provided credentials and can be
disabled when unavailable.

## Privacy and security

SF Pi collects no active runtime telemetry. It defaults Pi's anonymous
install/update ping off only when the user has not already chosen a setting, and
preserves explicit user preferences. See [Privacy](./docs/privacy.md), the
[Security model](./docs/security-model.md), and [Security policy](./SECURITY.md).

Start troubleshooting with `/sf-pi doctor`, then use the generated
[Troubleshooting index](./docs/troubleshooting.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md), the
[Code of Conduct](./CODE_OF_CONDUCT.md), and [Governance](./GOVERNANCE.md).

SF Pi builds on [Mario Zechner's Pi coding agent](https://pi.dev) and credits
extension-specific upstream work in the corresponding `CREDITS.md` files.

## License

Licensed under the [Apache License 2.0](./LICENSE.txt).
