---
title: "SF Fin"
description: "Connect SF Pi to a Fin (formerly Intercom) workspace: Pi-owned masked credentials, Guardrail-mediated Fin CLI install, doctor and debug, Fin-as-code authoring (procedures, simulations, guidance, data connectors), a CLI vs MCP surface comparison, and a Fin Agent API test harness."
editLink: false
---

# SF Fin

<p class="sfpi-page-lead">Connect SF Pi to a Fin (formerly Intercom) workspace: Pi-owned masked credentials, Guardrail-mediated Fin CLI install, doctor and debug, Fin-as-code authoring (procedures, simulations, guidance, data connectors), a CLI vs MCP surface comparison, and a Fin Agent API test harness.</p>

## What it does

Provides Pi-native `/login sf-fin`, which asks for the workspace hosting region and collects a Fin personal API token through SF Pi's shared fixed-mask input. Pi alone persists it. The `sf_fin` family tool and `/sf-fin` command expose cached status; a live read-only doctor (Node, Fin CLI presence and version freshness, credential, workspace identity through `intercom me`); Fin CLI install/update through exactly pinned global npm (TUI confirmation for humans, SF Guardrail mediation in the `fin` Power Tool family for the agent); and a redacted debug bundle with optional one-shot verbose traces. The CLI always runs with the token in the child-process environment only and an SF Pi-private CLI config directory. `/sf-pi doctor` receives cached-only checks.

## Start

Open the extension from its primary command:

```text
/sf-fin
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-fin
/sf-pi enable sf-fin
/sf-pi disable sf-fin
```

## Safety notes

- Interactive `/login sf-fin` masks the personal API token through SF Pi's shared credential input and returns it to Pi under provider id `sf-fin`; SF Fin writes no second secret store.
- The token reaches the Fin CLI only through an allowlisted child-process environment, never argv, and the child uses an SF Pi-private `INTERCOM_CONFIG_DIR`, so the user's own CLI keychain entry and `~/.intercom` files are never read or written.
- CLI output is scrubbed of the token before it reaches status, tool results, or logs; status files store only non-secret workspace identity and install readiness.
- Doctor runs `intercom --version` and `intercom me` only; Fin SDK actions enable the SDK by default on first use through an explicit probe → POST /fin-sdk/enable → verify sequence before any `fin …` CLI call, so the CLI's silent auto-enable never fires; the `/sf-pi doctor` provider reads cached state only.
- Install runs exactly `npm install -g @intercom/cli@&lt;exact version&gt;` without sudo or `@latest`, honors npm release-age policy, and refuses CLIs not installed by global npm; agent execution (`allow_mutation=true`) is an SF Guardrail native mutation in the `fin` Power Tool family.
- Verbose traces drop Authorization, Cookie, and bearer/basic values, are written as 0600 files with ten-file retention, self-disarm after the armed runs, and expose only the file path to the model.
- Procedure upload validates against the workspace schema first, never sets state (cannot publish), and verifies the saved copy semantically; simulation sets are validated per test; upload, upload_simulations, and simulate are SF Guardrail native writes in the fin Power Tool family, and validate is local.
- Fin simulates live procedures only; sdk simulate warns on drafts. sdk publish|pause plans by default; allow_mutation=true executes as the exact SF Guardrail mutation native-sf-fin-procedure-state (never session-approved) and verifies the resulting state.
- Fin simulates live procedures only; sdk simulate warns on drafts. sdk publish|pause plans by default; allow_mutation=true executes as the exact SF Guardrail mutation native-sf-fin-procedure-state (never session-approved) and verifies the resulting state.
- Guidance uploads are always paused and data connectors only as drafts; sdk guidance_state plans by default and executes as the exact SF Guardrail mutation native-sf-fin-procedure-state. The Fin Agent API key is a separate Pi provider (sf-fin-agent), sent only as an HTTPS Authorization header; agent run is native-sf-fin-agent-run because resolved conversations are billable. surfaces runs only local --help commands.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-fin`
- **Intent:** Build agents
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-fin`
- **LLM tools:** `sf_fin`
- **Providers:** `sf-fin`, `sf-fin-agent`
- **Events/hooks:** `session_start`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-fin/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-fin)
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-fin/AGENTS.md)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-fin/AGENT_GUIDE.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-fin/README.md#troubleshooting) for extension-specific recovery steps.
