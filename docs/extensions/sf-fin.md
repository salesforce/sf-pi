---
title: "SF Fin"
description: "Connect SF Pi to a Fin (formerly Intercom) workspace with a Pi-owned, masked personal API token and a read-only doctor check through the installed Fin CLI."
editLink: false
---

# SF Fin

<p class="sfpi-page-lead">Connect SF Pi to a Fin (formerly Intercom) workspace with a Pi-owned, masked personal API token and a read-only doctor check through the installed Fin CLI.</p>

## What it does

Provides Pi-native `/login sf-fin`, which asks for the workspace hosting region and collects a Fin personal API token through SF Pi's shared fixed-mask input. Pi alone persists the credential. The `sf_fin` family tool and `/sf-fin` command expose cached status and a read-only doctor that runs the user's installed Fin CLI (`intercom --version`, `intercom me`) with the token in the child-process environment only and an SF Pi-private CLI config directory.

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
- CLI output is scrubbed of the token before it reaches status, tool results, or logs; status files store only non-secret workspace identity.
- v1 runs only `intercom --version` and `intercom me`, which are read-only and do not trigger the CLI's automatic Fin SDK enablement.

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
- **Providers:** `sf-fin`
- **Events/hooks:** `session_start`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-fin/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-fin)
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-fin/AGENTS.md)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-fin/AGENT_GUIDE.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-fin/README.md#troubleshooting) for extension-specific recovery steps.
